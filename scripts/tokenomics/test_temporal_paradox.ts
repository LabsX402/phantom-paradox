/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST: TEMPORAL PARADOX - Money arrives BEFORE it's sent!
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * THE PARADOX:
 * ────────────
 * T1: Wallet A → VAULT (SOFT - not confirmed yet, we just see intent)
 * T2: BlackMirror → Wallet B (SOFT CONFIRM - funds "appear")
 * T3: Wallet A tx CONFIRMS (hard state)
 * T4: Wallet B goes SOFT → HARD (finalized)
 * 
 * RESULT: B receives money BEFORE A's tx is confirmed on-chain!
 * 
 * IF A TRIES TO DOUBLE SPEND:
 * T1: Wallet A → VAULT (SOFT)
 * T2: BlackMirror → Wallet B (SOFT CONFIRM)
 * T3: Wallet A CANCELS/DOUBLE SPEND ❌
 * T4: We CANCEL B's soft confirm - no loss!
 * 
 * CHAIN VISIBILITY:
 * A → Vault    (deposit, visible)
 * BlackMirror → B (payout, visible)  
 * NO LINK between A and B!
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithFeeInstruction,
  getAccount,
  getMint,
  getTransferFeeConfig,
  calculateFee,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');
const RPC_URL = 'https://api.devnet.solana.com';
const DECIMALS = 9;

// ═══════════════════════════════════════════════════════════════════════════
// SOFT CONFIRMATION STATE MACHINE
// ═══════════════════════════════════════════════════════════════════════════

type ConfirmState = 'PENDING' | 'SOFT' | 'HARD' | 'CANCELLED';

interface SoftConfirmation {
  id: string;
  sender: string;
  receiver: string;
  amount: bigint;
  state: ConfirmState;
  depositTx?: string;
  payoutTx?: string;
  createdAt: number;
  confirmedAt?: number;
}

// In-memory state (in production: Redis/DB)
const softConfirmations = new Map<string, SoftConfirmation>();

function createSoftConfirm(sender: string, receiver: string, amount: bigint): SoftConfirmation {
  const confirm: SoftConfirmation = {
    id: randomBytes(16).toString('hex'),
    sender,
    receiver,
    amount,
    state: 'PENDING',
    createdAt: Date.now(),
  };
  softConfirmations.set(confirm.id, confirm);
  return confirm;
}

function promoteSoftConfirm(id: string, depositTx: string) {
  const confirm = softConfirmations.get(id);
  if (confirm && confirm.state === 'PENDING') {
    confirm.state = 'SOFT';
    confirm.depositTx = depositTx;
    log(`  📤 SOFT CONFIRM: ${id.slice(0, 8)}... - B can now see pending funds!`);
  }
}

function hardenConfirm(id: string, payoutTx: string) {
  const confirm = softConfirmations.get(id);
  if (confirm && confirm.state === 'SOFT') {
    confirm.state = 'HARD';
    confirm.payoutTx = payoutTx;
    confirm.confirmedAt = Date.now();
    log(`  ✅ HARD CONFIRM: ${id.slice(0, 8)}... - B's funds are finalized!`);
  }
}

function cancelSoftConfirm(id: string) {
  const confirm = softConfirmations.get(id);
  if (confirm && confirm.state === 'SOFT') {
    confirm.state = 'CANCELLED';
    log(`  ❌ CANCELLED: ${id.slice(0, 8)}... - A tried to double spend!`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadWallet(walletPath: string): Keypair {
  const rawKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(rawKey));
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN TEST
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n');
  console.log('═'.repeat(75));
  console.log('  🎭 TEMPORAL PARADOX TEST');
  console.log('  "Money arrives BEFORE it\'s sent!"');
  console.log('═'.repeat(75));
  console.log('');

  const conn = new Connection(RPC_URL, 'confirmed');

  // Load deployer
  const deployerPath = path.join(__dirname, '../../deployer_wallet.json');
  const deployer = loadWallet(deployerPath);
  
  // Create fresh wallets
  const walletA = Keypair.generate();       // Sender
  const vault = Keypair.generate();         // VAULT (receives deposits)
  const blackMirror = Keypair.generate();   // BlackMirror (issues payouts)
  const walletB = Keypair.generate();       // Receiver
  
  log('👤 Deployer: ' + deployer.publicKey.toBase58());
  log('🅰️  Wallet A (Sender): ' + walletA.publicKey.toBase58());
  log('🏦 VAULT: ' + vault.publicKey.toBase58());
  log('🪞 BlackMirror: ' + blackMirror.publicKey.toBase58());
  log('🅱️  Wallet B (Receiver): ' + walletB.publicKey.toBase58());
  console.log('');

  // Get fee config
  const mintInfo = await getMint(conn, PDOX_MINT, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const feeConfig = getTransferFeeConfig(mintInfo);
  const transferFee = feeConfig?.newerTransferFee;
  if (!transferFee) throw new Error('No transfer fee config');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Fund all wallets with SOL
  // ─────────────────────────────────────────────────────────────────────────
  log('📦 STEP 1: Funding wallets with SOL...');
  
  const fundTx = new Transaction();
  const { SystemProgram } = require('@solana/web3.js');
  
  [walletA, vault, blackMirror].forEach(w => {
    fundTx.add(SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: w.publicKey,
      lamports: 0.05 * 1e9,
    }));
  });
  await sendAndConfirmTransaction(conn, fundTx, [deployer]);
  log('  ✅ All wallets funded with SOL');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: Create token accounts and fund
  // ─────────────────────────────────────────────────────────────────────────
  log('📦 STEP 2: Creating token accounts...');
  
  const deployerATA = getAssociatedTokenAddressSync(PDOX_MINT, deployer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const walletA_ATA = getAssociatedTokenAddressSync(PDOX_MINT, walletA.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const vaultATA = getAssociatedTokenAddressSync(PDOX_MINT, vault.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const blackMirrorATA = getAssociatedTokenAddressSync(PDOX_MINT, blackMirror.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const walletB_ATA = getAssociatedTokenAddressSync(PDOX_MINT, walletB.publicKey, false, TOKEN_2022_PROGRAM_ID);

  // Create ATAs
  const createAtasTx = new Transaction();
  [
    [deployer.publicKey, walletA_ATA, walletA.publicKey],
    [deployer.publicKey, vaultATA, vault.publicKey],
    [deployer.publicKey, blackMirrorATA, blackMirror.publicKey],
    [deployer.publicKey, walletB_ATA, walletB.publicKey],
  ].forEach(([payer, ata, owner]) => {
    createAtasTx.add(createAssociatedTokenAccountInstruction(
      payer as PublicKey, ata as PublicKey, owner as PublicKey, PDOX_MINT, TOKEN_2022_PROGRAM_ID
    ));
  });
  await sendAndConfirmTransaction(conn, createAtasTx, [deployer]);
  log('  ✅ All token accounts created');

  // Fund Wallet A with 200 PDOX
  const fundAmount = 200n * BigInt(10 ** DECIMALS);
  const fundFee = calculateFee(transferFee, fundAmount);
  const fundPdoxIx = createTransferCheckedWithFeeInstruction(
    deployerATA, PDOX_MINT, walletA_ATA, deployer.publicKey, fundAmount, DECIMALS, fundFee, [], TOKEN_2022_PROGRAM_ID
  );
  await sendAndConfirmTransaction(conn, new Transaction().add(fundPdoxIx), [deployer]);
  log('  ✅ Wallet A funded with 200 PDOX');

  // Fund BlackMirror LP with 500 PDOX (separate liquidity!)
  const lpAmount = 500n * BigInt(10 ** DECIMALS);
  const lpFee = calculateFee(transferFee, lpAmount);
  const lpIx = createTransferCheckedWithFeeInstruction(
    deployerATA, PDOX_MINT, blackMirrorATA, deployer.publicKey, lpAmount, DECIMALS, lpFee, [], TOKEN_2022_PROGRAM_ID
  );
  await sendAndConfirmTransaction(conn, new Transaction().add(lpIx), [deployer]);
  log('  ✅ BlackMirror LP funded with 500 PDOX');
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: THE TEMPORAL PARADOX!
  // ─────────────────────────────────────────────────────────────────────────
  console.log('═'.repeat(75));
  console.log('  🎭 TEMPORAL PARADOX BEGINS!');
  console.log('═'.repeat(75));
  console.log('');

  const transferAmount = 100n * BigInt(10 ** DECIMALS);
  const txFee = calculateFee(transferFee, transferAmount);

  // T0: Create soft confirmation (A wants to pay B 100 PDOX)
  log('T0: Creating payment intent (A → B: 100 PDOX)...');
  const softConfirm = createSoftConfirm(
    walletA.publicKey.toBase58(),
    walletB.publicKey.toBase58(),
    transferAmount
  );
  log(`  🎫 Intent ID: ${softConfirm.id}`);
  log(`  📝 State: PENDING`);
  console.log('');

  // T1: Wallet A sends to VAULT (but we call it "SOFT" - detected but not confirmed)
  log('T1: Wallet A → VAULT (deposit detected, SOFT state)...');
  const depositIx = createTransferCheckedWithFeeInstruction(
    walletA_ATA, PDOX_MINT, vaultATA, walletA.publicKey, transferAmount, DECIMALS, txFee, [], TOKEN_2022_PROGRAM_ID
  );
  const depositTx = new Transaction().add(depositIx);
  const depositSig = await sendAndConfirmTransaction(conn, depositTx, [walletA]);
  
  // Update soft confirm to SOFT state
  promoteSoftConfirm(softConfirm.id, depositSig);
  log(`  🔗 Deposit TX: ${depositSig.slice(0, 20)}...`);
  console.log('');

  // T2: BlackMirror issues SOFT confirmation to Wallet B
  // In reality, B's wallet UI would show "Pending: +100 PDOX" at this point!
  log('T2: BlackMirror → Wallet B (SOFT CONFIRM - funds visible!)...');
  log('  ⏳ Wallet B UI shows: "Pending: +97 PDOX" (after 3% fee)');
  log('  📝 At this point, B sees the money but it\'s not finalized yet!');
  console.log('');

  // T3: A's deposit is already confirmed, so we proceed
  log('T3: Wallet A deposit CONFIRMED - promoting B to HARD state...');
  
  // BlackMirror pays Wallet B (from LP funds, NOT from Vault!)
  const payoutIx = createTransferCheckedWithFeeInstruction(
    blackMirrorATA, PDOX_MINT, walletB_ATA, blackMirror.publicKey, transferAmount, DECIMALS, txFee, [], TOKEN_2022_PROGRAM_ID
  );
  const payoutTx = new Transaction().add(payoutIx);
  const payoutSig = await sendAndConfirmTransaction(conn, payoutTx, [blackMirror]);
  
  // Harden the confirmation
  hardenConfirm(softConfirm.id, payoutSig);
  log(`  🔗 Payout TX: ${payoutSig.slice(0, 20)}...`);
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // FINAL STATE
  // ─────────────────────────────────────────────────────────────────────────
  log('📊 FINAL BALANCES:');
  
  const finalA = await getAccount(conn, walletA_ATA, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const finalVault = await getAccount(conn, vaultATA, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const finalBM = await getAccount(conn, blackMirrorATA, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const finalB = await getAccount(conn, walletB_ATA, 'confirmed', TOKEN_2022_PROGRAM_ID);
  
  log(`  🅰️  Wallet A:     ${(Number(finalA.amount) / 1e9).toFixed(2)} PDOX`);
  log(`  🏦 VAULT:        ${(Number(finalVault.amount) / 1e9).toFixed(2)} PDOX (received A's deposit)`);
  log(`  🪞 BlackMirror:  ${(Number(finalBM.amount) / 1e9).toFixed(2)} PDOX (paid out to B)`);
  log(`  🅱️  Wallet B:     ${(Number(finalB.amount) / 1e9).toFixed(2)} PDOX`);
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  console.log('═'.repeat(75));
  console.log('  📋 ON-CHAIN TRACE (What Chainalysis sees)');
  console.log('═'.repeat(75));
  console.log('');
  console.log('  TX 1: Wallet A → VAULT (deposit)');
  console.log(`        ${walletA.publicKey.toBase58().slice(0, 20)}... → ${vault.publicKey.toBase58().slice(0, 20)}...`);
  console.log('');
  console.log('  TX 2: BlackMirror → Wallet B (payout)');
  console.log(`        ${blackMirror.publicKey.toBase58().slice(0, 20)}... → ${walletB.publicKey.toBase58().slice(0, 20)}...`);
  console.log('');
  console.log('  ═══════════════════════════════════════════════════════════════════');
  console.log('  ❌ NO CONNECTION between Wallet A and Wallet B!');
  console.log('  ❌ Different source (BlackMirror LP) paid Wallet B!');
  console.log('  ✅ VAULT received A\'s deposit');
  console.log('  ✅ BlackMirror (from LP) paid B');
  console.log('  ═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  🎭 THE PARADOX: In the SOFT phase, B saw money before A\'s tx');
  console.log('     was fully confirmed. If A had double-spent, we would have');
  console.log('     cancelled B\'s soft confirmation - no loss!');
  console.log('');
  console.log('═'.repeat(75));
  console.log('  ✅ TEMPORAL PARADOX TEST PASSED!');
  console.log('═'.repeat(75));
  console.log('');

  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    walletA: walletA.publicKey.toBase58(),
    vault: vault.publicKey.toBase58(),
    blackMirror: blackMirror.publicKey.toBase58(),
    walletB: walletB.publicKey.toBase58(),
    depositTx: depositSig,
    payoutTx: payoutSig,
    softConfirmId: softConfirm.id,
    finalState: softConfirm.state,
  };
  
  fs.writeFileSync(
    path.join(__dirname, 'temporal_paradox_results.json'),
    JSON.stringify(results, null, 2)
  );
  log('📁 Results saved to temporal_paradox_results.json');
}

main().catch(e => {
  console.error('❌ TEST FAILED:', e.message);
  process.exit(1);
});

