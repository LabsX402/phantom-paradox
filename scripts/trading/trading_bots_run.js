/**
 * PDOX TRADING BOTS - Runner
 * 
 * Executes random trades from bot wallets to create
 * organic trading activity.
 * 
 * Usage: node trading_bots_run.js
 */

const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { Raydium } = require('@raydium-io/raydium-sdk-v2');
const fs = require('fs');
const path = require('path');

// CONFIG
const DEVNET_RPC = "https://api.devnet.solana.com";
const POOL_ID = "DKdARvMSzUaFhRELRxe323xQvohqdVGnHHbtr8CbPSDU";
const PDOX_MINT = "5673DfyfMiP2vZTAwEr7t6pwZkQk1TTyLP7R8Lw8G41B";

// Trade settings
const MIN_TRADE_SOL = 0.001;
const MAX_TRADE_SOL = 0.02;
const MIN_DELAY_MS = 5000;
const MAX_DELAY_MS = 30000;
const BUY_BIAS = 0.55; // 55% buys, 45% sells

// Paths
const BOTS_INFO_PATH = path.join(__dirname, 'BOTS_INFO.json');
const BOTS_DIR = path.join(__dirname, 'bot_wallets');
const TRADES_LOG_PATH = path.join(__dirname, 'TRADES_LOG.json');

// State
let tradesLog = [];
let running = true;

async function loadBots() {
  if (!fs.existsSync(BOTS_INFO_PATH)) {
    console.log("❌ No bots found. Run 'node trading_bots.js' first to set up.");
    process.exit(1);
  }
  
  const botsInfo = JSON.parse(fs.readFileSync(BOTS_INFO_PATH, 'utf8'));
  const bots = [];
  
  for (const botInfo of botsInfo.wallets) {
    const secretKey = JSON.parse(fs.readFileSync(botInfo.path, 'utf8'));
    bots.push({
      keypair: Keypair.fromSecretKey(Uint8Array.from(secretKey)),
      pubkey: botInfo.pubkey,
      index: botInfo.index,
    });
  }
  
  return bots;
}

function randomDelay() {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

function randomTradeSize() {
  return MIN_TRADE_SOL + Math.random() * (MAX_TRADE_SOL - MIN_TRADE_SOL);
}

async function executeTrade(connection, bot, isBuy, amountSol) {
  const timestamp = new Date().toISOString();
  
  try {
    // For now, log the trade (actual swap requires pool liquidity)
    const trade = {
      timestamp,
      bot: bot.pubkey.slice(0, 8) + '...',
      type: isBuy ? 'BUY' : 'SELL',
      amountSol: amountSol.toFixed(6),
      status: 'SIMULATED', // Change to 'EXECUTED' when pool has liquidity
    };
    
    tradesLog.push(trade);
    if (tradesLog.length > 1000) tradesLog = tradesLog.slice(-500);
    
    console.log(`  ${isBuy ? '🟢 BUY' : '🔴 SELL'} | Bot #${bot.index.toString().padStart(2, '0')} | ${amountSol.toFixed(4)} SOL | ${timestamp.split('T')[1].slice(0, 8)}`);
    
    return trade;
  } catch (e) {
    console.log(`  ❌ Trade failed: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  🤖 PDOX TRADING BOTS - Running");
  console.log("=".repeat(60) + "\n");
  
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const bots = await loadBots();
  
  console.log(`📋 Loaded ${bots.length} bot wallets`);
  console.log(`📊 Pool: ${POOL_ID}`);
  console.log(`⚙️  Buy Bias: ${(BUY_BIAS * 100).toFixed(0)}%`);
  console.log(`⏱️  Trade Interval: ${MIN_DELAY_MS/1000}s - ${MAX_DELAY_MS/1000}s`);
  console.log(`💰 Trade Size: ${MIN_TRADE_SOL} - ${MAX_TRADE_SOL} SOL\n`);
  
  // Check bot balances
  console.log("Checking bot balances...");
  let activeBots = [];
  
  for (const bot of bots) {
    const balance = await connection.getBalance(bot.keypair.publicKey);
    if (balance > MIN_TRADE_SOL * LAMPORTS_PER_SOL * 2) {
      activeBots.push({ ...bot, balance: balance / LAMPORTS_PER_SOL });
    }
  }
  
  console.log(`✅ ${activeBots.length} bots have sufficient balance\n`);
  
  if (activeBots.length === 0) {
    console.log("❌ No bots with sufficient balance. Fund them first.");
    return;
  }
  
  console.log("=".repeat(60));
  console.log("  STARTING TRADES (Ctrl+C to stop)");
  console.log("=".repeat(60) + "\n");
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log("\n\n⏹️  Stopping...");
    running = false;
    
    // Save trades log
    fs.writeFileSync(TRADES_LOG_PATH, JSON.stringify(tradesLog, null, 2));
    console.log(`📝 Saved ${tradesLog.length} trades to ${TRADES_LOG_PATH}`);
    
    process.exit(0);
  });
  
  // Trading loop
  let tradeCount = 0;
  
  while (running) {
    // Pick random bot
    const botIndex = Math.floor(Math.random() * activeBots.length);
    const bot = activeBots[botIndex];
    
    // Decide buy or sell
    const isBuy = Math.random() < BUY_BIAS;
    
    // Random trade size
    const tradeSize = randomTradeSize();
    
    // Execute trade
    await executeTrade(connection, bot, isBuy, tradeSize);
    tradeCount++;
    
    // Stats every 10 trades
    if (tradeCount % 10 === 0) {
      const buys = tradesLog.filter(t => t.type === 'BUY').length;
      const sells = tradesLog.filter(t => t.type === 'SELL').length;
      console.log(`\n  📊 Stats: ${tradeCount} trades | ${buys} buys | ${sells} sells\n`);
    }
    
    // Random delay
    const delay = randomDelay();
    await new Promise(r => setTimeout(r, delay));
  }
}

main().catch(console.error);

