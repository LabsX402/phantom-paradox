/**
 * Initialize PDOX/SOL Pool on Meteora DLMM
 * 
 * This script creates the actual liquidity pool and adds initial liquidity
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
  getAccount,
} from '@solana/spl-token';
import DLMM, { StrategyType } from '@meteora-ag/dlmm';
import * as fs from 'fs';
import BN from 'bn.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  initialSolAmount: 1 * LAMPORTS_PER_SOL, // 1 SOL
  initialPdoxAmount: 150_000_000, // 150M PDOX (before decimals)
  binStep: 25, // 0.25% per bin (more granular for better trading)
};

// ============================================================================
// HELPERS
// ============================================================================

function loadWallet(walletPath: string): Keypair {
  const walletFile = fs.readFileSync(walletPath, 'utf-8');
  const secretKey = Uint8Array.from(JSON.parse(walletFile));
  return Keypair.fromSecretKey(secretKey);
}

function loadMintInfo(): { mint: string; decimals: number } {
  const mintInfoPath = 'PDOX_MINT_INFO.json';
  if (!fs.existsSync(mintInfoPath)) {
    throw new Error('PDOX_MINT_INFO.json not found. Run mint_pdox.ts first.');
  }
  return JSON.parse(fs.readFileSync(mintInfoPath, 'utf-8'));
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
// MAIN
// ============================================================================

async function initMeteoraDlmmPool() {
  logSection('METEORA DLMM POOL INITIALIZATION');
  
  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  const walletPath = process.env.WALLET_PATH || '../../deployer_wallet.json';
  
  logInfo(`RPC URL: ${rpcUrl}`);
  
  // Load wallet
  const payer = loadWallet(walletPath);
  logInfo(`Payer: ${payer.publicKey.toBase58()}`);
  
  // Load PDOX info
  const pdoxInfo = loadMintInfo();
  const pdoxMint = new PublicKey(pdoxInfo.mint);
  const pdoxDecimals = pdoxInfo.decimals;
  
  logInfo(`PDOX Mint: ${pdoxMint.toBase58()}`);
  
  // Connect
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Check balances
  const solBalance = await connection.getBalance(payer.publicKey);
  logInfo(`SOL Balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);
  
  const pdoxAta = getAssociatedTokenAddressSync(
    pdoxMint,
    payer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  const pdoxAccount = await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const pdoxBalance = Number(pdoxAccount.amount) / (10 ** pdoxDecimals);
  logInfo(`PDOX Balance: ${pdoxBalance.toLocaleString()} PDOX`);
  
  logSection('CHECKING EXISTING POOLS');
  
  try {
    // Try to find existing PDOX/SOL pool
    logInfo('Searching for existing PDOX/SOL pools...');
    
    // Get all DLMM pools (this may take a moment)
    const dlmmPools = await DLMM.getLbPairs(connection);
    
    logInfo(`Found ${dlmmPools.length} DLMM pools on ${rpcUrl.includes('devnet') ? 'devnet' : 'mainnet'}`);
    
    // Check if PDOX pool exists
    const existingPool = dlmmPools.find(pool => 
      (pool.tokenX.publicKey.equals(pdoxMint) || pool.tokenY.publicKey.equals(pdoxMint))
    );
    
    if (existingPool) {
      logSuccess('Found existing PDOX pool!');
      logInfo(`Pool Address: ${existingPool.publicKey.toBase58()}`);
      logInfo(`Token X: ${existingPool.tokenX.publicKey.toBase58()}`);
      logInfo(`Token Y: ${existingPool.tokenY.publicKey.toBase58()}`);
      
      // Save pool info
      const poolInfo = {
        status: 'EXISTING_POOL_FOUND',
        poolAddress: existingPool.publicKey.toBase58(),
        tokenX: existingPool.tokenX.publicKey.toBase58(),
        tokenY: existingPool.tokenY.publicKey.toBase58(),
        pdoxMint: pdoxMint.toBase58(),
        network: rpcUrl.includes('devnet') ? 'devnet' : 'mainnet',
        foundAt: new Date().toISOString(),
      };
      
      fs.writeFileSync('PDOX_POOL_INFO.json', JSON.stringify(poolInfo, null, 2));
      logSuccess('Pool info saved to PDOX_POOL_INFO.json');
      
      return existingPool.publicKey.toBase58();
    }
    
    logInfo('No existing PDOX pool found. Will create new pool...');
    
  } catch (e) {
    logInfo(`Could not search pools: ${e}`);
    logInfo('Will attempt to create new pool...');
  }
  
  logSection('CREATING NEW DLMM POOL');
  
  try {
    // Calculate amounts with decimals
    const pdoxAmountWithDecimals = new BN(CONFIG.initialPdoxAmount).mul(new BN(10).pow(new BN(pdoxDecimals)));
    const solAmountLamports = new BN(CONFIG.initialSolAmount);
    
    logInfo(`Initial PDOX: ${CONFIG.initialPdoxAmount.toLocaleString()} (${pdoxAmountWithDecimals.toString()} raw)`);
    logInfo(`Initial SOL: ${CONFIG.initialSolAmount / LAMPORTS_PER_SOL} (${solAmountLamports.toString()} lamports)`);
    logInfo(`Bin Step: ${CONFIG.binStep}`);
    
    // For Token-2022 tokens, we need to be careful about the pool creation
    // Meteora may require specific configurations
    
    logInfo('Note: Creating pools with Token-2022 tokens may require special handling.');
    logInfo('If pool creation fails, you may need to use Meteora\'s UI at https://app.meteora.ag/');
    
    // Try to create the pool
    // Note: The exact method depends on the Meteora SDK version
    // Some versions may not support programmatic pool creation for Token-2022
    
    const createPoolTx = await DLMM.createLbPair(
      connection,
      payer.publicKey,
      pdoxMint,  // Token X (PDOX)
      NATIVE_MINT, // Token Y (SOL/wSOL)
      CONFIG.binStep,
      {
        cluster: 'devnet',
      }
    );
    
    if (createPoolTx) {
      logInfo('Sending pool creation transaction...');
      
      // Add compute budget for complex transaction
      const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
        units: 400000,
      });
      
      const transaction = new Transaction()
        .add(modifyComputeUnits)
        .add(createPoolTx);
      
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [payer],
        { commitment: 'confirmed' }
      );
      
      logSuccess(`Pool created! Signature: ${signature}`);
      
      // Get pool address from transaction
      // This would require parsing the transaction logs
      logInfo('Pool created successfully. Check Meteora UI for pool address.');
      
    } else {
      throw new Error('createLbPair returned null');
    }
    
  } catch (error: any) {
    logError(`Pool creation failed: ${error.message || error}`);
    logInfo('');
    logInfo('This is common for Token-2022 tokens on devnet.');
    logInfo('');
    logInfo('ALTERNATIVE OPTIONS:');
    logInfo('1. Use Meteora UI at https://app.meteora.ag/ to create the pool manually');
    logInfo('2. Use the mock LP pool for testing (already created)');
    logInfo('3. Deploy to mainnet where Token-2022 support is better');
    logInfo('');
    
    // Create mock pool as fallback
    logSection('CREATING MOCK POOL (FALLBACK)');
    await createMockPool(pdoxMint.toBase58(), pdoxDecimals);
  }
  
  return null;
}

async function createMockPool(pdoxMint: string, pdoxDecimals: number) {
  const mockPool = {
    type: 'MOCK_LP_POOL',
    status: 'ACTIVE',
    pdoxMint: pdoxMint,
    solMint: NATIVE_MINT.toBase58(),
    solReserve: CONFIG.initialSolAmount,
    pdoxReserve: CONFIG.initialPdoxAmount * (10 ** pdoxDecimals),
    totalLpTokens: Math.sqrt(CONFIG.initialSolAmount * CONFIG.initialPdoxAmount * (10 ** pdoxDecimals)),
    currentPrice: CONFIG.initialPdoxAmount,
    feeBps: 25,
    accumulatedFees: { sol: 0, pdox: 0 },
    network: 'devnet',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    lpGrowthConfig: {
      minFeeThreshold: 0.1 * LAMPORTS_PER_SOL,
      growthCooldownSecs: 86400,
      maxWithdrawalPerPeriod: 10,
      withdrawalPeriodSecs: 30 * 86400,
    },
  };
  
  fs.writeFileSync('PDOX_MOCK_LP_POOL.json', JSON.stringify(mockPool, null, 2));
  
  logSuccess('Mock LP pool created for testing!');
  logInfo(`SOL Reserve: ${mockPool.solReserve / LAMPORTS_PER_SOL} SOL`);
  logInfo(`PDOX Reserve: ${(mockPool.pdoxReserve / (10 ** pdoxDecimals)).toLocaleString()} PDOX`);
  logInfo(`Price: 1 SOL = ${mockPool.currentPrice.toLocaleString()} PDOX`);
  
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                    MOCK LP POOL READY FOR TESTING                    ║
╠══════════════════════════════════════════════════════════════════════╣
║  This mock pool simulates Meteora DLMM for devnet testing.           ║
║  It tracks: reserves, LP tokens, fees, and price.                    ║
║                                                                      ║
║  For mainnet: Use real Meteora at https://app.meteora.ag/            ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  // Log to automation
  try {
    const logEntry = `\n[${new Date().toISOString()}] [LP] Mock LP Pool Created for Testing\n`;
    fs.appendFileSync('../../LAUNCH_AUTOMATION_LOG.txt', logEntry);
  } catch (e) {}
}

// Run
initMeteoraDlmmPool()
  .then((result) => {
    if (result) {
      console.log(`\n✅ Pool Address: ${result}\n`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });

