/**
 * FUND BLACKMIRROR POOL
 * Sends SOL from server_authority to BlackMirror pool
 * 
 * Usage: node scripts/fund_blackmirror.js [amount_sol]
 */

const { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const DEVNET_RPC = 'https://api.devnet.solana.com';
const BLACKMIRROR = '6wzwyfEddfyNnnXrBrjKNv9w5HRvAzFopKnnmrWZkMqH';

async function main() {
  const amount = parseFloat(process.argv[2] || '0.5'); // Default 0.5 SOL
  
  console.log('\n💰 FUND BLACKMIRROR POOL');
  console.log('═'.repeat(50));
  
  // Load server authority
  const authorityPath = path.join(__dirname, '..', 'server_authority_wallet.json');
  const authoritySecret = JSON.parse(fs.readFileSync(authorityPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(authoritySecret));
  
  console.log(`From: ${authority.publicKey.toBase58()}`);
  console.log(`To: ${BLACKMIRROR} (BlackMirror)`);
  console.log(`Amount: ${amount} SOL`);
  
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  
  // Check balances
  const authorityBalance = await connection.getBalance(authority.publicKey);
  const blackMirrorBalance = await connection.getBalance(new PublicKey(BLACKMIRROR));
  
  console.log(`\nAuthority balance: ${authorityBalance / LAMPORTS_PER_SOL} SOL`);
  console.log(`BlackMirror balance: ${blackMirrorBalance / LAMPORTS_PER_SOL} SOL`);
  
  const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
  
  if (authorityBalance < lamports + 5000) {
    console.log('\n❌ Insufficient funds in authority wallet!');
    process.exit(1);
  }
  
  // Create transfer
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: new PublicKey(BLACKMIRROR),
      lamports: lamports
    })
  );
  
  console.log('\n⏳ Sending...');
  
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log('\n✅ FUNDED!');
    console.log(`   Signature: ${sig}`);
    console.log(`   Explorer: https://solscan.io/tx/${sig}?cluster=devnet`);
    
    const newBalance = await connection.getBalance(new PublicKey(BLACKMIRROR));
    console.log(`\nNew BlackMirror balance: ${newBalance / LAMPORTS_PER_SOL} SOL`);
  } catch (error) {
    console.log('\n❌ Failed:', error.message);
  }
}

main();

