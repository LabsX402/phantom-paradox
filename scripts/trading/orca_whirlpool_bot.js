/**
 * REAL ORCA POOL TRADING BOT - Devnet
 *
 * Performs *actual* swaps on your Orca SOL/PDOX whirlpool on devnet,
 * using the worker wallets from trading_workers.json.
 *
 * Usage:
 *   node orca_whirlpool_bot.js
 */

const fs = require('fs');
const path = require('path');
const {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const {
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} = require('@solana/spl-token');
const {
  AnchorProvider,
  Wallet,
} = require('@coral-xyz/anchor');
const {
  WhirlpoolContext,
  buildWhirlpoolClient,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  swapQuoteByInputToken,
  PDAUtil,
  SwapUtils,
  PoolUtil,
  WhirlpoolIx,
  toTx,
} = require('@orca-so/whirlpools-sdk');
const { Percentage, DecimalUtil } = require('@orca-so/common-sdk');
const BN = require('bn.js');
const Decimal = require('decimal.js');

// ========= CONFIG =========
const DEVNET_RPC = 'https://api.devnet.solana.com';

// Your PDOX mint (token-2022)
const PDOX_MINT = new PublicKey('9umyHgCSv6xuAv6bczUsR7hBKqyCAZCmPcc4eVhAGrfN');

// Your SOL/PDOX Whirlpool address (from ORCA_POOL.json)
const ORCA_POOL_ADDRESS = new PublicKey('Gitxz5GEZkLFAcr9SMUJEW4wvBaGd1PQ838Mqhzbo2eh');

// Trading settings
const MAX_TX = 100;              // Total swaps to do
const MIN_SOL_IN = 0.005;        // Min SOL per swap
const MAX_SOL_IN = 0.02;         // Max SOL per swap
const MIN_PDOX_IN = 1000;        // Min PDOX per swap  
const MAX_PDOX_IN = 5000;        // Max PDOX per swap
const MIN_DELAY_MS = 3000;       // 3 sec min between swaps
const MAX_DELAY_MS = 8000;       // 8 sec max
const SLIPPAGE_BPS = 300;        // 3% slippage for devnet (pools can be thin)

// ========= UTIL =========
function randFloat(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ========= WORKERS =========
function loadWorkers() {
  const workersPath = path.join(__dirname, '../../trading_workers.json');
  if (!fs.existsSync(workersPath)) {
    throw new Error(`Workers file not found: ${workersPath}`);
  }
  const raw = fs.readFileSync(workersPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return parsed.workers.map((w) => ({
    id: w.id,
    keypair: Keypair.fromSecretKey(Uint8Array.from(w.secretKey)),
    fundedSol: parseFloat(w.fundedSol || 0),
  }));
}

// ========= GET WORKER BALANCES =========
async function getWorkerBalances(connection, worker) {
  const solBalance = await connection.getBalance(worker.keypair.publicKey);
  
  let pdoxBalance = 0;
  try {
    const pdoxAta = getAssociatedTokenAddressSync(
      PDOX_MINT,
      worker.keypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const account = await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    pdoxBalance = Number(account.amount) / 1e9;
  } catch (e) {
    // No PDOX account yet
  }
  
  return {
    sol: solBalance / LAMPORTS_PER_SOL,
    pdox: pdoxBalance,
  };
}

// ========= ENSURE PDOX ATA EXISTS =========
async function ensurePdoxAta(connection, worker) {
  const pdoxAta = getAssociatedTokenAddressSync(
    PDOX_MINT,
    worker.keypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  try {
    await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    return pdoxAta;
  } catch (e) {
    // Create ATA
    console.log(`  📝 Creating PDOX ATA for Worker ${worker.id}...`);
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        worker.keypair.publicKey,
        pdoxAta,
        worker.keypair.publicKey,
        PDOX_MINT,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(connection, tx, [worker.keypair]);
    return pdoxAta;
  }
}

// ========= WHIRLPOOL SETUP =========
async function getWhirlpoolClient(connection, wallet) {
  const provider = new AnchorProvider(
    connection,
    wallet,
    { commitment: 'confirmed' }
  );
  const ctx = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
  const client = buildWhirlpoolClient(ctx);
  return { ctx, client };
}

// ========= DO SWAP =========
async function doSwap(connection, worker, direction) {
  const wallet = new Wallet(worker.keypair);
  const { ctx, client } = await getWhirlpoolClient(connection, wallet);
  
  // Fetch pool
  const whirlpool = await client.getPool(ORCA_POOL_ADDRESS);
  const poolData = whirlpool.getData();
  const tokenAInfo = whirlpool.getTokenAInfo();
  const tokenBInfo = whirlpool.getTokenBInfo();
  
  // Figure out which is SOL and which is PDOX
  const isTokenA_SOL = tokenAInfo.mint.equals(NATIVE_MINT);
  const solToken = isTokenA_SOL ? tokenAInfo : tokenBInfo;
  const pdoxToken = isTokenA_SOL ? tokenBInfo : tokenAInfo;
  
  const slippage = Percentage.fromFraction(SLIPPAGE_BPS, 10_000);
  
  let inputToken, inputAmount, label;
  
  if (direction === 'BUY') {
    // Buy PDOX with SOL
    inputToken = solToken;
    const solAmount = randFloat(MIN_SOL_IN, MAX_SOL_IN);
    inputAmount = DecimalUtil.toBN(new Decimal(solAmount), solToken.decimals);
    label = `BUY ${solAmount.toFixed(4)} SOL → PDOX`;
  } else {
    // Sell PDOX for SOL
    inputToken = pdoxToken;
    const pdoxAmount = randFloat(MIN_PDOX_IN, MAX_PDOX_IN);
    inputAmount = DecimalUtil.toBN(new Decimal(pdoxAmount), pdoxToken.decimals);
    label = `SELL ${pdoxAmount.toFixed(2)} PDOX → SOL`;
  }
  
  console.log(`\n🔄 Worker ${worker.id}: ${label}`);
  
  // Ensure PDOX ATA exists
  await ensurePdoxAta(connection, worker);
  
  // Get swap quote
  const quote = await swapQuoteByInputToken(
    whirlpool,
    inputToken.mint,
    inputAmount,
    slippage,
    ctx.program.programId,
    ctx.fetcher,
    true // refresh
  );
  
  // Build and execute swap transaction
  const tx = await whirlpool.swap(quote);
  const sig = await tx.buildAndExecute();
  
  console.log(`  ✅ TX: https://solscan.io/tx/${sig}?cluster=devnet`);
  
  return { sig, direction, label };
}

// ========= MAIN LOOP =========
async function run() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  🐋 ORCA WHIRLPOOL TRADING BOT - Devnet SOL/PDOX');
  console.log('═══════════════════════════════════════════════════════\n');

  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const workers = loadWorkers();
  
  console.log(`✅ Loaded ${workers.length} workers`);
  console.log(`🏊 Pool: ${ORCA_POOL_ADDRESS.toBase58()}`);
  console.log(`🪙 PDOX: ${PDOX_MINT.toBase58()}\n`);

  // Show some worker balances
  console.log('── Worker Balances (sample) ──');
  for (let i = 0; i < Math.min(5, workers.length); i++) {
    const bal = await getWorkerBalances(connection, workers[i]);
    console.log(`  W${workers[i].id}: ${bal.sol.toFixed(4)} SOL | ${bal.pdox.toFixed(2)} PDOX`);
  }
  console.log(`  ... and ${workers.length - 5} more\n`);

  const txLog = [];
  let txCount = 0;
  let buyCount = 0;
  let sellCount = 0;

  console.log('── Starting Trading Loop ──');
  console.log(`  Target: ${MAX_TX} swaps\n`);

  while (txCount < MAX_TX) {
    // Pick random worker
    const worker = workers[randInt(0, workers.length - 1)];
    
    // Get balance to decide direction
    const bal = await getWorkerBalances(connection, worker);
    
    // Smart direction: if no PDOX, must buy. If low SOL, must sell.
    let direction;
    if (bal.pdox < MIN_PDOX_IN) {
      direction = 'BUY';
    } else if (bal.sol < MIN_SOL_IN + 0.01) {
      direction = 'SELL';
    } else {
      // Random 50/50
      direction = Math.random() < 0.5 ? 'BUY' : 'SELL';
    }

    try {
      const result = await doSwap(connection, worker, direction);
      txLog.push({
        workerId: worker.id,
        ...result,
        timestamp: new Date().toISOString(),
      });
      txCount++;
      if (direction === 'BUY') buyCount++;
      else sellCount++;
      
      console.log(`  📊 Progress: ${txCount}/${MAX_TX} (${buyCount} buys, ${sellCount} sells)`);
    } catch (e) {
      console.log(`  ❌ Failed W${worker.id}: ${e.message.slice(0, 80)}`);
    }

    const waitMs = randInt(MIN_DELAY_MS, MAX_DELAY_MS);
    console.log(`  ⏳ Next in ${(waitMs / 1000).toFixed(1)}s...`);
    await sleep(waitMs);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  ✅ DONE! ${txCount} swaps executed`);
  console.log(`  📈 Buys: ${buyCount} | 📉 Sells: ${sellCount}`);
  console.log('═══════════════════════════════════════════════════════');

  // Save log
  const logPath = path.join(__dirname, 'orca_trading_log.json');
  fs.writeFileSync(logPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    pool: ORCA_POOL_ADDRESS.toBase58(),
    totalSwaps: txCount,
    buys: buyCount,
    sells: sellCount,
    swaps: txLog,
  }, null, 2));
  
  console.log(`\n📝 Log saved to ${logPath}`);
}

run().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
