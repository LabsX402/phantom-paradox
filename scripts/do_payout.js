/**
 * BLACKMIRROR PAYOUT SCRIPT
 * Run this to actually send payment from BlackMirror to Wallet B
 * 
 * Usage: node scripts/do_payout.js <to_address> <amount_lamports>
 */

const { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const DEVNET_RPC = 'https://api.devnet.solana.com';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node scripts/do_payout.js <to_address> <amount_lamports>');
    console.log('Example: node scripts/do_payout.js 7go4JPiD...GbRKiC65 50000000');
    process.exit(1);
  }
  
  const toAddress = args[0];
  const amountLamports = parseInt(args[1]);
  
  console.log('\n🪞 BLACKMIRROR PAYOUT');
  console.log('═'.repeat(50));
  
  // Load BlackMirror wallet
  const walletsPath = path.join(__dirname, 'tokenomics', 'hydra_test_wallets.json');
  const wallets = JSON.parse(fs.readFileSync(walletsPath, 'utf-8'));
  const blackMirror = Keypair.fromSecretKey(Uint8Array.from(wallets.blackMirror.secret));
  
  console.log(`BlackMirror: ${blackMirror.publicKey.toBase58()}`);
  console.log(`To: ${toAddress}`);
  console.log(`Amount: ${amountLamports} lamports (${amountLamports / LAMPORTS_PER_SOL} SOL)`);
  
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  
  // Check BlackMirror balance
  const balance = await connection.getBalance(blackMirror.publicKey);
  console.log(`\nBlackMirror balance: ${balance} lamports (${balance / LAMPORTS_PER_SOL} SOL)`);
  
  if (balance < amountLamports + 5000) {
    console.log('\n❌ Insufficient funds in BlackMirror!');
    console.log('   Need to fund BlackMirror first.');
    process.exit(1);
  }
  
  // Create payout transaction
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: blackMirror.publicKey,
      toPubkey: new PublicKey(toAddress),
      lamports: amountLamports
    })
  );
  
  console.log('\n⏳ Sending payout...');
  
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [blackMirror]);
    console.log('\n✅ PAYOUT COMPLETE!');
    console.log(`   Signature: ${sig}`);
    console.log(`   Explorer: https://solscan.io/tx/${sig}?cluster=devnet`);
  } catch (error) {
    console.log('\n❌ Payout failed:', error.message);
  }
}

main();

