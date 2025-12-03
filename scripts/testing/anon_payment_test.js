/**
 * ANONYMOUS PAYMENT TESTING
 * 
 * Shards: 5 wallets preloaded with 0.03 SOL each
 * Max per test: 0.05 SOL (HARD LIMIT)
 * 
 * Usage: node anon_payment_test.js
 */

const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// ========== HARD LIMITS ==========
const MAX_TEST_AMOUNT_SOL = 0.05;  // HARD LIMIT per test
const SHARD_FUNDING = 0.03;        // SOL per shard
const NUM_SHARDS = 5;
// =================================

const DEVNET_RPC = "https://api.devnet.solana.com";
const DEPLOYER_PATH = path.join(__dirname, '../../deployer_wallet.json');
const SHARDS_DIR = path.join(__dirname, 'test_shards');
const SHARDS_INFO_PATH = path.join(__dirname, 'SHARDS_INFO.json');

// Colors for console
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function log(color, prefix, msg) {
  console.log(`${color}[${prefix}]${RESET} ${msg}`);
}

async function setupShards(connection, deployer) {
  log(CYAN, 'SETUP', 'Setting up test shards...\n');
  
  // Create shards directory
  if (!fs.existsSync(SHARDS_DIR)) {
    fs.mkdirSync(SHARDS_DIR, { recursive: true });
  }
  
  let shardsInfo;
  
  // Check if shards already exist
  if (fs.existsSync(SHARDS_INFO_PATH)) {
    shardsInfo = JSON.parse(fs.readFileSync(SHARDS_INFO_PATH, 'utf8'));
    log(GREEN, 'FOUND', `${shardsInfo.shards.length} existing shards`);
  } else {
    // Create new shards
    shardsInfo = { shards: [], createdAt: new Date().toISOString() };
    
    for (let i = 0; i < NUM_SHARDS; i++) {
      const shard = Keypair.generate();
      const shardPath = path.join(SHARDS_DIR, `shard_${i}.json`);
      
      fs.writeFileSync(shardPath, JSON.stringify(Array.from(shard.secretKey)));
      
      shardsInfo.shards.push({
        index: i,
        pubkey: shard.publicKey.toBase58(),
        path: shardPath,
      });
    }
    
    fs.writeFileSync(SHARDS_INFO_PATH, JSON.stringify(shardsInfo, null, 2));
    log(GREEN, 'CREATED', `${NUM_SHARDS} new test shards`);
  }
  
  // Check and fund shards
  log(CYAN, 'FUNDING', 'Checking shard balances...\n');
  
  const fundTx = new Transaction();
  let needsFunding = 0;
  
  for (const shardInfo of shardsInfo.shards) {
    const balance = await connection.getBalance(new PublicKey(shardInfo.pubkey));
    const balanceSol = balance / LAMPORTS_PER_SOL;
    
    if (balanceSol < SHARD_FUNDING * 0.5) { // Fund if below half
      fundTx.add(
        SystemProgram.transfer({
          fromPubkey: deployer.publicKey,
          toPubkey: new PublicKey(shardInfo.pubkey),
          lamports: Math.floor(SHARD_FUNDING * LAMPORTS_PER_SOL),
        })
      );
      needsFunding++;
      log(YELLOW, `SHARD ${shardInfo.index}`, `${shardInfo.pubkey.slice(0, 8)}... | ${balanceSol.toFixed(4)} SOL → needs funding`);
    } else {
      log(GREEN, `SHARD ${shardInfo.index}`, `${shardInfo.pubkey.slice(0, 8)}... | ${balanceSol.toFixed(4)} SOL ✓`);
    }
  }
  
  if (fundTx.instructions.length > 0) {
    console.log('');
    log(CYAN, 'FUNDING', `Sending ${SHARD_FUNDING * needsFunding} SOL to ${needsFunding} shards...`);
    
    try {
      const sig = await sendAndConfirmTransaction(connection, fundTx, [deployer]);
      log(GREEN, 'FUNDED', `TX: ${sig.slice(0, 20)}...`);
    } catch (e) {
      log(RED, 'ERROR', `Failed to fund shards: ${e.message}`);
    }
  }
  
  console.log('');
  return shardsInfo;
}

async function getRandomShard(shardsInfo) {
  const shardInfo = shardsInfo.shards[Math.floor(Math.random() * shardsInfo.shards.length)];
  const secretKey = JSON.parse(fs.readFileSync(shardInfo.path, 'utf8'));
  return {
    keypair: Keypair.fromSecretKey(Uint8Array.from(secretKey)),
    info: shardInfo,
  };
}

async function testAnonPayment(connection, shardsInfo, amountSol, recipientPubkey) {
  // ========== HARD LIMIT CHECK ==========
  if (amountSol > MAX_TEST_AMOUNT_SOL) {
    log(RED, 'BLOCKED', `Amount ${amountSol} SOL exceeds hard limit of ${MAX_TEST_AMOUNT_SOL} SOL!`);
    return null;
  }
  // ======================================
  
  log(CYAN, 'TEST', `Anonymous payment of ${amountSol} SOL`);
  
  // Pick random shard for anonymity
  const shard = await getRandomShard(shardsInfo);
  
  // Check shard balance
  const shardBalance = await connection.getBalance(shard.keypair.publicKey);
  const shardBalanceSol = shardBalance / LAMPORTS_PER_SOL;
  
  if (shardBalanceSol < amountSol + 0.001) { // Need amount + fee
    log(RED, 'ERROR', `Shard ${shard.info.index} has insufficient balance (${shardBalanceSol.toFixed(4)} SOL)`);
    return null;
  }
  
  log(YELLOW, 'SHARD', `Using shard ${shard.info.index}: ${shard.info.pubkey.slice(0, 8)}...`);
  log(YELLOW, 'RECIPIENT', recipientPubkey.slice(0, 8) + '...');
  
  // Execute transfer from shard (anonymous source)
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: shard.keypair.publicKey,
      toPubkey: new PublicKey(recipientPubkey),
      lamports: Math.floor(amountSol * LAMPORTS_PER_SOL),
    })
  );
  
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [shard.keypair]);
    
    log(GREEN, 'SUCCESS', `TX: ${sig}`);
    log(GREEN, 'EXPLORER', `https://solscan.io/tx/${sig}?cluster=devnet`);
    
    return {
      success: true,
      txSig: sig,
      fromShard: shard.info.index,
      amount: amountSol,
      recipient: recipientPubkey,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    log(RED, 'ERROR', `Transfer failed: ${e.message}`);
    return null;
  }
}

async function showShardBalances(connection, shardsInfo) {
  console.log('\n' + '='.repeat(50));
  console.log('  📊 SHARD BALANCES');
  console.log('='.repeat(50) + '\n');
  
  let totalBalance = 0;
  
  for (const shardInfo of shardsInfo.shards) {
    const balance = await connection.getBalance(new PublicKey(shardInfo.pubkey));
    const balanceSol = balance / LAMPORTS_PER_SOL;
    totalBalance += balanceSol;
    
    const status = balanceSol >= SHARD_FUNDING * 0.5 ? GREEN + '✓' + RESET : RED + '⚠' + RESET;
    console.log(`  Shard ${shardInfo.index}: ${shardInfo.pubkey.slice(0, 12)}... | ${balanceSol.toFixed(4)} SOL ${status}`);
  }
  
  console.log('');
  console.log(`  Total: ${totalBalance.toFixed(4)} SOL`);
  console.log(`  Tests possible: ~${Math.floor(totalBalance / MAX_TEST_AMOUNT_SOL)}`);
  console.log('');
}

async function interactiveMode(connection, shardsInfo) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const question = (q) => new Promise(resolve => rl.question(q, resolve));
  
  console.log('\n' + '='.repeat(50));
  console.log('  🎮 INTERACTIVE TEST MODE');
  console.log('='.repeat(50));
  console.log(`\n  Commands:`);
  console.log(`    test <amount> <recipient>  - Send anonymous payment`);
  console.log(`    balance                    - Show shard balances`);
  console.log(`    fund                       - Refund shards`);
  console.log(`    quit                       - Exit\n`);
  console.log(`  Hard limit: ${MAX_TEST_AMOUNT_SOL} SOL per test\n`);
  
  while (true) {
    const input = await question('> ');
    const parts = input.trim().split(' ');
    const cmd = parts[0].toLowerCase();
    
    if (cmd === 'quit' || cmd === 'exit' || cmd === 'q') {
      console.log('Goodbye!');
      rl.close();
      break;
    }
    
    if (cmd === 'balance' || cmd === 'b') {
      await showShardBalances(connection, shardsInfo);
      continue;
    }
    
    if (cmd === 'fund' || cmd === 'f') {
      const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf8'));
      const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerData));
      await setupShards(connection, deployer);
      continue;
    }
    
    if (cmd === 'test' || cmd === 't') {
      const amount = parseFloat(parts[1]);
      const recipient = parts[2];
      
      if (isNaN(amount) || !recipient) {
        log(RED, 'USAGE', 'test <amount> <recipient_pubkey>');
        continue;
      }
      
      if (amount > MAX_TEST_AMOUNT_SOL) {
        log(RED, 'BLOCKED', `Max ${MAX_TEST_AMOUNT_SOL} SOL per test!`);
        continue;
      }
      
      await testAnonPayment(connection, shardsInfo, amount, recipient);
      console.log('');
      continue;
    }
    
    log(YELLOW, 'HELP', 'Commands: test, balance, fund, quit');
  }
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  🕵️ ANONYMOUS PAYMENT TESTING');
  console.log('='.repeat(60));
  console.log(`\n  Config:`);
  console.log(`    Shards: ${NUM_SHARDS}`);
  console.log(`    Funding per shard: ${SHARD_FUNDING} SOL`);
  console.log(`    ${RED}HARD LIMIT: ${MAX_TEST_AMOUNT_SOL} SOL per test${RESET}\n`);
  
  const connection = new Connection(DEVNET_RPC, "confirmed");
  
  // Load deployer
  const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf8'));
  const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerData));
  
  const deployerBalance = await connection.getBalance(deployer.publicKey);
  log(CYAN, 'DEPLOYER', `${deployer.publicKey.toBase58().slice(0, 12)}... | ${(deployerBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);
  
  // Setup shards
  const shardsInfo = await setupShards(connection, deployer);
  
  // Show balances
  await showShardBalances(connection, shardsInfo);
  
  // Check for command line args
  if (process.argv[2] === 'test' && process.argv[3] && process.argv[4]) {
    const amount = parseFloat(process.argv[3]);
    const recipient = process.argv[4];
    await testAnonPayment(connection, shardsInfo, amount, recipient);
    return;
  }
  
  // Interactive mode
  await interactiveMode(connection, shardsInfo);
}

main().catch(console.error);

