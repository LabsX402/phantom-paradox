/**
 * PDOX Mock LP Pool Setup
 * 
 * Creates a mock liquidity pool for devnet testing of the LP Growth mechanism.
 * This simulates what a real Meteora/Raydium pool would do.
 * 
 * For mainnet: Use Meteora UI at https://app.meteora.ag/
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  NATIVE_MINT,
} from '@solana/spl-token';
import * as fs from 'fs';

// ============================================================================
// CONFIGURATION
// ============================================================================

const POOL_CONFIG = {
  initialSolAmount: 1 * LAMPORTS_PER_SOL, // 1 SOL
  initialPdoxAmount: 150_000_000, // 150M PDOX
  feeBps: 25, // 0.25% swap fee
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
  if (!fs.existsSync('PDOX_MINT_INFO.json')) {
    throw new Error('PDOX_MINT_INFO.json not found. Run mint_pdox.ts first.');
  }
  return JSON.parse(fs.readFileSync('PDOX_MINT_INFO.json', 'utf-8'));
}

function log(message: string, type: string = 'INFO') {
  const icons: Record<string, string> = {
    'INFO': 'ℹ️ ',
    'SUCCESS': '✅',
    'ERROR': '❌',
    'WARN': '⚠️ ',
  };
  console.log(`${icons[type] || ''} ${message}`);
}

// ============================================================================
// MOCK LP POOL
// ============================================================================

interface MockLpPool {
  type: string;
  status: string;
  pdoxMint: string;
  solMint: string;
  solReserve: number;
  pdoxReserve: number;
  totalLpTokens: number;
  lpTokensOwned: Record<string, number>;
  initialPrice: number;
  currentPrice: number;
  feeBps: number;
  accumulatedFees: { sol: number; pdox: number };
  totalSwapVolume: number;
  swapCount: number;
  lpGrowthConfig: {
    minFeeThreshold: number;
    growthCooldownSecs: number;
    lastGrowthTimestamp: number;
    totalFeesUsedForGrowth: number;
  };
  network: string;
  createdAt: string;
  lastUpdated: string;
}

async function setupMockLpPool() {
  console.log('\n' + '='.repeat(70));
  console.log('  PDOX MOCK LP POOL SETUP');
  console.log('='.repeat(70) + '\n');
  
  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  const walletPath = process.env.WALLET_PATH || '../../deployer_wallet.json';
  
  log(`RPC: ${rpcUrl}`);
  log(`Network: ${rpcUrl.includes('devnet') ? 'DEVNET' : 'MAINNET'}`);
  
  // Load wallet
  const payer = loadWallet(walletPath);
  log(`Deployer: ${payer.publicKey.toBase58()}`);
  
  // Load PDOX info
  const pdoxInfo = loadMintInfo();
  const pdoxMint = new PublicKey(pdoxInfo.mint);
  const pdoxDecimals = pdoxInfo.decimals;
  
  log(`PDOX Mint: ${pdoxMint.toBase58()}`);
  log(`PDOX Decimals: ${pdoxDecimals}`);
  
  // Connect and check balances
  const connection = new Connection(rpcUrl, 'confirmed');
  
  const solBalance = await connection.getBalance(payer.publicKey);
  log(`SOL Balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  
  const pdoxAta = getAssociatedTokenAddressSync(
    pdoxMint,
    payer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  let pdoxBalance = 0;
  try {
    const pdoxAccount = await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    pdoxBalance = Number(pdoxAccount.amount) / (10 ** pdoxDecimals);
    log(`PDOX Balance: ${pdoxBalance.toLocaleString()} PDOX`);
  } catch (e) {
    log('Could not fetch PDOX balance', 'ERROR');
    process.exit(1);
  }
  
  // Create mock pool
  console.log('\n' + '='.repeat(70));
  console.log('  CREATING MOCK LP POOL');
  console.log('='.repeat(70) + '\n');
  
  const pdoxReserve = POOL_CONFIG.initialPdoxAmount * (10 ** pdoxDecimals);
  const solReserve = POOL_CONFIG.initialSolAmount;
  
  // Calculate initial LP tokens using geometric mean
  const initialLpTokens = Math.sqrt(solReserve * pdoxReserve);
  
  const mockPool: MockLpPool = {
    type: 'MOCK_METEORA_DLMM',
    status: 'ACTIVE',
    pdoxMint: pdoxMint.toBase58(),
    solMint: NATIVE_MINT.toBase58(),
    solReserve: solReserve,
    pdoxReserve: pdoxReserve,
    totalLpTokens: initialLpTokens,
    lpTokensOwned: {
      [payer.publicKey.toBase58()]: initialLpTokens,
    },
    initialPrice: POOL_CONFIG.initialPdoxAmount,
    currentPrice: POOL_CONFIG.initialPdoxAmount,
    feeBps: POOL_CONFIG.feeBps,
    accumulatedFees: { sol: 0, pdox: 0 },
    totalSwapVolume: 0,
    swapCount: 0,
    lpGrowthConfig: {
      minFeeThreshold: 0.1 * LAMPORTS_PER_SOL,
      growthCooldownSecs: 86400,
      lastGrowthTimestamp: 0,
      totalFeesUsedForGrowth: 0,
    },
    network: rpcUrl.includes('devnet') ? 'devnet' : 'mainnet',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
  
  // Save pool
  fs.writeFileSync('PDOX_MOCK_LP_POOL.json', JSON.stringify(mockPool, null, 2));
  
  log('Mock LP Pool Created!', 'SUCCESS');
  console.log('');
  log(`SOL Reserve: ${(mockPool.solReserve / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  log(`PDOX Reserve: ${(mockPool.pdoxReserve / (10 ** pdoxDecimals)).toLocaleString()} PDOX`);
  log(`LP Tokens: ${mockPool.totalLpTokens.toLocaleString()}`);
  log(`Price: 1 SOL = ${mockPool.currentPrice.toLocaleString()} PDOX`);
  log(`Swap Fee: ${mockPool.feeBps / 100}%`);
  
  // Print summary
  const solDisplay = (mockPool.solReserve / LAMPORTS_PER_SOL).toString().padEnd(10);
  const pdoxDisplay = (mockPool.pdoxReserve / (10 ** pdoxDecimals) / 1e6).toFixed(0).padEnd(10);
  const priceDisplay = mockPool.currentPrice.toLocaleString().padEnd(15);
  const lpDisplay = mockPool.totalLpTokens.toExponential(2).padEnd(15);
  
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                    MOCK LP POOL CREATED SUCCESSFULLY                 ║
╠══════════════════════════════════════════════════════════════════════╣
║  Pool Type:        Mock Meteora DLMM (for devnet testing)            ║
║  SOL Reserve:      ${solDisplay} SOL                              ║
║  PDOX Reserve:     ${pdoxDisplay} M PDOX                          ║
║  Price:            1 SOL = ${priceDisplay} PDOX          ║
║  LP Tokens:        ${lpDisplay}                         ║
╠══════════════════════════════════════════════════════════════════════╣
║  Config saved to:  PDOX_MOCK_LP_POOL.json                            ║
║  Operations:       npx ts-node mock_lp_operations.ts                 ║
╚══════════════════════════════════════════════════════════════════════╝

This mock pool simulates:
  ✅ Constant-product AMM (x * y = k)
  ✅ Swap fees accumulation
  ✅ LP token minting/burning
  ✅ LP Growth integration
  ✅ Price tracking

For mainnet deployment:
  🌐 Use Meteora UI: https://app.meteora.ag/
  🌐 PDOX Token-2022 is compatible with Meteora DLMM
`);

  // Log to automation
  try {
    const logEntry = `\n[${new Date().toISOString()}] [LP] ✅ Mock LP Pool Created: ${mockPool.solReserve / LAMPORTS_PER_SOL} SOL + ${mockPool.pdoxReserve / (10 ** pdoxDecimals) / 1e6}M PDOX\n`;
    fs.appendFileSync('../../LAUNCH_AUTOMATION_LOG.txt', logEntry);
  } catch (e) {}
  
  return mockPool;
}

// Run
setupMockLpPool()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
