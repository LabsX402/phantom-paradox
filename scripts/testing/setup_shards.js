/**
 * Setup 5 test shards with 0.03 SOL each
 */
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const DEVNET_RPC = 'https://api.devnet.solana.com';
const DEPLOYER_PATH = path.join(__dirname, '../../deployer_wallet.json');
const SHARDS_DIR = path.join(__dirname, 'test_shards');
const SHARDS_INFO_PATH = path.join(__dirname, 'SHARDS_INFO.json');

const NUM_SHARDS = 5;
const SHARD_FUNDING = 0.03;

async function main() {
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf8'));
  const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerData));
  
  console.log('==================================================');
  console.log('  ANON PAYMENT TEST SHARDS SETUP');
  console.log('==================================================');
  
  const balance = await connection.getBalance(deployer.publicKey);
  console.log('\nDeployer:', deployer.publicKey.toBase58().slice(0,12) + '...');
  console.log('Balance:', (balance / LAMPORTS_PER_SOL).toFixed(4), 'SOL\n');
  
  // Create dir
  if (!fs.existsSync(SHARDS_DIR)) fs.mkdirSync(SHARDS_DIR, { recursive: true });
  
  let shardsInfo;
  if (fs.existsSync(SHARDS_INFO_PATH)) {
    shardsInfo = JSON.parse(fs.readFileSync(SHARDS_INFO_PATH, 'utf8'));
    console.log('Found', shardsInfo.shards.length, 'existing shards\n');
  } else {
    shardsInfo = { shards: [], createdAt: new Date().toISOString() };
    for (let i = 0; i < NUM_SHARDS; i++) {
      const shard = Keypair.generate();
      const shardPath = path.join(SHARDS_DIR, 'shard_' + i + '.json');
      fs.writeFileSync(shardPath, JSON.stringify(Array.from(shard.secretKey)));
      shardsInfo.shards.push({ index: i, pubkey: shard.publicKey.toBase58(), path: shardPath });
    }
    fs.writeFileSync(SHARDS_INFO_PATH, JSON.stringify(shardsInfo, null, 2));
    console.log('Created', NUM_SHARDS, 'new shards\n');
  }
  
  // Check balances and fund
  const fundTx = new Transaction();
  let needsFunding = 0;
  
  for (const s of shardsInfo.shards) {
    const bal = await connection.getBalance(new PublicKey(s.pubkey));
    const balSol = bal / LAMPORTS_PER_SOL;
    if (balSol < SHARD_FUNDING * 0.5) {
      fundTx.add(SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey: new PublicKey(s.pubkey),
        lamports: Math.floor(SHARD_FUNDING * LAMPORTS_PER_SOL),
      }));
      needsFunding++;
      console.log('Shard', s.index + ':', s.pubkey.slice(0,8) + '... |', balSol.toFixed(4), 'SOL -> NEED FUNDING');
    } else {
      console.log('Shard', s.index + ':', s.pubkey.slice(0,8) + '... |', balSol.toFixed(4), 'SOL OK');
    }
  }
  
  if (fundTx.instructions.length > 0) {
    console.log('\nFunding', needsFunding, 'shards with', (SHARD_FUNDING * needsFunding).toFixed(3), 'SOL...');
    try {
      const sig = await sendAndConfirmTransaction(connection, fundTx, [deployer]);
      console.log('TX:', sig);
      console.log('Explorer: https://solscan.io/tx/' + sig + '?cluster=devnet');
    } catch (e) {
      console.log('Error:', e.message);
    }
  } else {
    console.log('\nAll shards already funded!');
  }
  
  // Final balances
  console.log('\n=== FINAL SHARD BALANCES ===');
  let total = 0;
  for (const s of shardsInfo.shards) {
    const bal = await connection.getBalance(new PublicKey(s.pubkey));
    total += bal / LAMPORTS_PER_SOL;
    console.log('Shard', s.index + ':', (bal / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  }
  console.log('\nTotal:', total.toFixed(4), 'SOL');
  console.log('Max tests at 0.05 SOL each:', Math.floor(total / 0.05));
  console.log('\nHARD LIMIT: 0.05 SOL max per test');
}

main().catch(console.error);

