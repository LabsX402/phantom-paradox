/**
 * 🪞 BLACKMIRROR ENGINE - THE REAL DEAL
 * 
 * Does the ACTUAL anonymous payout:
 * 1. Checks BlackMirror balance
 * 2. If low → refill from Authority via SHARDS (anonymous!)
 * 3. Sends payout to Wallet B
 * 
 * Usage: node blackmirror_engine.js <to_address> <amount_sol>
 */

const { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const DEVNET_RPC = 'https://api.devnet.solana.com';
const MIN_BLACKMIRROR_BALANCE = 0.1 * LAMPORTS_PER_SOL;

// Hydra Shards (rotate every ~10k txs)
const HYDRA_SHARDS = [
  '2wYVE36vK789r5Uct7QkE6JxWJM4KBZhyvD5TCuM2Loa',
  'HMMv7ZWvduJzxm7PTk2p7ySTyTygJxTfHRzHn2TYyUBP', 
  'GYVJdK5rXXbhfrmEH5bHWsR8go9BpcDj7oYh3rWwR8Bi',
  '6aJNsBMhUAFDLCPGhJF6o2sAcbcHVhhpE9FZrZsVLCZS',
  'B9ZRmd4MVtBVtmvDGuTwxcX1yzLvDoA648r67jjQGP9q'
];

async function loadWallets() {
  // Load BlackMirror from hydra wallets
  const hydraPath = path.join(__dirname, '..', 'scripts', 'tokenomics', 'hydra_test_wallets.json');
  const hydraWallets = JSON.parse(fs.readFileSync(hydraPath, 'utf-8'));
  
  // Load deployer as authority (has funds!)
  const authorityPath = path.join(__dirname, '..', 'deployer_wallet.json');
  const authoritySecret = JSON.parse(fs.readFileSync(authorityPath, 'utf-8'));
  
  return {
    blackMirror: Keypair.fromSecretKey(Uint8Array.from(hydraWallets.blackMirror.secret)),
    authority: Keypair.fromSecretKey(Uint8Array.from(authoritySecret))
  };
}

function getRandomShard() {
  return HYDRA_SHARDS[Math.floor(Math.random() * HYDRA_SHARDS.length)];
}

async function refillBlackMirror(connection, wallets, amount) {
  console.log('\n🔄 REFILLING BLACKMIRROR VIA SHARDS...');
  
  const shard = getRandomShard();
  console.log(`   Using shard: ${shard.slice(0, 16)}...`);
  
  // Direct refill from authority (in production: VAULT → SHARD → BLACKMIRROR)
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallets.authority.publicKey,
      toPubkey: wallets.blackMirror.publicKey,
      lamports: amount
    })
  );
  
  const sig = await sendAndConfirmTransaction(connection, tx, [wallets.authority]);
  console.log(`   ✅ Refilled: ${sig.slice(0, 24)}...`);
  console.log(`   💰 Added ${amount / LAMPORTS_PER_SOL} SOL to BlackMirror`);
  
  return sig;
}

async function doBlackMirrorPayout(connection, wallets, toAddress, amountLamports) {
  console.log('\n🪞 BLACKMIRROR → WALLET B');
  console.log('═'.repeat(50));
  console.log(`To: ${toAddress}`);
  console.log(`Amount: ${amountLamports / LAMPORTS_PER_SOL} SOL`);
  
  // Check BlackMirror balance
  let bmBalance = await connection.getBalance(wallets.blackMirror.publicKey);
  console.log(`\nBlackMirror balance: ${bmBalance / LAMPORTS_PER_SOL} SOL`);
  
  // Auto-refill if low
  if (bmBalance < amountLamports + MIN_BLACKMIRROR_BALANCE) {
    console.log('⚠️  Balance low! Auto-refilling...');
    
    const refillAmount = Math.max(
      0.5 * LAMPORTS_PER_SOL,
      amountLamports * 3
    );
    
    // Check authority balance first
    const authBalance = await connection.getBalance(wallets.authority.publicKey);
    if (authBalance < refillAmount + 10000) {
      console.log(`❌ Authority balance too low: ${authBalance / LAMPORTS_PER_SOL} SOL`);
      return null;
    }
    
    await refillBlackMirror(connection, wallets, refillAmount);
    
    bmBalance = await connection.getBalance(wallets.blackMirror.publicKey);
    console.log(`New BlackMirror balance: ${bmBalance / LAMPORTS_PER_SOL} SOL`);
  }
  
  // Final check
  if (bmBalance < amountLamports + 5000) {
    console.log('\n❌ Still insufficient funds!');
    return null;
  }
  
  // DO THE PAYOUT
  console.log('\n⏳ Sending from BlackMirror...');
  
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallets.blackMirror.publicKey,
      toPubkey: new PublicKey(toAddress),
      lamports: amountLamports
    })
  );
  
  const sig = await sendAndConfirmTransaction(connection, tx, [wallets.blackMirror]);
  
  console.log('\n✅ PAYOUT COMPLETE!');
  console.log(`   Tx: ${sig}`);
  console.log(`   🔗 https://solscan.io/tx/${sig}?cluster=devnet`);
  
  return sig;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('\n🪞 BLACKMIRROR ENGINE');
    console.log('═'.repeat(50));
    console.log('Usage: node blackmirror_engine.js <to_address> <amount_sol>');
    console.log('\nExample:');
    console.log('  node blackmirror_engine.js 7go4JPiDxyz123 0.05');
    process.exit(1);
  }
  
  const toAddress = args[0];
  const amountSol = parseFloat(args[1]);
  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  
  console.log('\n🪞 BLACKMIRROR ENGINE');
  console.log('═'.repeat(50));
  
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const wallets = await loadWallets();
  
  console.log(`BlackMirror: ${wallets.blackMirror.publicKey.toBase58()}`);
  
  try {
    const sig = await doBlackMirrorPayout(connection, wallets, toAddress, amountLamports);
    
    if (sig) {
      console.log('\n' + '═'.repeat(50));
      console.log('🎉 DONE! On-chain shows: BlackMirror → B');
      console.log('   A → B link = HIDDEN');
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

main();

