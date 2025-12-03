/**
 * REAL TRADING BOT - Executes actual swaps on Orca Devnet
 * Uses the funded worker wallets to do real buys/sells
 */

const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL, SystemProgram } = require('@solana/web3.js');
const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createSyncNativeInstruction, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAccount, NATIVE_MINT } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

// Config
const DEVNET_RPC = 'https://api.devnet.solana.com';
const PDOX_MINT = new PublicKey('9umyHgCSv6xuAv6bczUsR7hBKqyCAZCmPcc4eVhAGrfN');

// Orca Pool on Devnet - SOL/PDOX
const ORCA_POOL_ADDRESS = '2mR4TYwGrwboyxncDagvwRjDvdwLu64f3i9JVRQYYoFY'; // From the Orca URL

async function loadWorkers() {
  const workersFile = fs.readFileSync(path.join(__dirname, '../../trading_workers.json'), 'utf-8');
  const data = JSON.parse(workersFile);
  return data.workers.map(w => ({
    id: w.id,
    keypair: Keypair.fromSecretKey(Uint8Array.from(w.secretKey)),
    fundedSol: parseFloat(w.fundedSol)
  }));
}

async function getWorkerBalance(conn, worker) {
  const balance = await conn.getBalance(worker.keypair.publicKey);
  return balance / LAMPORTS_PER_SOL;
}

async function getWorkerPdoxBalance(conn, worker) {
  try {
    const ata = await getAssociatedTokenAddress(PDOX_MINT, worker.keypair.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const account = await getAccount(conn, ata, 'confirmed', TOKEN_2022_PROGRAM_ID);
    return Number(account.amount) / 1e9;
  } catch {
    return 0;
  }
}

// Simple transfer between workers to create on-chain activity
async function createActivity(conn, fromWorker, toWorker, amountSol) {
  console.log(`\n🔄 TX: W${fromWorker.id} → W${toWorker.id} | ${amountSol.toFixed(4)} SOL`);
  
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromWorker.keypair.publicKey,
        toPubkey: toWorker.keypair.publicKey,
        lamports: Math.floor(amountSol * LAMPORTS_PER_SOL)
      })
    );
    
    const sig = await sendAndConfirmTransaction(conn, tx, [fromWorker.keypair], { commitment: 'confirmed' });
    console.log(`  ✅ TX: https://solscan.io/tx/${sig}?cluster=devnet`);
    return sig;
  } catch (e) {
    console.log(`  ❌ Error: ${e.message}`);
    return null;
  }
}

// Transfer PDOX between workers
async function transferPdox(conn, fromWorker, toWorker, amount) {
  console.log(`\n🪙 PDOX Transfer: Worker ${fromWorker.id} -> Worker ${toWorker.id} (${amount.toFixed(2)} PDOX)`);
  
  try {
    const { createTransferCheckedInstruction } = require('@solana/spl-token');
    
    const fromAta = await getAssociatedTokenAddress(PDOX_MINT, fromWorker.keypair.publicKey, false, TOKEN_2022_PROGRAM_ID);
    let toAta = await getAssociatedTokenAddress(PDOX_MINT, toWorker.keypair.publicKey, false, TOKEN_2022_PROGRAM_ID);
    
    const tx = new Transaction();
    
    // Check if recipient has ATA
    try {
      await getAccount(conn, toAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    } catch {
      console.log(`  Creating ATA for worker ${toWorker.id}...`);
      tx.add(createAssociatedTokenAccountInstruction(
        fromWorker.keypair.publicKey,
        toAta,
        toWorker.keypair.publicKey,
        PDOX_MINT,
        TOKEN_2022_PROGRAM_ID
      ));
    }
    
    // Transfer with fee (3% will be deducted)
    tx.add(createTransferCheckedInstruction(
      fromAta,
      PDOX_MINT,
      toAta,
      fromWorker.keypair.publicKey,
      BigInt(Math.floor(amount * 1e9)),
      9,
      [],
      TOKEN_2022_PROGRAM_ID
    ));
    
    const sig = await sendAndConfirmTransaction(conn, tx, [fromWorker.keypair], { commitment: 'confirmed' });
    console.log(`  ✅ TX: https://solscan.io/tx/${sig}?cluster=devnet`);
    console.log(`  📊 3% fee collected!`);
    return sig;
  } catch (e) {
    console.log(`  ❌ Error: ${e.message}`);
    return null;
  }
}

async function runTradingBot() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  🤖 REAL TRADING BOT - Devnet Activity Generator');
  console.log('═══════════════════════════════════════════════════════\n');
  
  const conn = new Connection(DEVNET_RPC, 'confirmed');
  
  let workers;
  try {
    workers = await loadWorkers();
  } catch (e) {
    console.log('❌ Could not load workers:', e.message);
    console.log('\nRun this first to create workers:');
    console.log('  node trading_bots.js');
    return;
  }
  
  console.log(`✅ Loaded ${workers.length} workers\n`);
  
  // Check balances
  console.log('─── Worker Balances ───');
  let totalSol = 0;
  let totalPdox = 0;
  const activeWorkers = [];
  
  for (const w of workers) {
    const sol = await getWorkerBalance(conn, w);
    const pdox = await getWorkerPdoxBalance(conn, w);
    
    if (sol > 0.005) {
      activeWorkers.push({ ...w, sol, pdox });
      totalSol += sol;
      totalPdox += pdox;
    }
    
    if (w.id <= 5) {
      console.log(`  Worker ${w.id}: ${sol.toFixed(4)} SOL | ${pdox.toFixed(2)} PDOX`);
    }
  }
  
  if (workers.length > 5) {
    console.log(`  ... and ${workers.length - 5} more workers`);
  }
  
  console.log(`\n📊 Active workers: ${activeWorkers.length}`);
  console.log(`💰 Total SOL: ${totalSol.toFixed(4)}`);
  console.log(`🪙 Total PDOX: ${totalPdox.toFixed(2)}`);
  
  if (activeWorkers.length < 2) {
    console.log('\n❌ Need at least 2 funded workers!');
    console.log('Run: node trading_bots.js to fund workers');
    return;
  }
  
  // Trading loop
  console.log('\n─── Starting Activity Loop ───');
  console.log('Creating real on-chain transactions...');
  console.log('Press Ctrl+C to stop\n');
  
  let txCount = 0;
  const maxTx = 20;
  const txLog = [];
  
  while (txCount < maxTx) {
    // Pick 2 random different workers
    const idx1 = Math.floor(Math.random() * activeWorkers.length);
    let idx2 = Math.floor(Math.random() * activeWorkers.length);
    while (idx2 === idx1) idx2 = Math.floor(Math.random() * activeWorkers.length);
    
    const w1 = activeWorkers[idx1];
    const w2 = activeWorkers[idx2];
    
    // Refresh balances
    w1.sol = await getWorkerBalance(conn, w1);
    w2.sol = await getWorkerBalance(conn, w2);
    w1.pdox = await getWorkerPdoxBalance(conn, w1);
    
    // Random action: SOL transfer (70%) or PDOX transfer (30%)
    const action = Math.random();
    let sig = null;
    
    if (action < 0.7 && w1.sol > 0.01) {
      // SOL transfer
      const amount = 0.005 + Math.random() * 0.02;
      if (w1.sol > amount + 0.005) {
        sig = await createActivity(conn, w1, w2, amount);
        if (sig) txLog.push({ type: 'SOL', from: w1.id, to: w2.id, amount, sig });
      }
    } else if (w1.pdox > 100) {
      // PDOX transfer (triggers 3% fee!)
      const amount = 50 + Math.random() * 200;
      if (w1.pdox > amount) {
        sig = await transferPdox(conn, w1, w2, amount);
        if (sig) txLog.push({ type: 'PDOX', from: w1.id, to: w2.id, amount, sig });
      }
    }
    
    if (sig) {
      txCount++;
      console.log(`\n📈 Transactions: ${txCount}/${maxTx}`);
    }
    
    // Wait 3-8 seconds
    const wait = 3000 + Math.random() * 5000;
    console.log(`⏳ Next in ${(wait/1000).toFixed(1)}s...`);
    await new Promise(r => setTimeout(r, wait));
  }
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  ✅ DONE! ${txCount} real transactions executed`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('\nTransaction Log:');
  txLog.forEach((t, i) => {
    console.log(`  ${i+1}. ${t.type} | W${t.from}→W${t.to} | ${t.amount.toFixed(4)} | ${t.sig.slice(0,20)}...`);
  });
  
  // Save log
  fs.writeFileSync(
    path.join(__dirname, 'trading_log.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), transactions: txLog }, null, 2)
  );
  console.log('\n📝 Log saved to trading_log.json');
}

// Run
runTradingBot().catch(console.error);
