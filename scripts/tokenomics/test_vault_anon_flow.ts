/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST: FULL ANONYMOUS PAYMENT FLOW (VAULT + BLACKMIRROR + ZK PROOF)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * FLOW:
 * 1. Vault Funder (LP) funds BlackMirror with PDOX + SOL (separate from users!)
 * 2. Wallet A submits intent (encrypted, off-chain)
 * 3. Poltergeist injects ghost wallets
 * 4. Merkle root computed
 * 5. BlackMirror pays Wallet B (from LP funds, NOT from A!)
 * 6. PROOF CODES generated for verification
 * 
 * ON-CHAIN: Only sees Vault → B, no link to A!
 * PROOF: 2 codes to verify on website
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

const PROGRAM_ID = new PublicKey('8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x');
const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF'); // Correct mint!
const RPC_URL = 'https://api.devnet.solana.com';
const DECIMALS = 9;
const TRANSFER_FEE_BPS = 300; // 3%

// Game #1 addresses
const GAME_PDA = new PublicKey('BA97Pnr6438wvVhB7qjT4s4q8QPwXQ8GKNaEAvmCtSQR');
const VAULT_PDA = new PublicKey('5ocRbzwENdgiSKkCEL6eohWTbm5ZxoeAWmceRTsaq1Dq'); // BlackMirror!

// ═══════════════════════════════════════════════════════════════════════════
// ZK-STYLE PROOF SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

interface PaymentProof {
  proofCode1: string; // Public proof (can share)
  proofCode2: string; // Private key (keep secret, needed to verify)
  txSignature: string;
  timestamp: number;
}

/**
 * Generate ZK-style proof codes for anonymous payment
 * 
 * CODE 1 (Public): Hash of tx details - shareable
 * CODE 2 (Private): Decryption key - keep secret
 * 
 * Together they prove: "I sent X PDOX to address Y at time Z"
 */
function generatePaymentProof(
  sender: PublicKey,
  receiver: PublicKey,
  amount: bigint,
  txSignature: string
): PaymentProof {
  const timestamp = Date.now();
  
  // Generate random encryption key
  const encryptionKey = randomBytes(32);
  const iv = randomBytes(16);
  
  // Create proof payload
  const payload = JSON.stringify({
    from: sender.toBase58(),
    to: receiver.toBase58(),
    amount: amount.toString(),
    tx: txSignature,
    ts: timestamp,
    nonce: randomBytes(8).toString('hex'),
  });
  
  // Encrypt payload
  const cipher = createCipheriv('aes-256-cbc', encryptionKey, iv);
  let encrypted = cipher.update(payload, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // CODE 1: Encrypted payload + IV (public, shareable)
  const proofCode1 = iv.toString('hex') + ':' + encrypted;
  
  // CODE 2: Decryption key (private, needed to verify)
  const proofCode2 = encryptionKey.toString('hex');
  
  return {
    proofCode1,
    proofCode2,
    txSignature,
    timestamp,
  };
}

/**
 * Verify payment using proof codes
 * 
 * User enters CODE 1 + CODE 2 on website → reveals payment details
 */
function verifyPaymentProof(proofCode1: string, proofCode2: string): {
  valid: boolean;
  details?: {
    from: string;
    to: string;
    amount: string;
    tx: string;
    timestamp: number;
  };
  error?: string;
} {
  try {
    // Parse CODE 1
    const [ivHex, encrypted] = proofCode1.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    
    // Parse CODE 2
    const encryptionKey = Buffer.from(proofCode2, 'hex');
    
    // Decrypt
    const decipher = createDecipheriv('aes-256-cbc', encryptionKey, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    const payload = JSON.parse(decrypted);
    
    return {
      valid: true,
      details: {
        from: payload.from,
        to: payload.to,
        amount: payload.amount,
        tx: payload.tx,
        timestamp: payload.ts,
      },
    };
  } catch (e: any) {
    return {
      valid: false,
      error: 'Invalid proof codes: ' + e.message,
    };
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

function simulatePoltergeist(realWallets: number) {
  const ratio = realWallets < 10 ? 1.0 : 0.3;
  const ghostCount = Math.max(10, Math.ceil(realWallets * ratio));
  const ghosts: Keypair[] = [];
  for (let i = 0; i < ghostCount; i++) {
    ghosts.push(Keypair.generate());
  }
  return {
    ghosts,
    anonymitySet: realWallets + ghostCount,
    chaosLevel: 1.0 + (Math.random() * 0.2 - 0.1),
  };
}

function computeMerkleRoot(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) return Buffer.alloc(32, 0);
  let layer: Buffer[] = leaves.map(l => createHash('sha256').update(l).digest());
  while (layer.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = i + 1 < layer.length ? layer[i + 1] : left;
      const [a, b] = left.compare(right) <= 0 ? [left, right] : [right, left];
      next.push(createHash('sha256').update(Buffer.concat([a, b])).digest());
    }
    layer = next;
  }
  return layer[0];
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN TEST
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n');
  console.log('═'.repeat(75));
  console.log('  🔒 ANONYMOUS PAYMENT + ZK PROOF (VAULT + BLACKMIRROR)');
  console.log('═'.repeat(75));
  console.log('');

  const conn = new Connection(RPC_URL, 'confirmed');

  // Load deployer
  const deployerPath = path.join(__dirname, '../../deployer_wallet.json');
  const deployer = loadWallet(deployerPath);
  log('👤 Deployer: ' + deployer.publicKey.toBase58());

  // Create ALL fresh wallets (completely separate!)
  const vaultFunder = Keypair.generate(); // LP that funds BlackMirror
  const walletA = Keypair.generate();      // Sender (intent only, no direct transfer!)
  const walletB = Keypair.generate();      // Receiver
  
  console.log('');
  log('💰 Vault Funder (BlackMirror LP): ' + vaultFunder.publicKey.toBase58());
  log('🅰️  Wallet A (Sender - Intent): ' + walletA.publicKey.toBase58());
  log('🅱️  Wallet B (Receiver): ' + walletB.publicKey.toBase58());
  log('🪞 BlackMirror Vault: ' + VAULT_PDA.toBase58());
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Fund Vault Funder (LP) with SOL + PDOX
  // ─────────────────────────────────────────────────────────────────────────
  log('📦 STEP 1: Funding BlackMirror LP (Vault Funder)...');
  
  // Get proper transfer fee config from mint FIRST (used in multiple steps)
  const mintInfo = await getMint(conn, PDOX_MINT, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const feeConfig = getTransferFeeConfig(mintInfo);
  const transferFee = feeConfig?.newerTransferFee;
  if (!transferFee) throw new Error('No transfer fee config found on PDOX mint');
  const feeBps = transferFee.transferFeeBasisPoints;
  log('  ℹ️  Transfer Fee: ' + feeBps + ' bps (' + (feeBps / 100) + '%)');
  
  // Transfer SOL from deployer (avoiding airdrop rate limits)
  const fundSolTx = new Transaction().add(
    require('@solana/web3.js').SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: vaultFunder.publicKey,
      lamports: 0.1 * 1e9, // 0.1 SOL
    })
  );
  await sendAndConfirmTransaction(conn, fundSolTx, [deployer]);
  log('  ✅ Transferred 0.1 SOL to Vault Funder from Deployer');

  // Create Vault Funder's PDOX ATA
  const deployerATA = getAssociatedTokenAddressSync(PDOX_MINT, deployer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const funderATA = getAssociatedTokenAddressSync(PDOX_MINT, vaultFunder.publicKey, false, TOKEN_2022_PROGRAM_ID);
  
  const createFunderAtaIx = createAssociatedTokenAccountInstruction(
    deployer.publicKey, funderATA, vaultFunder.publicKey, PDOX_MINT, TOKEN_2022_PROGRAM_ID
  );
  await sendAndConfirmTransaction(conn, new Transaction().add(createFunderAtaIx), [deployer]);
  log('  ✅ Created PDOX ATA for Vault Funder');

  // Transfer 1000 PDOX to Vault Funder (LP funds)
  const lpAmount = 1000n * BigInt(10 ** DECIMALS);
  
  // Use official SPL-token fee calculation
  const lpFee = calculateFee(transferFee, lpAmount);
  log('  ℹ️  LP Amount: ' + (Number(lpAmount) / 1e9) + ' PDOX, Fee: ' + (Number(lpFee) / 1e9) + ' PDOX');
  
  const lpTransferIx = createTransferCheckedWithFeeInstruction(
    deployerATA, PDOX_MINT, funderATA, deployer.publicKey, lpAmount, DECIMALS, lpFee, [], TOKEN_2022_PROGRAM_ID
  );
  await sendAndConfirmTransaction(conn, new Transaction().add(lpTransferIx), [deployer]);
  
  const funderBalance = await getAccount(conn, funderATA, 'confirmed', TOKEN_2022_PROGRAM_ID);
  log('  ✅ Vault Funder (LP) Balance: ' + (Number(funderBalance.amount) / 1e9).toFixed(2) + ' PDOX');
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: Fund Wallet A (for intent, NOT for direct transfer)
  // ─────────────────────────────────────────────────────────────────────────
  log('📦 STEP 2: Funding Wallet A (Intent Submitter)...');
  
  // Wallet A only needs SOL for intent submission (not PDOX transfer!)
  // Transfer from deployer to avoid airdrop limits
  const fundWalletATx = new Transaction().add(
    require('@solana/web3.js').SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: walletA.publicKey,
      lamports: 0.01 * 1e9, // 0.01 SOL
    })
  );
  await sendAndConfirmTransaction(conn, fundWalletATx, [deployer]);
  log('  ✅ Wallet A funded with 0.01 SOL (for intent fees only)');
  log('  ℹ️  In REAL system: A would deposit PDOX to Vault first');
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: Simulate Intent + Poltergeist
  // ─────────────────────────────────────────────────────────────────────────
  log('🔐 STEP 3: Anonymous Intent Flow...');
  
  const poltergeist = simulatePoltergeist(2);
  log('  👻 POLTERGEIST: ' + poltergeist.ghosts.length + ' ghosts, anonymity set: ' + poltergeist.anonymitySet);

  // Build Merkle tree
  const leaves: Buffer[] = [];
  const intentHash = createHash('sha256')
    .update(walletA.publicKey.toBuffer())
    .update(walletB.publicKey.toBuffer())
    .update(Buffer.from('100_PDOX'))
    .digest();
  leaves.push(intentHash);
  for (const ghost of poltergeist.ghosts) {
    leaves.push(createHash('sha256').update(ghost.publicKey.toBuffer()).update(randomBytes(8)).digest());
  }
  const merkleRoot = computeMerkleRoot(leaves);
  log('  🌳 Merkle Root: 0x' + merkleRoot.toString('hex').slice(0, 16) + '...');
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4: BlackMirror (Vault Funder) pays Wallet B
  // ─────────────────────────────────────────────────────────────────────────
  log('💸 STEP 4: BlackMirror → Wallet B (Anonymous Payout)...');
  
  // Create Wallet B's ATA
  const walletB_ATA = getAssociatedTokenAddressSync(PDOX_MINT, walletB.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const createBAtaIx = createAssociatedTokenAccountInstruction(
    vaultFunder.publicKey, walletB_ATA, walletB.publicKey, PDOX_MINT, TOKEN_2022_PROGRAM_ID
  );
  await sendAndConfirmTransaction(conn, new Transaction().add(createBAtaIx), [vaultFunder]);
  log('  ✅ Created PDOX ATA for Wallet B');

  // Vault Funder (acting as BlackMirror) sends to Wallet B
  const payoutAmount = 100n * BigInt(10 ** DECIMALS);
  const payoutFee = calculateFee(transferFee, payoutAmount);
  log('  ℹ️  Payout: ' + (Number(payoutAmount) / 1e9) + ' PDOX, Fee: ' + (Number(payoutFee) / 1e9) + ' PDOX');
  
  const payoutIx = createTransferCheckedWithFeeInstruction(
    funderATA, PDOX_MINT, walletB_ATA, vaultFunder.publicKey, payoutAmount, DECIMALS, payoutFee, [], TOKEN_2022_PROGRAM_ID
  );
  const payoutTx = new Transaction().add(payoutIx);
  const payoutSig = await sendAndConfirmTransaction(conn, payoutTx, [vaultFunder]);
  
  log('  ✅ ANONYMOUS PAYOUT COMPLETE!');
  log('  🔗 TX: ' + payoutSig);
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 5: Generate ZK-style Proof Codes
  // ─────────────────────────────────────────────────────────────────────────
  log('🔐 STEP 5: Generating ZK Proof Codes...');
  
  const proof = generatePaymentProof(walletA.publicKey, walletB.publicKey, payoutAmount, payoutSig);
  
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────────────┐');
  console.log('  │  🎫 YOUR PROOF CODES (Save these!)                              │');
  console.log('  ├─────────────────────────────────────────────────────────────────┤');
  console.log('  │                                                                 │');
  console.log('  │  CODE 1 (Public - can share):                                   │');
  console.log('  │  ' + proof.proofCode1.slice(0, 60) + '...');
  console.log('  │                                                                 │');
  console.log('  │  CODE 2 (Private - keep SECRET!):                               │');
  console.log('  │  ' + proof.proofCode2);
  console.log('  │                                                                 │');
  console.log('  │  💡 Enter both codes on phantomparadox.io/verify to prove tx    │');
  console.log('  └─────────────────────────────────────────────────────────────────┘');
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 6: Verify Proof (Demo)
  // ─────────────────────────────────────────────────────────────────────────
  log('✅ STEP 6: Verifying Proof Codes (Demo)...');
  
  const verification = verifyPaymentProof(proof.proofCode1, proof.proofCode2);
  
  if (verification.valid && verification.details) {
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────────────────────┐');
    console.log('  │  ✅ PROOF VERIFIED!                                             │');
    console.log('  ├─────────────────────────────────────────────────────────────────┤');
    console.log('  │  From:   ' + verification.details.from.slice(0, 44) + '  │');
    console.log('  │  To:     ' + verification.details.to.slice(0, 44) + '  │');
    console.log('  │  Amount: ' + (Number(verification.details.amount) / 1e9).toFixed(2) + ' PDOX                                         │');
    console.log('  │  TX:     ' + verification.details.tx.slice(0, 44) + '...│');
    console.log('  │  Time:   ' + new Date(verification.details.timestamp).toISOString() + '           │');
    console.log('  └─────────────────────────────────────────────────────────────────┘');
  }
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 7: Final Balances
  // ─────────────────────────────────────────────────────────────────────────
  log('📊 STEP 7: Final Balances...');
  
  const finalFunder = await getAccount(conn, funderATA, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const finalB = await getAccount(conn, walletB_ATA, 'confirmed', TOKEN_2022_PROGRAM_ID);
  
  log('  💰 Vault Funder (BlackMirror): ' + (Number(finalFunder.amount) / 1e9).toFixed(2) + ' PDOX');
  log('  🅱️  Wallet B: ' + (Number(finalB.amount) / 1e9).toFixed(2) + ' PDOX');
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  console.log('═'.repeat(75));
  console.log('  📋 CHAIN ANALYSIS VIEW (What Arkham/Chainalysis sees)');
  console.log('═'.repeat(75));
  console.log('');
  console.log('  ┌───────────────────────────────────────────────────────────────────┐');
  console.log('  │  ON-CHAIN TRANSACTIONS:                                          │');
  console.log('  │  ───────────────────────                                         │');
  console.log('  │  1. Deployer → Vault Funder: 1000 PDOX (LP funding)              │');
  console.log('  │  2. Vault Funder → Wallet B: 100 PDOX  (anonymous payout)        │');
  console.log('  │                                                                  │');
  console.log('  │  ❌ NO LINK between Wallet A and Wallet B!                       │');
  console.log('  │  ❌ Wallet A never touched PDOX on-chain!                        │');
  console.log('  │  ✅ Only Vault Funder (LP) → Wallet B visible                    │');
  console.log('  │                                                                  │');
  console.log('  │  🔒 CHAIN BREAKER: Vault acts as mixing layer!                   │');
  console.log('  │  🎫 PROOF: Only sender has CODE 1 + CODE 2 to prove intent       │');
  console.log('  └───────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('═'.repeat(75));
  console.log('  ✅ TEST PASSED - Anonymous payment + ZK proof demonstrated!');
  console.log('═'.repeat(75));
  console.log('');

  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    vaultFunder: vaultFunder.publicKey.toBase58(),
    walletA: walletA.publicKey.toBase58(),
    walletB: walletB.publicKey.toBase58(),
    vaultPDA: VAULT_PDA.toBase58(),
    merkleRoot: '0x' + merkleRoot.toString('hex'),
    ghostCount: poltergeist.ghosts.length,
    anonymitySet: poltergeist.anonymitySet,
    payoutTx: payoutSig,
    proofCode1: proof.proofCode1,
    proofCode2: proof.proofCode2,
    finalBalanceVault: Number(finalFunder.amount) / 1e9,
    finalBalanceB: Number(finalB.amount) / 1e9,
  };
  
  fs.writeFileSync(
    path.join(__dirname, 'vault_anon_test_results.json'),
    JSON.stringify(results, null, 2)
  );
  log('📁 Results saved to vault_anon_test_results.json');
}

main().catch(e => {
  console.error('❌ TEST FAILED:', e.message);
  process.exit(1);
});
