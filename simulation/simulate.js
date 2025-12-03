/**
 * PDOX Trading Simulation Engine
 * 
 * 100% Meteora DLMM AMM Simulation
 * (Meteora devnet doesn't support Token-2022 transfer fees yet)
 * 
 * Simulates realistic trading with:
 * - Constant product AMM (x * y = k)
 * - Token-2022 transfer fees (3% → 1% descent)
 * - Armageddon defense triggers
 * - User-injectable HYPE/FUD events
 * 
 * Start: 5 SOL + 10M PDOX (1% of supply)
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const LOGS_DIR = path.join(__dirname, 'logs');

// ============================================================================
// TOKEN CONSTANTS (from PDOX spec)
// ============================================================================

const TOTAL_SUPPLY = 1_000_000_000;
const DECIMALS = 9;
const SOL_PRICE_USD = 200;

// Initial pool: 5 SOL + 10M PDOX (1% of supply) = $680 LP
const INITIAL_SOL = 5;
const INITIAL_PRICE_SOL = 0.0000005; // 1 PDOX = 0.0000005 SOL ($0.000068)
const INITIAL_PDOX = 10_000_000; // 10M PDOX (1% of 1B supply)

// Fee constants
const FEE_MAX_BPS = 300; // 3%
const FEE_MIN_BPS = 100; // 1%
const FEE_DECAY_DAYS = 120;

// Fee distribution
const LP_SHARE_NORMAL = 0.70;
const BURN_SHARE_NORMAL = 0.15;
const TREASURY_SHARE_NORMAL = 0.15;

const LP_SHARE_ARMAGEDDON = 0.90;
const BURN_SHARE_ARMAGEDDON = 0.05;
const TREASURY_SHARE_ARMAGEDDON = 0.05;

// Armageddon thresholds (24h LP drop)
const DEFCON_3 = 0.50;
const DEFCON_2 = 0.75;
const DEFCON_1 = 0.90;

// ============================================================================
// SIMULATION PARAMETERS
// ============================================================================

// Base trading activity
const TRADES_PER_TICK_MIN = 2;
const TRADES_PER_TICK_MAX = 8;

// Trade sizes (in USD)
const TRADE_SIZE_MIN = 5;      // $5 minimum
const TRADE_SIZE_MAX = 200;    // $200 retail max
const WHALE_SIZE_MIN = 1000;   // $1K whale min
const WHALE_SIZE_MAX = 10000;  // $10K whale max

// Market phase weights (total 100)
const PHASES = {
  CHILL:      { weight: 50, buyBias: 0.50, sizeMultiplier: 1.0, volatility: 0.01 },
  ACCUMULATE: { weight: 20, buyBias: 0.60, sizeMultiplier: 0.8, volatility: 0.005 },
  FOMO:       { weight: 10, buyBias: 0.75, sizeMultiplier: 1.5, volatility: 0.03 },
  PANIC:      { weight: 8,  buyBias: 0.25, sizeMultiplier: 1.8, volatility: 0.04 },
  WHALE_BUY:  { weight: 6,  buyBias: 0.90, sizeMultiplier: 5.0, volatility: 0.02 },
  WHALE_SELL: { weight: 6,  buyBias: 0.10, sizeMultiplier: 5.0, volatility: 0.03 },
};

// User-injectable events
const HYPE_LEVELS = {
  1: { trades: 5,  buyBias: 0.65, sizeMultiplier: 1.2, duration: 3,  label: 'Minor buzz' },
  2: { trades: 10, buyBias: 0.70, sizeMultiplier: 1.5, duration: 5,  label: 'Twitter mention' },
  3: { trades: 20, buyBias: 0.75, sizeMultiplier: 2.0, duration: 8,  label: 'CT attention' },
  4: { trades: 35, buyBias: 0.80, sizeMultiplier: 3.0, duration: 12, label: 'Influencer pump' },
  5: { trades: 50, buyBias: 0.85, sizeMultiplier: 5.0, duration: 20, label: 'Full FOMO' },
};

const FUD_LEVELS = {
  1: { trades: 5,  buyBias: 0.35, sizeMultiplier: 1.2, duration: 3,  label: 'Minor FUD' },
  2: { trades: 10, buyBias: 0.30, sizeMultiplier: 1.5, duration: 5,  label: 'Doubt spreading' },
  3: { trades: 20, buyBias: 0.25, sizeMultiplier: 2.0, duration: 8,  label: 'CT panic' },
  4: { trades: 35, buyBias: 0.20, sizeMultiplier: 3.0, duration: 12, label: 'Rug rumors' },
  5: { trades: 50, buyBias: 0.15, sizeMultiplier: 5.0, duration: 20, label: 'Full panic sell' },
};

// ============================================================================
// UTILITIES
// ============================================================================

const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));

function weightedPick(items) {
  const total = Object.values(items).reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const [k, v] of Object.entries(items)) {
    r -= v.weight;
    if (r <= 0) return k;
  }
  return Object.keys(items)[0];
}

function genWallet() {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  return Array(44).fill(0).map(() => chars[randInt(0, chars.length - 1)]).join('');
}

function genTxHash() {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  return Array(88).fill(0).map(() => chars[randInt(0, chars.length - 1)]).join('');
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

function initState() {
  const now = Date.now();
  return {
    meta: {
      version: '2.0.0',
      started: now,
      last_tick: now,
      tick_count: 0,
      disclaimer: '100% METEORA DLMM AMM SIMULATION - Meteora devnet does not fully support Token-2022 transfer fees',
    },
    
    pool: {
      sol: INITIAL_SOL,
      pdox: INITIAL_PDOX,
      k: INITIAL_SOL * INITIAL_PDOX,
      lp_tokens_issued: Math.sqrt(INITIAL_SOL * INITIAL_PDOX),
    },
    
    price: {
      sol: INITIAL_PRICE_SOL,
      usd: INITIAL_PRICE_SOL * SOL_PRICE_USD,
    },
    
    token: {
      total_supply: TOTAL_SUPPLY,
      circulating: TOTAL_SUPPLY * 0.35,
      burned: 0,
      treasury: 0,
    },
    
    fees: {
      current_bps: FEE_MAX_BPS,
      total_collected: 0,
      total_to_lp: 0,
      total_burned: 0,
      total_to_treasury: 0,
    },
    
    market: {
      cap_usd: 0,
      lp_value_usd: INITIAL_SOL * SOL_PRICE_USD * 2,
      volume_24h: 0,
      volume_total: 0,
    },
    
    trades: {
      total: 0,
      buys: 0,
      sells: 0,
      buy_volume_usd: 0,
      sell_volume_usd: 0,
      list: [], // Last 200 trades
    },
    
    holders: {
      count: 10, // Start with 10 early holders
      top: {},
    },
    
    armageddon: {
      mode: 'NORMAL',
      lp_24h_ago: INITIAL_SOL * SOL_PRICE_USD * 2,
      triggers: [],
    },
    
    active_event: null, // User-injected event
    event_queue: [],    // Pending events
    
    history: {
      prices: [],
      events: [],
    },
    
    stats: {
      ath_usd: 0,
      atl_usd: Infinity,
      largest_buy_usd: 0,
      largest_sell_usd: 0,
    },
  };
}

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      // Migration: ensure new fields exist
      if (!data.meta) return initState();
      return data;
    }
  } catch (e) {
    console.error('State load error:', e.message);
  }
  return initState();
}

function saveState(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

// ============================================================================
// AMM LOGIC (Constant Product)
// ============================================================================

function getPrice(state) {
  return state.pool.sol / state.pool.pdox;
}

function calculateSwap(state, isBuy, amountUsd) {
  const solAmount = amountUsd / SOL_PRICE_USD;
  
  if (isBuy) {
    // Buy PDOX with SOL
    // New SOL in pool
    const newSol = state.pool.sol + solAmount;
    // Constant product: newSol * newPdox = k
    const newPdox = state.pool.k / newSol;
    const pdoxOut = state.pool.pdox - newPdox;
    
    // Apply transfer fee on PDOX out
    const feeBps = state.armageddon.mode !== 'NORMAL' ? FEE_MAX_BPS : state.fees.current_bps;
    const feeAmount = pdoxOut * (feeBps / 10000);
    const pdoxReceived = pdoxOut - feeAmount;
    
    return {
      type: 'BUY',
      sol_in: solAmount,
      pdox_out: pdoxReceived,
      fee_pdox: feeAmount,
      new_pool_sol: newSol,
      new_pool_pdox: newPdox,
      price_impact: (newSol / newPdox) / (state.pool.sol / state.pool.pdox) - 1,
    };
  } else {
    // Sell PDOX for SOL
    // Apply transfer fee on PDOX in
    const feeBps = state.armageddon.mode !== 'NORMAL' ? FEE_MAX_BPS : state.fees.current_bps;
    const pdoxGross = (amountUsd / SOL_PRICE_USD) / getPrice(state);
    const feeAmount = pdoxGross * (feeBps / 10000);
    const pdoxNet = pdoxGross - feeAmount;
    
    // New PDOX in pool
    const newPdox = state.pool.pdox + pdoxNet;
    // Constant product
    const newSol = state.pool.k / newPdox;
    const solOut = state.pool.sol - newSol;
    
    return {
      type: 'SELL',
      pdox_in: pdoxGross,
      sol_out: solOut,
      fee_pdox: feeAmount,
      new_pool_sol: newSol,
      new_pool_pdox: newPdox,
      price_impact: (newSol / newPdox) / (state.pool.sol / state.pool.pdox) - 1,
    };
  }
}

function applySwap(state, swap, wallet, phase) {
  const amountUsd = swap.type === 'BUY' 
    ? swap.sol_in * SOL_PRICE_USD 
    : swap.sol_out * SOL_PRICE_USD;
  
  // Update pool
  state.pool.sol = swap.new_pool_sol;
  state.pool.pdox = swap.new_pool_pdox;
  state.pool.k = state.pool.sol * state.pool.pdox; // Recalc k with fees added
  
  // Update price
  state.price.sol = getPrice(state);
  state.price.usd = state.price.sol * SOL_PRICE_USD;
  
  // Fee distribution
  const lpShare = state.armageddon.mode !== 'NORMAL' ? LP_SHARE_ARMAGEDDON : LP_SHARE_NORMAL;
  const burnShare = state.armageddon.mode !== 'NORMAL' ? BURN_SHARE_ARMAGEDDON : BURN_SHARE_NORMAL;
  const treasuryShare = state.armageddon.mode !== 'NORMAL' ? TREASURY_SHARE_ARMAGEDDON : TREASURY_SHARE_NORMAL;
  
  const feeToLp = swap.fee_pdox * lpShare;
  const feeToBurn = swap.fee_pdox * burnShare;
  const feeToTreasury = swap.fee_pdox * treasuryShare;
  
  // Add LP fee back to pool (this grows k!)
  state.pool.pdox += feeToLp;
  state.pool.k = state.pool.sol * state.pool.pdox;
  
  state.token.burned += feeToBurn;
  state.token.circulating -= feeToBurn;
  state.token.treasury += feeToTreasury;
  
  state.fees.total_collected += swap.fee_pdox;
  state.fees.total_to_lp += feeToLp;
  state.fees.total_burned += feeToBurn;
  state.fees.total_to_treasury += feeToTreasury;
  
  // Update market stats
  state.market.cap_usd = state.token.circulating * state.price.usd;
  state.market.lp_value_usd = state.pool.sol * SOL_PRICE_USD * 2;
  state.market.volume_24h += amountUsd;
  state.market.volume_total += amountUsd;
  
  // Update trade stats
  state.trades.total++;
  if (swap.type === 'BUY') {
    state.trades.buys++;
    state.trades.buy_volume_usd += amountUsd;
    if (amountUsd > state.stats.largest_buy_usd) state.stats.largest_buy_usd = amountUsd;
  } else {
    state.trades.sells++;
    state.trades.sell_volume_usd += amountUsd;
    if (amountUsd > state.stats.largest_sell_usd) state.stats.largest_sell_usd = amountUsd;
  }
  
  // ATH/ATL
  if (state.price.usd > state.stats.ath_usd) state.stats.ath_usd = state.price.usd;
  if (state.price.usd < state.stats.atl_usd) state.stats.atl_usd = state.price.usd;
  
  // Holder tracking
  if (!state.holders.top[wallet]) {
    state.holders.top[wallet] = { balance: 0, trades: 0, first: Date.now() };
    state.holders.count++;
  }
  state.holders.top[wallet].trades++;
  state.holders.top[wallet].balance += swap.type === 'BUY' ? (swap.pdox_out || 0) : -(swap.pdox_in || 0);
  
  // Record trade
  const trade = {
    ts: Date.now(),
    type: swap.type,
    wallet: wallet,
    usd: Math.round(amountUsd * 100) / 100,
    sol: Math.round((swap.type === 'BUY' ? swap.sol_in : swap.sol_out) * 1000000) / 1000000,
    pdox: Math.round((swap.type === 'BUY' ? swap.pdox_out : swap.pdox_in) * 100) / 100,
    fee: Math.round(swap.fee_pdox * 100) / 100,
    impact: Math.round(swap.price_impact * 10000) / 100, // percent
    phase: phase,
    tx: genTxHash(),
  };
  
  state.trades.list.unshift(trade);
  if (state.trades.list.length > 200) state.trades.list = state.trades.list.slice(0, 200);
  
  return trade;
}

// ============================================================================
// ARMAGEDDON CHECK
// ============================================================================

function checkArmageddon(state) {
  const currentLp = state.market.lp_value_usd;
  const lpBefore = state.armageddon.lp_24h_ago;
  
  if (lpBefore <= 0) {
    state.armageddon.lp_24h_ago = currentLp;
    return;
  }
  
  const drop = (lpBefore - currentLp) / lpBefore;
  
  let newMode = 'NORMAL';
  let event = null;
  
  if (drop >= DEFCON_1) {
    newMode = 'DEFCON_1';
    if (state.armageddon.mode !== 'DEFCON_1') {
      event = {
        type: 'ARMAGEDDON',
        level: 'DEFCON_1',
        ts: Date.now(),
        msg: `🚨 DEFCON 1: LP dropped ${(drop * 100).toFixed(1)}% in 24h`,
        details: { drop_pct: drop * 100, lp_before: lpBefore, lp_now: currentLp },
        response: ['Fee locked at 3%', 'LP share → 90%', 'Trading slowdown active'],
      };
    }
  } else if (drop >= DEFCON_2) {
    newMode = 'DEFCON_2';
    if (!['DEFCON_1', 'DEFCON_2'].includes(state.armageddon.mode)) {
      event = {
        type: 'ARMAGEDDON',
        level: 'DEFCON_2',
        ts: Date.now(),
        msg: `⚠️ DEFCON 2: LP dropped ${(drop * 100).toFixed(1)}% in 24h`,
        details: { drop_pct: drop * 100, lp_before: lpBefore, lp_now: currentLp },
        response: ['Fee locked at 3%', 'LP share → 90%', 'Treasury injection started'],
      };
    }
  } else if (drop >= DEFCON_3) {
    newMode = 'DEFCON_3';
    if (state.armageddon.mode === 'NORMAL') {
      event = {
        type: 'ARMAGEDDON',
        level: 'DEFCON_3',
        ts: Date.now(),
        msg: `⚡ DEFCON 3: LP dropped ${(drop * 100).toFixed(1)}% in 24h`,
        details: { drop_pct: drop * 100, lp_before: lpBefore, lp_now: currentLp },
        response: ['Fee locked at 3%', 'LP share → 90%'],
      };
    }
  } else if (state.armageddon.mode !== 'NORMAL' && drop < 0.2) {
    newMode = 'NORMAL';
    event = {
      type: 'RECOVERY',
      level: 'NORMAL',
      ts: Date.now(),
      msg: `✅ Recovery: LP stabilized`,
      details: { previous: state.armageddon.mode },
      response: ['Fee returned to schedule', 'Normal operations resumed'],
    };
  }
  
  if (event) {
    state.history.events.unshift(event);
    state.armageddon.triggers.push(event);
    console.log(`[EVENT] ${event.msg}`);
  }
  
  state.armageddon.mode = newMode;
}

// ============================================================================
// FEE DESCENT
// ============================================================================

function updateFeeRate(state) {
  if (state.armageddon.mode !== 'NORMAL') {
    state.fees.current_bps = FEE_MAX_BPS;
    return;
  }
  
  const daysSinceStart = (Date.now() - state.meta.started) / (24 * 60 * 60 * 1000);
  const decaySteps = Math.floor(daysSinceStart / 30); // Every 30 days
  const newRate = Math.max(FEE_MIN_BPS, FEE_MAX_BPS - (decaySteps * 50));
  state.fees.current_bps = newRate;
}

// ============================================================================
// TICK (Main Simulation Step)
// ============================================================================

function runTick(state, injectedEvent = null) {
  const tickStart = Date.now();
  
  // Process injected event if any
  let activeEvent = state.active_event;
  if (injectedEvent) {
    activeEvent = {
      ...injectedEvent,
      remaining_ticks: injectedEvent.duration,
      started: tickStart,
    };
    state.active_event = activeEvent;
    state.history.events.unshift({
      type: 'USER_EVENT',
      ts: tickStart,
      msg: `🎮 User triggered: ${injectedEvent.label}`,
      details: injectedEvent,
    });
  }
  
  // Determine trading behavior
  let buyBias, sizeMultiplier, numTrades;
  
  if (activeEvent && activeEvent.remaining_ticks > 0) {
    // Active event overrides normal phase
    buyBias = activeEvent.buyBias + (rand(-0.05, 0.05)); // Some randomness
    sizeMultiplier = activeEvent.sizeMultiplier * rand(0.8, 1.2);
    numTrades = randInt(
      Math.floor(activeEvent.trades * 0.6),
      Math.ceil(activeEvent.trades * 1.4)
    );
    activeEvent.remaining_ticks--;
    
    if (activeEvent.remaining_ticks <= 0) {
      state.active_event = null;
    }
  } else {
    // Normal phase selection
    const phase = weightedPick(PHASES);
    const phaseConfig = PHASES[phase];
    buyBias = phaseConfig.buyBias + (rand(-0.1, 0.1));
    sizeMultiplier = phaseConfig.sizeMultiplier * rand(0.7, 1.3);
    numTrades = randInt(TRADES_PER_TICK_MIN, TRADES_PER_TICK_MAX);
    
    // Chance for extra volatility
    if (Math.random() < 0.05) { // 5% chance of spike
      numTrades *= 3;
      sizeMultiplier *= 2;
    }
  }
  
  // Generate trades
  const trades = [];
  for (let i = 0; i < numTrades; i++) {
    const isBuy = Math.random() < buyBias;
    
    // Determine trade size
    let tradeUsd;
    if (Math.random() < 0.1) { // 10% chance of whale
      tradeUsd = rand(WHALE_SIZE_MIN, WHALE_SIZE_MAX) * sizeMultiplier;
    } else {
      tradeUsd = rand(TRADE_SIZE_MIN, TRADE_SIZE_MAX) * sizeMultiplier;
    }
    
    // Sanity: don't trade more than 20% of pool
    const maxUsd = state.pool.sol * SOL_PRICE_USD * 0.2;
    tradeUsd = Math.min(tradeUsd, maxUsd);
    
    if (tradeUsd < 1) continue; // Skip tiny trades
    
    const wallet = genWallet();
    const swap = calculateSwap(state, isBuy, tradeUsd);
    const trade = applySwap(state, swap, wallet, activeEvent ? 'EVENT' : 'NORMAL');
    trades.push(trade);
  }
  
  // Update fee rate
  updateFeeRate(state);
  
  // Check Armageddon
  checkArmageddon(state);
  
  // Record price point
  state.history.prices.push({
    ts: tickStart,
    usd: state.price.usd,
    sol: state.price.sol,
    lp: state.market.lp_value_usd,
    vol: trades.reduce((s, t) => s + t.usd, 0),
    mode: state.armageddon.mode,
  });
  
  // Keep last 2000 price points
  if (state.history.prices.length > 2000) {
    state.history.prices = state.history.prices.slice(-2000);
  }
  
  // Keep last 100 events
  if (state.history.events.length > 100) {
    state.history.events = state.history.events.slice(0, 100);
  }
  
  // Update 24h LP reference (rolling)
  if (state.history.prices.length > 96) { // ~24h at 15min ticks
    state.armageddon.lp_24h_ago = state.history.prices[state.history.prices.length - 96].lp;
  }
  
  // Update tick count
  state.meta.tick_count++;
  state.meta.last_tick = tickStart;
  
  console.log(`[TICK ${state.meta.tick_count}] Trades: ${trades.length} | ` +
    `Price: $${state.price.usd.toFixed(8)} | LP: $${state.market.lp_value_usd.toFixed(2)} | ` +
    `Mode: ${state.armageddon.mode}` +
    (activeEvent ? ` | EVENT: ${activeEvent.label}` : ''));
  
  return trades;
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  PDOX TRADING SIMULATION - 100% Meteora AMM Mock               ║');
  console.log('║  (Meteora devnet does not support Token-2022 transfer fees)    ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`Time: ${new Date().toISOString()}\n`);
  
  // Ensure logs dir
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  
  // Load or init state
  let state = loadState();
  
  // Check for CLI args (event injection)
  const args = process.argv.slice(2);
  let injectedEvent = null;
  
  if (args[0] === 'hype' && args[1]) {
    const level = parseInt(args[1]);
    if (HYPE_LEVELS[level]) {
      injectedEvent = { ...HYPE_LEVELS[level], type: 'HYPE', level };
      console.log(`💹 Injecting HYPE level ${level}: ${injectedEvent.label}\n`);
    }
  } else if (args[0] === 'fud' && args[1]) {
    const level = parseInt(args[1]);
    if (FUD_LEVELS[level]) {
      injectedEvent = { ...FUD_LEVELS[level], type: 'FUD', level };
      console.log(`📉 Injecting FUD level ${level}: ${injectedEvent.label}\n`);
    }
  } else if (args[0] === 'reset') {
    state = initState();
    console.log('🔄 State reset to initial (5 SOL + 10M PDOX start)\n');
  }
  
  // Run tick
  const trades = runTick(state, injectedEvent);
  
  // Save
  saveState(state);
  
  // Save daily log
  const today = new Date().toISOString().split('T')[0];
  const logFile = path.join(LOGS_DIR, `${today}.json`);
  
  let dailyLog = [];
  try {
    if (fs.existsSync(logFile)) {
      dailyLog = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }
  } catch (e) {}
  
  dailyLog.push({
    ts: Date.now(),
    tick: state.meta.tick_count,
    trades: trades.length,
    price_usd: state.price.usd,
    lp_usd: state.market.lp_value_usd,
    mode: state.armageddon.mode,
    event: injectedEvent ? injectedEvent.label : null,
  });
  
  fs.writeFileSync(logFile, JSON.stringify(dailyLog, null, 2));
  
  // Print summary
  console.log(`\n📊 CURRENT STATE:`);
  console.log(`   Price: $${state.price.usd.toFixed(8)} (${state.price.sol.toFixed(10)} SOL)`);
  console.log(`   Market Cap: $${(state.market.cap_usd / 1000).toFixed(2)}K`);
  console.log(`   LP Value: $${state.market.lp_value_usd.toFixed(2)}`);
  console.log(`   Pool: ${state.pool.sol.toFixed(4)} SOL + ${(state.pool.pdox / 1e6).toFixed(2)}M PDOX`);
  console.log(`   Total Trades: ${state.trades.total} (${state.trades.buys} buys / ${state.trades.sells} sells)`);
  console.log(`   Buy Volume: $${state.trades.buy_volume_usd.toFixed(2)}`);
  console.log(`   Sell Volume: $${state.trades.sell_volume_usd.toFixed(2)}`);
  console.log(`   Fees: ${state.fees.total_collected.toFixed(2)} PDOX collected`);
  console.log(`   Burned: ${state.token.burned.toFixed(2)} PDOX`);
  console.log(`   Holders: ${state.holders.count}`);
  console.log(`   Mode: ${state.armageddon.mode}`);
  console.log(`   Fee Rate: ${state.fees.current_bps / 100}%`);
  
  console.log(`\n✅ Saved to ${DATA_FILE}`);
}

// Export for external use
module.exports = { runTick, loadState, saveState, initState, HYPE_LEVELS, FUD_LEVELS };

// Run if called directly
if (require.main === module) {
  main();
}
