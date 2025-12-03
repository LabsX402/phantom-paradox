/**
 * 🚀 PARADOX DEVNET LAUNCH SCRIPT
 * 
 * Creates PDOX/USDC pool on Meteora DLMM (Devnet)
 * 
 * LAUNCH PLAN:
 * - 5 SOL worth of liquidity
 * - 10% of supply (100M PDOX)
 * - Using Meteora DLMM SDK (bypasses UI issues)
 * 
 * Prerequisites:
 *   npm install @meteora-ag/dlmm @solana/web3.js @solana/spl-token bn.js bs58
 * 
 * Usage:
 *   npx ts-node launch_devnet_pool.ts
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";
import BN from "bn.js";
import * as fs from "fs";

// ============================================================================
// CONFIGURATION - PARADOX LAUNCH PARAMS
// ============================================================================

const CONFIG = {
  // Network
  DEVNET_RPC: "https://api.devnet.solana.com",
  
  // Token Mints (Updated 2025-11-30)
  // Program: 2R6Lus9psfB2dREDuC79ayfwd4peVfqG3Q42ca2iFhNV
  // IDL: FDnuHMzje5EsyWqJUiTScbUJwBfQUgmD5B6VKG1qC5xS
  PDOX_MINT: new PublicKey("4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF"),
  // Official Devnet USDC (Circle)
  USDC_DEVNET: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
  // Alternative: Native SOL wrapper
  WSOL: new PublicKey("So11111111111111111111111111111111111111112"),
  
  // Launch Parameters (5 SOL for 10% of supply)
  INITIAL_SOL_AMOUNT: 5, // 5 SOL
  INITIAL_PDOX_AMOUNT: 100_000_000, // 100M PDOX (10% of 1B supply)
  PDOX_DECIMALS: 9,
  
  // DLMM Parameters
  // Higher bin step = handles 3% transfer fee better
  BIN_STEP: 25, // 0.25% per bin
  BASE_FEE_BPS: 100, // 1% base fee to LPs
  
  // Initial price calculation:
  // 100M PDOX / 5 SOL = 20M PDOX per SOL
  // Active Bin ID determines starting price point
  ACTIVE_BIN_ID: 0, // Will be auto-calculated
};

// ============================================================================
// HELPERS
// ============================================================================

function loadWallet(walletPath: string): Keypair {
  const walletFile = fs.readFileSync(walletPath, "utf-8");
  const secretKey = Uint8Array.from(JSON.parse(walletFile));
  return Keypair.fromSecretKey(secretKey);
}

function logSection(title: string) {
  console.log("\n" + "═".repeat(70));
  console.log(`  ${title}`);
  console.log("═".repeat(70));
}

function logSuccess(msg: string) { console.log(`✅ ${msg}`); }
function logInfo(msg: string) { console.log(`ℹ️  ${msg}`); }
function logWarn(msg: string) { console.log(`⚠️  ${msg}`); }
function logError(msg: string) { console.error(`❌ ${msg}`); }

// ============================================================================
// MAIN LAUNCH FUNCTION
// ============================================================================

async function launchParadoxPool() {
  logSection("🚀 PARADOX DEVNET LAUNCH");
  
  const connection = new Connection(CONFIG.DEVNET_RPC, "confirmed");
  
  // Load deployer wallet
  const walletPath = "../../deployer_wallet.json";
  const payer = loadWallet(walletPath);
  
  logInfo(`Deployer: ${payer.publicKey.toBase58()}`);
  logInfo(`PDOX Mint: ${CONFIG.PDOX_MINT.toBase58()}`);
  
  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  logInfo(`SOL Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  if (balance < CONFIG.INITIAL_SOL_AMOUNT * LAMPORTS_PER_SOL + 0.5 * LAMPORTS_PER_SOL) {
    logError(`Need at least ${CONFIG.INITIAL_SOL_AMOUNT + 0.5} SOL (${CONFIG.INITIAL_SOL_AMOUNT} for LP + fees)`);
    process.exit(1);
  }
  
  logSection("LAUNCH PARAMETERS");
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                     PARADOX LAUNCH CONFIGURATION                      ║
╠══════════════════════════════════════════════════════════════════════╣
║  Initial SOL:     ${CONFIG.INITIAL_SOL_AMOUNT.toString().padEnd(10)} SOL                                  ║
║  Initial PDOX:    ${(CONFIG.INITIAL_PDOX_AMOUNT / 1e6).toString().padEnd(10)} M PDOX (10% of supply)          ║
║  Initial Price:   1 SOL = ${(CONFIG.INITIAL_PDOX_AMOUNT / CONFIG.INITIAL_SOL_AMOUNT / 1e6).toFixed(0).padEnd(5)} M PDOX                       ║
║  Bin Step:        ${CONFIG.BIN_STEP.toString().padEnd(10)} (${(CONFIG.BIN_STEP / 100)}% per bin)                  ║
║  Base Fee:        ${CONFIG.BASE_FEE_BPS.toString().padEnd(10)} bps (${CONFIG.BASE_FEE_BPS / 100}% to LPs)               ║
║  Network:         Devnet                                             ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  logSection("CHECKING METEORA DLMM PROGRAM");
  
  // Meteora DLMM Program ID on Devnet
  const DLMM_PROGRAM_ID = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
  
  const programInfo = await connection.getAccountInfo(DLMM_PROGRAM_ID);
  if (!programInfo) {
    logError("Meteora DLMM program not found on devnet!");
    logInfo("The program may have moved. Check Meteora docs.");
    process.exit(1);
  }
  
  logSuccess(`Meteora DLMM found: ${DLMM_PROGRAM_ID.toBase58()}`);
  
  logSection("CREATING POOL");
  
  try {
    // Method 1: Try using DLMM.create (newer SDK)
    logInfo("Attempting pool creation via SDK...");
    
    // Get preset configs first to find a valid one
    logInfo("Fetching available DLMM presets...");
    
    // Try to create pool
    // Note: The exact method depends on SDK version
    // Some versions use DLMM.createLbPair, others use different methods
    
    try {
      // Try using createLbPair (older method)
      const createResult = await DLMM.createLbPair(
        connection,
        payer.publicKey,
        CONFIG.PDOX_MINT,
        CONFIG.WSOL, // Use wSOL for PDOX/SOL pair
        CONFIG.BIN_STEP,
        {
          cluster: "devnet",
        }
      );
      
      if (createResult) {
        logSuccess("Pool creation transaction generated!");
        
        // Save result
        const poolInfo = {
          status: "PENDING_CONFIRMATION",
          pdoxMint: CONFIG.PDOX_MINT.toBase58(),
          quoteMint: CONFIG.WSOL.toBase58(),
          binStep: CONFIG.BIN_STEP,
          baseFee: CONFIG.BASE_FEE_BPS,
          initialSol: CONFIG.INITIAL_SOL_AMOUNT,
          initialPdox: CONFIG.INITIAL_PDOX_AMOUNT,
          network: "devnet",
          createdAt: new Date().toISOString(),
        };
        
        fs.writeFileSync("PARADOX_POOL_LAUNCH.json", JSON.stringify(poolInfo, null, 2));
        logSuccess("Pool info saved to PARADOX_POOL_LAUNCH.json");
        
        return createResult;
      }
    } catch (sdkError: any) {
      logWarn(`SDK create failed: ${sdkError.message}`);
      logInfo("Trying alternative method...");
    }
    
    // Method 2: Search for existing pools or create via different approach
    logInfo("Searching for existing PDOX pools...");
    
    const allPools = await DLMM.getLbPairs(connection, {
      cluster: "devnet"
    });
    
    logInfo(`Found ${allPools.length} DLMM pools on devnet`);
    
    // Check if PDOX pool already exists
    const existingPool = allPools.find(pool => 
      pool.tokenX.publicKey.equals(CONFIG.PDOX_MINT) || 
      pool.tokenY.publicKey.equals(CONFIG.PDOX_MINT)
    );
    
    if (existingPool) {
      logSuccess("Found existing PDOX pool!");
      logInfo(`Pool Address: ${existingPool.publicKey.toBase58()}`);
      
      const poolInfo = {
        status: "EXISTING_POOL",
        poolAddress: existingPool.publicKey.toBase58(),
        tokenX: existingPool.tokenX.publicKey.toBase58(),
        tokenY: existingPool.tokenY.publicKey.toBase58(),
        network: "devnet",
        foundAt: new Date().toISOString(),
      };
      
      fs.writeFileSync("PARADOX_POOL_LAUNCH.json", JSON.stringify(poolInfo, null, 2));
      return existingPool.publicKey.toBase58();
    }
    
    // If no pool found, provide manual instructions
    logWarn("Could not create pool programmatically.");
    logInfo("");
    logInfo("MANUAL CREATION STEPS:");
    logInfo("1. Go to https://app.meteora.ag/dlmm/create-pool");
    logInfo("2. Select Devnet network");
    logInfo(`3. Token X: ${CONFIG.PDOX_MINT.toBase58()}`);
    logInfo("4. Token Y: SOL (native)");
    logInfo(`5. Bin Step: ${CONFIG.BIN_STEP}`);
    logInfo(`6. Initial Price: ${CONFIG.INITIAL_PDOX_AMOUNT / CONFIG.INITIAL_SOL_AMOUNT / 1e6}M PDOX per SOL`);
    logInfo("");
    
    // Create config file for manual reference
    const manualConfig = {
      status: "MANUAL_CREATION_REQUIRED",
      pdoxMint: CONFIG.PDOX_MINT.toBase58(),
      quoteMint: CONFIG.WSOL.toBase58(),
      binStep: CONFIG.BIN_STEP,
      baseFee: CONFIG.BASE_FEE_BPS,
      initialSol: CONFIG.INITIAL_SOL_AMOUNT,
      initialPdox: CONFIG.INITIAL_PDOX_AMOUNT,
      initialPrice: `${CONFIG.INITIAL_PDOX_AMOUNT / CONFIG.INITIAL_SOL_AMOUNT / 1e6}M PDOX per SOL`,
      instructions: "Use Meteora UI or SDK with valid preset config",
      network: "devnet",
      createdAt: new Date().toISOString(),
    };
    
    fs.writeFileSync("PARADOX_POOL_LAUNCH.json", JSON.stringify(manualConfig, null, 2));
    logSuccess("Config saved to PARADOX_POOL_LAUNCH.json");
    
  } catch (error: any) {
    logError(`Pool creation failed: ${error.message || error}`);
    
    // Provide troubleshooting hints
    logInfo("");
    logInfo("TROUBLESHOOTING:");
    logInfo("1. 'Config Unavailable' - Use a standard BinStep/Fee pair that exists on Devnet");
    logInfo("2. 'Simulation Error' - Token-2022 may need special handling");
    logInfo("3. 'Insufficient funds' - Need more SOL for rent + fees");
    logInfo("");
    logInfo("HINT: Try using different binStep values: 10, 15, 20, 25, 50, 100");
    
    // Save error for debugging
    const errorLog = {
      status: "FAILED",
      error: error.message || String(error),
      config: {
        pdoxMint: CONFIG.PDOX_MINT.toBase58(),
        binStep: CONFIG.BIN_STEP,
        baseFee: CONFIG.BASE_FEE_BPS,
      },
      timestamp: new Date().toISOString(),
    };
    
    fs.writeFileSync("PARADOX_POOL_ERROR.json", JSON.stringify(errorLog, null, 2));
  }
  
  return null;
}

// ============================================================================
// ENTRY POINT
// ============================================================================

launchParadoxPool()
  .then((result) => {
    if (result) {
      console.log(`\n✅ Pool Address: ${result}\n`);
      console.log(`View on Solscan: https://solscan.io/account/${result}?cluster=devnet`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  });

