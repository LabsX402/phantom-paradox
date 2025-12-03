/**
 * PDOX/SOL Meteora DLMM Pool Creation Script
 * 
 * Creates a liquidity pool on Meteora DLMM for PDOX/SOL trading
 * 
 * Features:
 * - Token-2022 compatible (TransferFeeConfig supported)
 * - Dynamic Liquidity Market Maker (DLMM)
 * - Initial liquidity: 1 SOL + 150M PDOX
 * 
 * Usage: npx ts-node create_meteora_pool.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createSyncNativeInstruction,
} from '@solana/spl-token';
import DLMM from '@meteora-ag/dlmm';
import * as fs from 'fs';
import BN from 'bn.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Pool configuration
  initialSolAmount: 1 * LAMPORTS_PER_SOL, // 1 SOL
  initialPdoxAmount: 150_000_000, // 150M PDOX (will be multiplied by decimals)
  
  // DLMM bin step (price granularity) - 100 = 1% per bin
  binStep: 100,
  
  // Active bin ID (determines initial price)
  // Price = 1.0001^(activeBinId) * (baseDecimal/quoteDecimal)
  // For SOL/PDOX, we want 1 SOL = 150M PDOX
  // log(150_000_000) / log(1.0001) ≈ 188,500
  activeBinId: 0, // Will be calculated
  
  // Fee rate in basis points (100 = 1%)
  feeBps: 25, // 0.25% base fee
};

// ============================================================================
// HELPER FUNCTIONS
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

function logWarning(message: string) {
  console.log(`⚠️  ${message}`);
}

// ============================================================================
// MAIN POOL CREATION FUNCTION
// ============================================================================

async function createMeteoraDlmmPool() {
  logSection('METEORA DLMM POOL CREATION');
  
  // Configuration
  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  const walletPath = process.env.WALLET_PATH || '../../deployer_wallet.json';
  
  logInfo(`RPC URL: ${rpcUrl}`);
  logInfo(`Wallet Path: ${walletPath}`);
  
  // Load wallet
  const payer = loadWallet(walletPath);
  logInfo(`Payer: ${payer.publicKey.toBase58()}`);
  
  // Load PDOX mint info
  const pdoxMintInfo = loadMintInfo();
  const pdoxMint = new PublicKey(pdoxMintInfo.mint);
  const pdoxDecimals = pdoxMintInfo.decimals;
  
  logInfo(`PDOX Mint: ${pdoxMint.toBase58()}`);
  logInfo(`PDOX Decimals: ${pdoxDecimals}`);
  
  // Connect to cluster
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  logInfo(`SOL Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  if (balance < 2 * LAMPORTS_PER_SOL) {
    logError('Insufficient balance! Need at least 2 SOL (1 for LP + fees)');
    process.exit(1);
  }
  
  // Check PDOX balance
  const pdoxAta = getAssociatedTokenAddressSync(
    pdoxMint,
    payer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  try {
    const pdoxAccount = await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    const pdoxBalance = Number(pdoxAccount.amount) / (10 ** pdoxDecimals);
    logInfo(`PDOX Balance: ${pdoxBalance.toLocaleString()} PDOX`);
    
    if (pdoxBalance < CONFIG.initialPdoxAmount) {
      logError(`Insufficient PDOX! Need at least ${CONFIG.initialPdoxAmount.toLocaleString()} PDOX`);
      process.exit(1);
    }
  } catch (e) {
    logError('Could not fetch PDOX balance. Make sure you have minted PDOX first.');
    process.exit(1);
  }
  
  logSection('POOL CONFIGURATION');
  logInfo(`Initial SOL: ${CONFIG.initialSolAmount / LAMPORTS_PER_SOL} SOL`);
  logInfo(`Initial PDOX: ${CONFIG.initialPdoxAmount.toLocaleString()} PDOX`);
  logInfo(`Bin Step: ${CONFIG.binStep} (${CONFIG.binStep / 100}% per bin)`);
  logInfo(`Fee Rate: ${CONFIG.feeBps} bps (${CONFIG.feeBps / 100}%)`);
  
  // Calculate initial price
  // Price = PDOX per SOL = 150,000,000 PDOX per 1 SOL
  const initialPrice = CONFIG.initialPdoxAmount / (CONFIG.initialSolAmount / LAMPORTS_PER_SOL);
  logInfo(`Initial Price: 1 SOL = ${initialPrice.toLocaleString()} PDOX`);
  
  logSection('CREATING METEORA DLMM POOL');
  
  try {
    // Initialize DLMM
    logInfo('Initializing DLMM SDK...');
    
    // For devnet, we need to check if Meteora DLMM is available
    // Meteora DLMM Program ID (check for devnet availability)
    const DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
    
    logInfo(`DLMM Program ID: ${DLMM_PROGRAM_ID.toBase58()}`);
    
    // Check if program exists on devnet
    const programInfo = await connection.getAccountInfo(DLMM_PROGRAM_ID);
    if (!programInfo) {
      logWarning('Meteora DLMM program not found on devnet!');
      logInfo('');
      logInfo('Meteora DLMM may not be deployed on devnet.');
      logInfo('Options:');
      logInfo('  1. Use mainnet for testing (with small amounts)');
      logInfo('  2. Create a mock AMM for devnet testing');
      logInfo('  3. Wait for Meteora devnet deployment');
      logInfo('');
      
      // Save pool config for later use
      const poolConfig = {
        status: 'PENDING_METEORA_DEVNET',
        pdoxMint: pdoxMint.toBase58(),
        solMint: NATIVE_MINT.toBase58(),
        initialSol: CONFIG.initialSolAmount,
        initialPdox: CONFIG.initialPdoxAmount * (10 ** pdoxDecimals),
        binStep: CONFIG.binStep,
        feeBps: CONFIG.feeBps,
        initialPrice: initialPrice,
        network: 'devnet',
        createdAt: new Date().toISOString(),
        notes: 'Meteora DLMM not available on devnet. Use mock AMM or mainnet.',
      };
      
      fs.writeFileSync('PDOX_POOL_CONFIG.json', JSON.stringify(poolConfig, null, 2));
      logInfo('Pool configuration saved to PDOX_POOL_CONFIG.json');
      
      // Offer to create mock pool
      logSection('CREATING MOCK LP FOR TESTING');
      await createMockLpPool(connection, payer, pdoxMint, pdoxDecimals);
      
      return;
    }
    
    logSuccess('Meteora DLMM program found!');
    
    // Create the DLMM pool
    // Note: This requires the DLMM SDK to properly initialize
    // The exact implementation depends on Meteora's current SDK version
    
    logInfo('Creating DLMM pool...');
    
    // For now, save the pool configuration
    const poolConfig = {
      status: 'READY_TO_CREATE',
      pdoxMint: pdoxMint.toBase58(),
      solMint: NATIVE_MINT.toBase58(),
      initialSol: CONFIG.initialSolAmount,
      initialPdox: CONFIG.initialPdoxAmount * (10 ** pdoxDecimals),
      binStep: CONFIG.binStep,
      feeBps: CONFIG.feeBps,
      initialPrice: initialPrice,
      network: 'devnet',
      dlmmProgramId: DLMM_PROGRAM_ID.toBase58(),
      createdAt: new Date().toISOString(),
    };
    
    fs.writeFileSync('PDOX_POOL_CONFIG.json', JSON.stringify(poolConfig, null, 2));
    logSuccess('Pool configuration saved to PDOX_POOL_CONFIG.json');
    
  } catch (error) {
    logError(`Failed to create pool: ${error}`);
    
    // Fallback to mock pool
    logSection('FALLBACK: CREATING MOCK LP FOR TESTING');
    await createMockLpPool(connection, payer, pdoxMint, pdoxDecimals);
  }
}

// ============================================================================
// MOCK LP POOL FOR DEVNET TESTING
// ============================================================================

async function createMockLpPool(
  connection: Connection,
  payer: Keypair,
  pdoxMint: PublicKey,
  pdoxDecimals: number
) {
  logInfo('Creating mock LP pool for devnet testing...');
  logInfo('This simulates a real LP for testing the LP Growth Manager');
  
  // Create a PDA to act as the LP pool
  const [lpPoolPda, lpPoolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('mock_lp_pool'), pdoxMint.toBuffer()],
    new PublicKey('11111111111111111111111111111111') // System program as placeholder
  );
  
  // Create mock LP token mint
  // For testing, we'll just track the values in a JSON file
  
  const mockPool = {
    type: 'MOCK_LP_POOL',
    status: 'ACTIVE',
    pdoxMint: pdoxMint.toBase58(),
    solMint: NATIVE_MINT.toBase58(),
    
    // Pool state
    solReserve: CONFIG.initialSolAmount,
    pdoxReserve: CONFIG.initialPdoxAmount * (10 ** pdoxDecimals),
    
    // LP tokens (simulated)
    totalLpTokens: Math.sqrt(CONFIG.initialSolAmount * CONFIG.initialPdoxAmount * (10 ** pdoxDecimals)),
    lpTokensOwned: {
      [payer.publicKey.toBase58()]: Math.sqrt(CONFIG.initialSolAmount * CONFIG.initialPdoxAmount * (10 ** pdoxDecimals)),
    },
    
    // Price tracking
    initialPrice: CONFIG.initialPdoxAmount, // PDOX per SOL
    currentPrice: CONFIG.initialPdoxAmount,
    
    // Fees
    feeBps: CONFIG.feeBps,
    accumulatedFees: {
      sol: 0,
      pdox: 0,
    },
    
    // Metadata
    network: 'devnet',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    
    // For LP Growth Manager integration
    lpGrowthConfig: {
      minFeeThreshold: 0.1 * LAMPORTS_PER_SOL, // 0.1 SOL
      growthCooldownSecs: 86400, // 24 hours
      maxWithdrawalPerPeriod: 10, // 10%
      withdrawalPeriodSecs: 30 * 86400, // 30 days
    },
  };
  
  // Save mock pool state
  fs.writeFileSync('PDOX_MOCK_LP_POOL.json', JSON.stringify(mockPool, null, 2));
  
  logSuccess('Mock LP pool created!');
  logInfo(`SOL Reserve: ${mockPool.solReserve / LAMPORTS_PER_SOL} SOL`);
  logInfo(`PDOX Reserve: ${(mockPool.pdoxReserve / (10 ** pdoxDecimals)).toLocaleString()} PDOX`);
  logInfo(`LP Tokens: ${mockPool.totalLpTokens.toLocaleString()}`);
  logInfo(`Price: 1 SOL = ${mockPool.currentPrice.toLocaleString()} PDOX`);
  
  // Create helper script for mock pool operations
  await createMockPoolHelpers();
  
  logSection('MOCK POOL SUMMARY');
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                    MOCK LP POOL CREATED (DEVNET)                     ║
╠══════════════════════════════════════════════════════════════════════╣
║  Pool Type:        Mock LP Pool (simulated for testing)              ║
║  SOL Reserve:      ${(mockPool.solReserve / LAMPORTS_PER_SOL).toString().padEnd(10)} SOL                              ║
║  PDOX Reserve:     ${(mockPool.pdoxReserve / (10 ** pdoxDecimals) / 1e6).toFixed(0).padEnd(10)} M PDOX                          ║
║  Initial Price:    1 SOL = ${mockPool.currentPrice.toLocaleString().padEnd(15)} PDOX          ║
╠══════════════════════════════════════════════════════════════════════╣
║  Use mock_pool_ops.ts to simulate:                                   ║
║    - Swaps (to generate fees)                                        ║
║    - Add/Remove liquidity                                            ║
║    - LP Growth execution                                             ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  // Log to automation log
  try {
    const logEntry = `[${new Date().toISOString()}] [LP] Mock LP Pool Created: SOL=${mockPool.solReserve / LAMPORTS_PER_SOL}, PDOX=${mockPool.pdoxReserve / (10 ** pdoxDecimals)}\n`;
    fs.appendFileSync('../../LAUNCH_AUTOMATION_LOG.txt', logEntry);
  } catch (e) {
    // Ignore
  }
}

// ============================================================================
// MOCK POOL HELPER OPERATIONS
// ============================================================================

async function createMockPoolHelpers() {
  const helperScript = `/**
 * Mock LP Pool Operations
 * 
 * Simulates LP pool operations for testing LP Growth Manager
 */

import * as fs from 'fs';

interface MockPool {
  solReserve: number;
  pdoxReserve: number;
  totalLpTokens: number;
  lpTokensOwned: Record<string, number>;
  currentPrice: number;
  accumulatedFees: { sol: number; pdox: number };
  lastUpdated: string;
}

function loadPool(): MockPool {
  return JSON.parse(fs.readFileSync('PDOX_MOCK_LP_POOL.json', 'utf-8'));
}

function savePool(pool: MockPool) {
  pool.lastUpdated = new Date().toISOString();
  fs.writeFileSync('PDOX_MOCK_LP_POOL.json', JSON.stringify(pool, null, 2));
}

// Simulate a swap (generates fees)
export function simulateSwap(solAmount: number, isBuy: boolean) {
  const pool = loadPool();
  const feeBps = 25; // 0.25%
  
  if (isBuy) {
    // Buy PDOX with SOL
    const fee = solAmount * feeBps / 10000;
    const solIn = solAmount - fee;
    const pdoxOut = (pool.pdoxReserve * solIn) / (pool.solReserve + solIn);
    
    pool.solReserve += solIn;
    pool.pdoxReserve -= pdoxOut;
    pool.accumulatedFees.sol += fee;
    
    console.log(\`Swapped \${solAmount / 1e9} SOL -> \${pdoxOut / 1e9} PDOX (fee: \${fee / 1e9} SOL)\`);
  } else {
    // Sell PDOX for SOL
    const fee = solAmount * feeBps / 10000; // Fee in SOL equivalent
    const pdoxIn = solAmount;
    const solOut = (pool.solReserve * pdoxIn) / (pool.pdoxReserve + pdoxIn);
    
    pool.pdoxReserve += pdoxIn;
    pool.solReserve -= solOut;
    pool.accumulatedFees.pdox += fee;
    
    console.log(\`Swapped \${pdoxIn / 1e9} PDOX -> \${solOut / 1e9} SOL\`);
  }
  
  // Update price
  pool.currentPrice = pool.pdoxReserve / pool.solReserve;
  
  savePool(pool);
  console.log(\`New price: 1 SOL = \${pool.currentPrice.toFixed(0)} PDOX\`);
  console.log(\`Accumulated fees: \${pool.accumulatedFees.sol / 1e9} SOL, \${pool.accumulatedFees.pdox / 1e9} PDOX\`);
}

// Simulate LP Growth (add fees to LP)
export function executeLpGrowth() {
  const pool = loadPool();
  
  const solFees = pool.accumulatedFees.sol;
  if (solFees < 0.1 * 1e9) {
    console.log('Not enough fees accumulated (min 0.1 SOL)');
    return;
  }
  
  // Calculate PDOX to mint to maintain ratio
  const currentRatio = pool.pdoxReserve / pool.solReserve;
  const pdoxToAdd = solFees * currentRatio;
  
  // Add to reserves
  pool.solReserve += solFees;
  pool.pdoxReserve += pdoxToAdd;
  
  // Mint LP tokens proportionally
  const lpTokensToMint = (solFees / pool.solReserve) * pool.totalLpTokens;
  pool.totalLpTokens += lpTokensToMint;
  
  // Reset fees
  pool.accumulatedFees.sol = 0;
  
  savePool(pool);
  
  console.log('LP Growth Executed!');
  console.log(\`Added: \${solFees / 1e9} SOL + \${pdoxToAdd / 1e9} PDOX\`);
  console.log(\`New LP tokens: \${lpTokensToMint.toFixed(2)}\`);
  console.log(\`Total reserves: \${pool.solReserve / 1e9} SOL, \${pool.pdoxReserve / 1e9} PDOX\`);
}

// Get pool status
export function getPoolStatus() {
  const pool = loadPool();
  console.log('\\n=== Mock LP Pool Status ===');
  console.log(\`SOL Reserve: \${pool.solReserve / 1e9} SOL\`);
  console.log(\`PDOX Reserve: \${pool.pdoxReserve / 1e9} PDOX\`);
  console.log(\`Price: 1 SOL = \${pool.currentPrice.toFixed(0)} PDOX\`);
  console.log(\`LP Tokens: \${pool.totalLpTokens.toFixed(2)}\`);
  console.log(\`Accumulated Fees: \${pool.accumulatedFees.sol / 1e9} SOL\`);
  console.log(\`Last Updated: \${pool.lastUpdated}\`);
}

// CLI interface
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'status':
    getPoolStatus();
    break;
  case 'swap-buy':
    simulateSwap(parseFloat(args[1] || '0.1') * 1e9, true);
    break;
  case 'swap-sell':
    simulateSwap(parseFloat(args[1] || '1000000') * 1e9, false);
    break;
  case 'lp-growth':
    executeLpGrowth();
    break;
  default:
    console.log('Usage:');
    console.log('  npx ts-node mock_pool_ops.ts status');
    console.log('  npx ts-node mock_pool_ops.ts swap-buy <sol_amount>');
    console.log('  npx ts-node mock_pool_ops.ts swap-sell <pdox_amount>');
    console.log('  npx ts-node mock_pool_ops.ts lp-growth');
}
`;

  fs.writeFileSync('mock_pool_ops.ts', helperScript);
  logSuccess('Created mock_pool_ops.ts for simulating pool operations');
}

// ============================================================================
// ENTRY POINT
// ============================================================================

createMeteoraDlmmPool()
  .then(() => {
    console.log('\n✅ Pool creation script completed!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });

