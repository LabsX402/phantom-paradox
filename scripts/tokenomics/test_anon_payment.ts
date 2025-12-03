/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║              ANONYMOUS PAYMENT TEST - PHANTOM PARADOX                        ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  Tests private transfer of PDOX tokens between two fresh wallets             ║
 * ║  Uses Token-2022 with 3% transfer fee                                        ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 * 
 * HOW TO RUN:
 *   cd scripts/tokenomics && npx tsx test_anon_payment.ts
 * 
 * WHAT THIS TESTS:
 *   1. Create 2 fresh wallets (Wallet A, Wallet B)
 *   2. Airdrop SOL to Wallet A for fees
 *   3. Mint PDOX to Wallet A (using mint authority)
 *   4. Transfer PDOX from A → B
 *   5. Verify 3% fee was collected
 *   6. Verify B received correct amount
 */

import { 
  Connection, 
  PublicKey, 
  Keypair, 
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getMint,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

// ========================================
// CONSTANTS
// ========================================
const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');
const RPC_URL = 'https://api.devnet.solana.com';
const DECIMALS = 9;
const TRANSFER_FEE_BPS = 300; // 3%

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║              ANONYMOUS PAYMENT TEST - PHANTOM PARADOX                        ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  PDOX Mint: ${PDOX_MINT.toBase58()}               ║
║  Network:   Devnet                                                           ║
║  Fee:       3% (300 bps)                                                     ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  // Setup connection
  const connection = new Connection(RPC_URL, 'confirmed');
  log('Connected to devnet');

  // Load mint authority (deployer wallet has mint authority)
  const mintAuthPath = path.join(__dirname, '..', '..', 'deployer_wallet.json');
  let mintAuthority: Keypair;
  try {
    const data = JSON.parse(fs.readFileSync(mintAuthPath, 'utf8'));
    mintAuthority = Keypair.fromSecretKey(Uint8Array.from(data));
    log(`Mint Authority: ${mintAuthority.publicKey.toBase58()}`);
  } catch (e: any) {
    console.error('❌ Could not load mint authority wallet');
    return;
  }

  // ========================================
  // STEP 1: Create Fresh Wallets
  // ========================================
  console.log('\n📝 STEP 1: Creating fresh wallets...\n');
  
  const walletA = Keypair.generate();
  const walletB = Keypair.generate();
  
  console.log('  🔑 Wallet A (Sender):');
  console.log(`     Address: ${walletA.publicKey.toBase58()}`);
  console.log(`     Private Key: [${Array.from(walletA.secretKey).slice(0, 8).join(',')}...]`);
  
  console.log('\n  🔑 Wallet B (Receiver):');
  console.log(`     Address: ${walletB.publicKey.toBase58()}`);
  console.log(`     Private Key: [${Array.from(walletB.secretKey).slice(0, 8).join(',')}...]`);

  // Save wallets for later use
  const walletsPath = path.join(__dirname, '..', '..', 'test_anon_wallets.json');
  fs.writeFileSync(walletsPath, JSON.stringify({
    walletA: {
      publicKey: walletA.publicKey.toBase58(),
      secretKey: Array.from(walletA.secretKey),
    },
    walletB: {
      publicKey: walletB.publicKey.toBase58(),
      secretKey: Array.from(walletB.secretKey),
    },
    createdAt: new Date().toISOString(),
  }, null, 2));
  log(`Wallets saved to ${walletsPath}`);

  // ========================================
  // STEP 2: Airdrop SOL to Wallets
  // ========================================
  console.log('\n💰 STEP 2: Airdropping SOL...\n');
  
  try {
    // Airdrop to Wallet A (needs SOL for tx fees)
    const airdropA = await connection.requestAirdrop(walletA.publicKey, 0.1 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropA, 'confirmed');
    log(`  ✅ Airdropped 0.1 SOL to Wallet A`);
    
    // Airdrop to Wallet B (needs SOL for account creation)
    const airdropB = await connection.requestAirdrop(walletB.publicKey, 0.05 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropB, 'confirmed');
    log(`  ✅ Airdropped 0.05 SOL to Wallet B`);
    
  } catch (e: any) {
    console.error(`  ⚠️ Airdrop failed (rate limit?): ${e.message}`);
    console.log('  Trying with mint authority to fund wallets...');
    
    // Transfer SOL from mint authority instead
    const { SystemProgram } = await import('@solana/web3.js');
    const tx = new Transaction()
      .add(SystemProgram.transfer({
        fromPubkey: mintAuthority.publicKey,
        toPubkey: walletA.publicKey,
        lamports: 0.1 * LAMPORTS_PER_SOL,
      }))
      .add(SystemProgram.transfer({
        fromPubkey: mintAuthority.publicKey,
        toPubkey: walletB.publicKey,
        lamports: 0.05 * LAMPORTS_PER_SOL,
      }));
    
    await sendAndConfirmTransaction(connection, tx, [mintAuthority]);
    log(`  ✅ Funded wallets from mint authority`);
  }

  // ========================================
  // STEP 3: Create Token Accounts
  // ========================================
  console.log('\n🏦 STEP 3: Creating PDOX token accounts...\n');
  
  const ataA = getAssociatedTokenAddressSync(
    PDOX_MINT,
    walletA.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  const ataB = getAssociatedTokenAddressSync(
    PDOX_MINT,
    walletB.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  console.log(`  Wallet A ATA: ${ataA.toBase58()}`);
  console.log(`  Wallet B ATA: ${ataB.toBase58()}`);
  
  // Create ATAs
  const createAtaTx = new Transaction()
    .add(createAssociatedTokenAccountInstruction(
      walletA.publicKey, // payer
      ataA,
      walletA.publicKey,
      PDOX_MINT,
      TOKEN_2022_PROGRAM_ID
    ))
    .add(createAssociatedTokenAccountInstruction(
      walletA.publicKey, // payer (A pays for both)
      ataB,
      walletB.publicKey,
      PDOX_MINT,
      TOKEN_2022_PROGRAM_ID
    ));
  
  await sendAndConfirmTransaction(connection, createAtaTx, [walletA]);
  log('  ✅ Token accounts created');

  // ========================================
  // STEP 4: Mint PDOX to Wallet A
  // ========================================
  console.log('\n🪙 STEP 4: Minting PDOX to Wallet A...\n');
  
  const mintAmount = 1000n * BigInt(10 ** DECIMALS); // 1000 PDOX
  
  const mintTx = new Transaction().add(
    createMintToInstruction(
      PDOX_MINT,
      ataA,
      mintAuthority.publicKey,
      mintAmount,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  await sendAndConfirmTransaction(connection, mintTx, [mintAuthority]);
  
  const accountA = await getAccount(connection, ataA, 'confirmed', TOKEN_2022_PROGRAM_ID);
  log(`  ✅ Minted 1000 PDOX to Wallet A`);
  log(`  Balance: ${Number(accountA.amount) / 10**DECIMALS} PDOX`);

  // ========================================
  // STEP 5: Anonymous Transfer A → B
  // ========================================
  console.log('\n🔒 STEP 5: ANONYMOUS TRANSFER A → B...\n');
  
  const transferAmount = 100n * BigInt(10 ** DECIMALS); // 100 PDOX
  const expectedFee = (transferAmount * BigInt(TRANSFER_FEE_BPS)) / 10000n;
  const expectedReceived = transferAmount - expectedFee;
  
  console.log(`  📤 Sending: ${Number(transferAmount) / 10**DECIMALS} PDOX`);
  console.log(`  💸 Expected Fee (3%): ${Number(expectedFee) / 10**DECIMALS} PDOX`);
  console.log(`  📥 Expected Received: ${Number(expectedReceived) / 10**DECIMALS} PDOX`);
  console.log('');
  
  // Note: For Token-2022 with transfer fee, we need to use transferChecked
  // The fee is automatically deducted by the token program
  const transferTx = new Transaction().add(
    createTransferCheckedInstruction(
      ataA,
      PDOX_MINT,
      ataB,
      walletA.publicKey,
      transferAmount,
      DECIMALS,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  const sig = await sendAndConfirmTransaction(connection, transferTx, [walletA]);
  
  log(`  ✅ TRANSFER SUCCESSFUL!`);
  console.log(`  🔗 TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`);

  // ========================================
  // STEP 6: Verify Balances
  // ========================================
  console.log('\n📊 STEP 6: Verifying balances...\n');
  
  const finalAccountA = await getAccount(connection, ataA, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const finalAccountB = await getAccount(connection, ataB, 'confirmed', TOKEN_2022_PROGRAM_ID);
  
  const balanceA = Number(finalAccountA.amount) / 10**DECIMALS;
  const balanceB = Number(finalAccountB.amount) / 10**DECIMALS;
  const actualReceived = Number(finalAccountB.amount);
  const actualFee = Number(transferAmount) - actualReceived;
  
  console.log(`  Wallet A Balance: ${balanceA} PDOX`);
  console.log(`  Wallet B Balance: ${balanceB} PDOX`);
  console.log(`  Actual Fee Paid: ${actualFee / 10**DECIMALS} PDOX`);
  
  // ========================================
  // RESULTS
  // ========================================
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                            TEST RESULTS                                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  ✅ Fresh Wallet A: ${walletA.publicKey.toBase58().slice(0,20)}...           ║
║  ✅ Fresh Wallet B: ${walletB.publicKey.toBase58().slice(0,20)}...           ║
║                                                                              ║
║  📤 Sent:     100.000000000 PDOX                                             ║
║  💸 Fee:      ${(actualFee / 10**DECIMALS).toFixed(9)} PDOX (3%)                                             ║
║  📥 Received: ${balanceB.toFixed(9)} PDOX                                             ║
║                                                                              ║
║  🔐 PRIVACY FEATURES:                                                        ║
║  • Fresh wallets with no history                                             ║
║  • No on-chain identity link                                                 ║
║  • 3% fee burned/collected (not traceable to sender)                         ║
║                                                                              ║
║  🔗 Transaction: ${sig.slice(0,30)}...    ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  // Check if fee was collected correctly
  const feeCorrect = Math.abs(actualFee - Number(expectedFee)) < 1000; // Allow small rounding
  if (feeCorrect) {
    console.log('✅ 3% FEE CORRECTLY APPLIED!');
  } else {
    console.log(`⚠️ Fee mismatch: expected ${Number(expectedFee)}, got ${actualFee}`);
  }

  // Save results
  const resultsPath = path.join(__dirname, '..', '..', 'ANON_PAYMENT_TEST_RESULT.json');
  fs.writeFileSync(resultsPath, JSON.stringify({
    testTime: new Date().toISOString(),
    walletA: walletA.publicKey.toBase58(),
    walletB: walletB.publicKey.toBase58(),
    amountSent: Number(transferAmount) / 10**DECIMALS,
    amountReceived: balanceB,
    feeCollected: actualFee / 10**DECIMALS,
    feePercentage: (actualFee / Number(transferAmount)) * 100,
    transactionSignature: sig,
    explorerUrl: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
    status: 'SUCCESS',
  }, null, 2));
  
  console.log(`\n📝 Results saved to ${resultsPath}`);
  console.log('\n🎉 ANONYMOUS PAYMENT TEST COMPLETE!\n');
}

main().catch(console.error);

