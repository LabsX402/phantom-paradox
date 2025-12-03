/**
 * Send ALL remaining PDOX from Wallet A to Wallet B
 */

import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAccount, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, createTransferCheckedInstruction } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');

async function main() {
  console.log('\n🔄 SENDING ALL PDOX FROM WALLET A → WALLET B\n');
  
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Load Wallet A
  const walletsPath = path.join(__dirname, '..', '..', 'test_anon_wallets.json');
  const walletsData = JSON.parse(fs.readFileSync(walletsPath, 'utf8'));
  const walletA = Keypair.fromSecretKey(Uint8Array.from(walletsData.walletA.secretKey));
  const walletBPubkey = new PublicKey(walletsData.walletB.publicKey);
  
  console.log('Wallet A:', walletA.publicKey.toBase58());
  console.log('Wallet B:', walletBPubkey.toBase58());
  
  const ataA = getAssociatedTokenAddressSync(PDOX_MINT, walletA.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const ataB = getAssociatedTokenAddressSync(PDOX_MINT, walletBPubkey, false, TOKEN_2022_PROGRAM_ID);
  
  // Check balances before
  const accA = await getAccount(conn, ataA, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const accB = await getAccount(conn, ataB, 'confirmed', TOKEN_2022_PROGRAM_ID);
  
  const balanceABefore = Number(accA.amount) / 1e9;
  const balanceBBefore = Number(accB.amount) / 1e9;
  
  console.log('\n📊 BEFORE:');
  console.log(`   Wallet A: ${balanceABefore} PDOX`);
  console.log(`   Wallet B: ${balanceBBefore} PDOX`);
  
  if (accA.amount === 0n) {
    console.log('\n❌ Wallet A has no PDOX to send!');
    return;
  }
  
  const amountToSend = accA.amount; // Send ALL
  console.log(`\n📤 Sending ALL ${Number(amountToSend) / 1e9} PDOX...`);
  
  const tx = new Transaction().add(
    createTransferCheckedInstruction(
      ataA, 
      PDOX_MINT, 
      ataB, 
      walletA.publicKey, 
      amountToSend, 
      9, 
      [], 
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  const sig = await sendAndConfirmTransaction(conn, tx, [walletA]);
  
  console.log('\n✅ TRANSFER COMPLETE!');
  console.log(`   TX: ${sig}`);
  console.log(`   🔗 https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  
  // Check balances after
  const accA2 = await getAccount(conn, ataA, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const accB2 = await getAccount(conn, ataB, 'confirmed', TOKEN_2022_PROGRAM_ID);
  
  const balanceAAfter = Number(accA2.amount) / 1e9;
  const balanceBAfter = Number(accB2.amount) / 1e9;
  const received = balanceBAfter - balanceBBefore;
  const feeCollected = Number(amountToSend) / 1e9 - received;
  
  console.log('\n📊 AFTER:');
  console.log(`   Wallet A: ${balanceAAfter} PDOX`);
  console.log(`   Wallet B: ${balanceBAfter} PDOX`);
  
  console.log('\n💰 SUMMARY:');
  console.log(`   Sent:     ${Number(amountToSend) / 1e9} PDOX`);
  console.log(`   Received: ${received} PDOX`);
  console.log(`   Fee:      ${feeCollected} PDOX (${((feeCollected / (Number(amountToSend) / 1e9)) * 100).toFixed(2)}%)`);
  
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    ANONYMOUS TRANSFER COMPLETE! 🎉                           ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  Wallet A (empty):  ${walletA.publicKey.toBase58().slice(0,20)}... → 0 PDOX       ║
║  Wallet B (full):   ${walletBPubkey.toBase58().slice(0,20)}... → ${balanceBAfter.toFixed(0)} PDOX    ║
║                                                                              ║
║  📤 Total Sent:     ${(Number(amountToSend) / 1e9).toFixed(0)} PDOX                                          ║
║  📥 Total Received: ${received.toFixed(0)} PDOX                                          ║
║  💸 Total Fee:      ${feeCollected.toFixed(0)} PDOX                                           ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
}

main().catch(console.error);

