/**
 * PDOX Token Minting Script (Token-2022)
 * 
 * Creates the PDOX token with:
 * - Transfer fee extension (3% initially)
 * - Total supply: 1,000,000,000 PDOX
 * - Decimals: 9
 * 
 * Usage: npx ts-node scripts/tokenomics/mint_pdox.ts
 * 
 * Environment Variables:
 * - WALLET_PATH: Path to deployer wallet (default: deployer_wallet.json)
 * - RPC_URL: Solana RPC URL (default: devnet)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  getMintLen,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAccount,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// PDOX TOKEN CONFIGURATION
// ============================================================================

const PDOX_CONFIG = {
  name: 'Phantom Paradox',
  symbol: 'PDOX',
  decimals: 9,
  totalSupply: 1_000_000_000, // 1 billion
  
  // Transfer fee configuration (basis points)
  transferFeeBps: 300, // 3%
  maxTransferFee: BigInt(1_000_000_000), // 1 SOL worth in smallest units
  
  // Initial distribution
  initialDistribution: {
    liquidityPool: 150_000_000,   // 15% - 150M PDOX for LP
    publicSale: 200_000_000,      // 20% - 200M PDOX
    devTeam: 100_000_000,         // 10% - 100M PDOX (20M liquid, 80M vested)
    daoTreasury: 150_000_000,     // 15% - 150M PDOX
    ecosystem: 150_000_000,       // 15% - 150M PDOX
    communityRewards: 100_000_000, // 10% - 100M PDOX
    reserve: 150_000_000,          // 15% - 150M PDOX
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function loadWallet(walletPath: string): Keypair {
  const walletFile = fs.readFileSync(walletPath, 'utf-8');
  const secretKey = Uint8Array.from(JSON.parse(walletFile));
  return Keypair.fromSecretKey(secretKey);
}

function logSection(title: string) {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70));
}

function logSuccess(message: string) {
  console.log(`✅ ${message}`);
}

function logInfo(message: string) {
  console.log(`ℹ️  ${message}`);
}

function logError(message: string) {
  console.error(`❌ ${message}`);
}

// ============================================================================
// MAIN MINT FUNCTION
// ============================================================================

async function mintPdoxToken() {
  logSection('PDOX TOKEN MINTING (Token-2022)');
  
  // Configuration
  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  const walletPath = process.env.WALLET_PATH || 'deployer_wallet.json';
  
  logInfo(`RPC URL: ${rpcUrl}`);
  logInfo(`Wallet Path: ${walletPath}`);
  
  // Load wallet
  const payer = loadWallet(walletPath);
  logInfo(`Payer: ${payer.publicKey.toBase58()}`);
  
  // Connect to cluster
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  logInfo(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    logError('Insufficient balance! Need at least 0.5 SOL');
    process.exit(1);
  }
  
  // Generate mint keypair
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  
  logSection('TOKEN CONFIGURATION');
  logInfo(`Token Name: ${PDOX_CONFIG.name}`);
  logInfo(`Token Symbol: ${PDOX_CONFIG.symbol}`);
  logInfo(`Decimals: ${PDOX_CONFIG.decimals}`);
  logInfo(`Total Supply: ${PDOX_CONFIG.totalSupply.toLocaleString()} PDOX`);
  logInfo(`Transfer Fee: ${PDOX_CONFIG.transferFeeBps / 100}%`);
  logInfo(`Mint Address: ${mint.toBase58()}`);
  
  // Calculate mint account size with transfer fee extension
  const mintLen = getMintLen([ExtensionType.TransferFeeConfig]);
  const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);
  
  logInfo(`Mint Account Size: ${mintLen} bytes`);
  logInfo(`Rent Exemption: ${mintLamports / LAMPORTS_PER_SOL} SOL`);
  
  logSection('CREATING MINT ACCOUNT');
  
  // Build transaction
  const transaction = new Transaction();
  
  // 1. Create mint account
  transaction.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports: mintLamports,
      programId: TOKEN_2022_PROGRAM_ID,
    })
  );
  
  // 2. Initialize transfer fee config
  transaction.add(
    createInitializeTransferFeeConfigInstruction(
      mint,
      payer.publicKey, // Transfer fee config authority
      payer.publicKey, // Withdraw withheld authority
      PDOX_CONFIG.transferFeeBps, // Fee basis points
      PDOX_CONFIG.maxTransferFee, // Max fee
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  // 3. Initialize mint
  transaction.add(
    createInitializeMintInstruction(
      mint,
      PDOX_CONFIG.decimals,
      payer.publicKey, // Mint authority
      payer.publicKey, // Freeze authority (can be set to null later)
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  // Send transaction
  logInfo('Sending create mint transaction...');
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [payer, mintKeypair],
      { commitment: 'confirmed' }
    );
    logSuccess(`Mint created! Signature: ${signature}`);
  } catch (error) {
    logError(`Failed to create mint: ${error}`);
    process.exit(1);
  }
  
  logSection('MINTING INITIAL SUPPLY');
  
  // Get/create associated token account for payer
  const payerAta = getAssociatedTokenAddressSync(
    mint,
    payer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  logInfo(`Payer ATA: ${payerAta.toBase58()}`);
  
  // Create ATA and mint initial supply
  const mintTransaction = new Transaction();
  
  // Create ATA
  mintTransaction.add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      payerAta,
      payer.publicKey,
      mint,
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  // Mint total supply
  const totalSupplyWithDecimals = BigInt(PDOX_CONFIG.totalSupply) * BigInt(10 ** PDOX_CONFIG.decimals);
  
  mintTransaction.add(
    createMintToInstruction(
      mint,
      payerAta,
      payer.publicKey,
      totalSupplyWithDecimals,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  logInfo(`Minting ${PDOX_CONFIG.totalSupply.toLocaleString()} PDOX...`);
  
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      mintTransaction,
      [payer],
      { commitment: 'confirmed' }
    );
    logSuccess(`Tokens minted! Signature: ${signature}`);
  } catch (error) {
    logError(`Failed to mint tokens: ${error}`);
    process.exit(1);
  }
  
  // Verify
  logSection('VERIFICATION');
  
  try {
    const tokenAccount = await getAccount(
      connection,
      payerAta,
      'confirmed',
      TOKEN_2022_PROGRAM_ID
    );
    logSuccess(`Token Account Balance: ${Number(tokenAccount.amount) / 10 ** PDOX_CONFIG.decimals} PDOX`);
  } catch (error) {
    logError(`Failed to verify: ${error}`);
  }
  
  logSection('DEPLOYMENT SUMMARY');
  
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                    PDOX TOKEN DEPLOYED SUCCESSFULLY                  ║
╠══════════════════════════════════════════════════════════════════════╣
║  Mint Address:     ${mint.toBase58()}  ║
║  Token Standard:   Token-2022 (SPL)                                  ║
║  Decimals:         ${PDOX_CONFIG.decimals}                                                      ║
║  Total Supply:     ${PDOX_CONFIG.totalSupply.toLocaleString().padEnd(20)} PDOX                ║
║  Transfer Fee:     ${PDOX_CONFIG.transferFeeBps / 100}%                                                    ║
╠══════════════════════════════════════════════════════════════════════╣
║  Network:          ${rpcUrl.includes('devnet') ? 'DEVNET' : 'MAINNET'}                                              ║
║  Mint Authority:   ${payer.publicKey.toBase58().substring(0, 20)}...         ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  // Save mint info to file
  const mintInfo = {
    mint: mint.toBase58(),
    name: PDOX_CONFIG.name,
    symbol: PDOX_CONFIG.symbol,
    decimals: PDOX_CONFIG.decimals,
    totalSupply: PDOX_CONFIG.totalSupply,
    transferFeeBps: PDOX_CONFIG.transferFeeBps,
    mintAuthority: payer.publicKey.toBase58(),
    freezeAuthority: payer.publicKey.toBase58(),
    tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
    network: rpcUrl.includes('devnet') ? 'devnet' : 'mainnet',
    createdAt: new Date().toISOString(),
  };
  
  fs.writeFileSync(
    'PDOX_MINT_INFO.json',
    JSON.stringify(mintInfo, null, 2)
  );
  logSuccess('Mint info saved to PDOX_MINT_INFO.json');
  
  // Log to automation log
  try {
    const logEntry = `[${new Date().toISOString()}] [TOKEN] PDOX Token Minted: ${mint.toBase58()}\n`;
    fs.appendFileSync('LAUNCH_AUTOMATION_LOG.txt', logEntry);
  } catch (e) {
    // Ignore if log file doesn't exist
  }
  
  return mint.toBase58();
}

// ============================================================================
// ENTRY POINT
// ============================================================================

mintPdoxToken()
  .then((mintAddress) => {
    console.log(`\n✅ PDOX Token mint address: ${mintAddress}\n`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });

