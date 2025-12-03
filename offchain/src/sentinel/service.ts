/**
 * ======================================================================
 * PARADOX SENTINEL - Solvency Watchtower Service
 * ======================================================================
 * 
 * Independent watchtower that monitors system solvency in real-time.
 * 
 * Responsibilities:
 * - Monitor user balances in Wraith DB
 * - Monitor OREX vault balance on Solana
 * - Check solvency invariant: hard_assets + pending_inflow >= soft_liabilities
 * - Trigger emergency pause on insolvency detection
 */

import dotenv from "dotenv";
dotenv.config();

import { Connection, PublicKey, clusterApiUrl, Keypair } from "@solana/web3.js";
import { getTokenAccountBalance } from "@solana/spl-token";
import { query } from "../shared/db";
import { logger } from "../shared/logger";
import { pauseEngine } from "../netting/engine";
import { getProgram } from "../shared/solana";
import { startLpHealthMonitoring } from "./lp_health";

/**
 * Configuration
 */
const CHECK_INTERVAL_MS = 10_000; // 10 seconds
const INSOLVENCY_THRESHOLD_LAMPORTS = 1_000_000_000n; // 1 SOL default
const RPC_URL = process.env.SOLANA_RPC_URL || process.env.RPC_URL || clusterApiUrl("devnet");
const PROGRAM_ID = new PublicKey(
  process.env.PHANTOMGRID_PROGRAM_ID || process.env.PROGRAM_ID || "8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x"
);
const GAME_ID = parseInt(process.env.GAME_ID || "1", 10);
const AUTO_PAUSE_ONCHAIN = process.env.SENTINEL_AUTO_PAUSE_ONCHAIN === "true";

/**
 * Sentinel state
 */
let isRunning = false;
let checkInterval: NodeJS.Timeout | null = null;
let lpHealthInterval: NodeJS.Timeout | null = null;
let lastCheckTime = 0;

/**
 * Get OREX vault balance from Solana
 * The vault is a PDA: [VAULT_SEED, game.key()]
 */
async function getVaultBalance(gameId: number): Promise<bigint> {
  try {
    const connection = new Connection(RPC_URL, "confirmed");
    
    // Derive game PDA: [GAME_SEED, game_id.to_le_bytes()]
    const gameIdBuffer = Buffer.allocUnsafe(8);
    gameIdBuffer.writeBigUInt64LE(BigInt(gameId), 0);
    
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), gameIdBuffer],
      PROGRAM_ID
    );
    
    // Derive vault PDA: [VAULT_SEED, game.key()]
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), gamePda.toBuffer()],
      PROGRAM_ID
    );
    
    logger.debug("🔍 [SENTINEL] Vault PDA", {
      gameId,
      gamePda: gamePda.toBase58(),
      vaultPda: vaultPda.toBase58(),
    });
    
    // Get token account balance
    // Note: The vault is a token account, so we need to get its balance
    try {
      const balance = await getTokenAccountBalance(connection, vaultPda);
      return BigInt(balance.amount.toString());
    } catch (error) {
      // Vault might not exist yet or might be a native SOL account
      // Try native balance as fallback
      try {
        const nativeBalance = await connection.getBalance(vaultPda);
        return BigInt(nativeBalance);
      } catch (nativeError) {
        logger.warn("🔍 [SENTINEL] Vault account not found", {
          vaultPda: vaultPda.toBase58(),
          gameId,
        });
        return 0n;
      }
    }
  } catch (error) {
    logger.error("🔍 [SENTINEL] Failed to get vault balance", {
      error: error instanceof Error ? error.message : String(error),
      gameId,
    });
    return 0n;
  }
}

/**
 * Get sum of all user balances from database
 */
async function getSoftLiabilities(): Promise<bigint> {
  try {
    // Sum all wallet balances from wallet_balances table
    const result = await query(
      `SELECT SUM(balance_lamports::bigint) as total_liabilities
       FROM wallet_balances
       WHERE game_id = $1`,
      [GAME_ID]
    );
    
    const total = result.rows[0]?.total_liabilities;
    if (!total) {
      return 0n;
    }
    
    // PostgreSQL returns bigint as string
    return BigInt(total.toString());
  } catch (error) {
    logger.error("🔍 [SENTINEL] Failed to get soft liabilities", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0n;
  }
}

/**
 * Get pending incoming transactions (unconfirmed deposits)
 * This is a simplified check - in production, you'd track pending transactions
 */
async function getPendingInflow(): Promise<bigint> {
  try {
    // Check for unconfirmed trade intents that represent incoming funds
    // This is a simplified version - in production, track pending deposits separately
    const result = await query(
      `SELECT SUM(amount_lamports::bigint) as pending
       FROM trade_intents
       WHERE intent_status = 'pending'
         AND created_at > NOW() - INTERVAL '5 minutes'
         AND amount_lamports > 0`,
      []
    );
    
    const pending = result.rows[0]?.pending;
    if (!pending) {
      return 0n;
    }
    
    return BigInt(pending.toString());
  } catch (error) {
    // Table might not exist or have different schema
    logger.warn("🔍 [SENTINEL] Could not get pending inflow", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0n;
  }
}

/**
 * Call on-chain emergency pause (if configured)
 */
async function callOnChainPause(): Promise<void> {
  if (!AUTO_PAUSE_ONCHAIN) {
    logger.info("🔍 [SENTINEL] Auto-pause on-chain disabled (set SENTINEL_AUTO_PAUSE_ONCHAIN=true to enable)");
    return;
  }

  try {
    const program = getProgram();
    const governanceSecretKey = process.env.GOVERNANCE_SECRET_KEY;
    
    if (!governanceSecretKey) {
      logger.warn("🔍 [SENTINEL] GOVERNANCE_SECRET_KEY not set, cannot pause on-chain");
      return;
    }
    
    const governanceKeypair = Keypair.fromSecretKey(
      Buffer.from(JSON.parse(governanceSecretKey))
    );
    
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
    
    // Call update_config to pause settlements
    await program.methods
      .updateConfig({
        pausedSettlements: true,
        // Keep other fields unchanged - we need to fetch current config first
      })
      .accounts({
        config: configPda,
        governance: governanceKeypair.publicKey,
      })
      .signers([governanceKeypair])
      .rpc();
    
    logger.error("🔍 [SENTINEL] On-chain pause activated successfully");
  } catch (error) {
    logger.error("🔍 [SENTINEL] Failed to call on-chain pause", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Perform solvency check
 */
async function performSolvencyCheck(): Promise<void> {
  const checkStart = Date.now();
  
  try {
    // 1. Get soft liabilities (sum of all user balances in DB)
    const softLiabilities = await getSoftLiabilities();
    
    // 2. Get hard assets (OREX vault balance on-chain)
    const hardAssets = await getVaultBalance(GAME_ID);
    
    // 3. Get pending inflow (unconfirmed incoming transactions)
    const pendingInflow = await getPendingInflow();
    
    // 4. Check invariant: hard_assets + pending_inflow >= soft_liabilities
    const totalAssets = hardAssets + pendingInflow;
    const gap = softLiabilities > totalAssets ? softLiabilities - totalAssets : 0n;
    
    // Log status
    logger.info("🔍 [SENTINEL] Solvency check", {
      softLiabilities: softLiabilities.toString(),
      hardAssets: hardAssets.toString(),
      pendingInflow: pendingInflow.toString(),
      totalAssets: totalAssets.toString(),
      gap: gap.toString(),
      gapSOL: (Number(gap) / 1e9).toFixed(6),
      status: gap > INSOLVENCY_THRESHOLD_LAMPORTS ? "⚠️ INSOLVENT" : "✅ SOLVENT",
    });
    
    // 5. Trigger if insolvency detected
    if (gap > INSOLVENCY_THRESHOLD_LAMPORTS) {
      const gapSOL = Number(gap) / 1e9;
      
      logger.error("🚨 [SENTINEL] CRITICAL ALERT: Insolvency Detected!", {
        gapSOL: gapSOL.toFixed(6),
        gapLamports: gap.toString(),
        softLiabilities: softLiabilities.toString(),
        hardAssets: hardAssets.toString(),
        pendingInflow: pendingInflow.toString(),
      });
      
      // Action 1: Pause off-chain engine
      pauseEngine();
      
      // Action 2: Call on-chain pause (if configured)
      await callOnChainPause();
      
      // Action 3: Log critical alert (could also send webhook/email here)
      logger.error("🚨 [SENTINEL] System paused due to insolvency. Manual intervention required.");
    }
    
    lastCheckTime = Date.now();
  } catch (error) {
    logger.error("🔍 [SENTINEL] Error during solvency check", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
  
  const checkDuration = Date.now() - checkStart;
  if (checkDuration > 5000) {
    logger.warn("🔍 [SENTINEL] Solvency check took longer than expected", {
      durationMs: checkDuration,
    });
  }
}

/**
 * Start the Sentinel service
 */
export function startSentinel(): void {
  if (isRunning) {
    logger.warn("🔍 [SENTINEL] Already running");
    return;
  }
  
  logger.info("🔍 [SENTINEL] Starting Paradox Sentinel...", {
    checkIntervalMs: CHECK_INTERVAL_MS,
    thresholdSOL: (Number(INSOLVENCY_THRESHOLD_LAMPORTS) / 1e9).toFixed(6),
    gameId: GAME_ID,
    autoPauseOnchain: AUTO_PAUSE_ONCHAIN,
  });
  
  isRunning = true;
  
  // Perform initial check immediately
  performSolvencyCheck().catch(err => {
    logger.error("🔍 [SENTINEL] Initial check failed", { error: err });
  });
  
  // Then check every interval
  checkInterval = setInterval(() => {
    performSolvencyCheck().catch(err => {
      logger.error("🔍 [SENTINEL] Periodic check failed", { error: err });
    });
  }, CHECK_INTERVAL_MS);
  
  // Start LP health monitoring (AI Sentinel)
  // TODO: Get LP token account and manager pubkey from config
  // For now, this is a placeholder - will be enabled when LP is initialized
  // const lpTokenAccount = new PublicKey(process.env.LP_TOKEN_ACCOUNT || "");
  // const pdoxMint = new PublicKey(process.env.PDOX_MINT || "");
  // const managerPubkey = new PublicKey(process.env.LP_GROWTH_MANAGER || "");
  // if (lpTokenAccount && pdoxMint && managerPubkey) {
  //   const connection = new Connection(RPC_URL, "confirmed");
  //   lpHealthInterval = startLpHealthMonitoring(connection, lpTokenAccount, pdoxMint, managerPubkey);
  //   logger.info("✅ [SENTINEL] LP health monitoring started");
  // }
  
  logger.info("✅ [SENTINEL] Paradox Sentinel started");
}

/**
 * Stop the Sentinel service
 */
export function stopSentinel(): void {
  if (!isRunning) {
    return;
  }
  
  logger.info("🔍 [SENTINEL] Stopping Paradox Sentinel...");
  
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  
  if (lpHealthInterval) {
    clearInterval(lpHealthInterval);
    lpHealthInterval = null;
  }
  
  isRunning = false;
  logger.info("✅ [SENTINEL] Paradox Sentinel stopped");
}

/**
 * Get Sentinel status
 */
export function getSentinelStatus(): {
  running: boolean;
  lastCheckTime: number;
  checkIntervalMs: number;
} {
  return {
    running: isRunning,
    lastCheckTime,
    checkIntervalMs: CHECK_INTERVAL_MS,
  };
}

/**
 * Main entry point (if run directly)
 */
if (require.main === module) {
  // Initialize database connection
  import("../shared/db")
    .then(async ({ initDatabase }) => {
      await initDatabase();
      startSentinel();
      
      // Graceful shutdown
      process.on("SIGINT", () => {
        logger.info("🔍 [SENTINEL] Received SIGINT, shutting down...");
        stopSentinel();
        process.exit(0);
      });
      
      process.on("SIGTERM", () => {
        logger.info("🔍 [SENTINEL] Received SIGTERM, shutting down...");
        stopSentinel();
        process.exit(0);
      });
    })
    .catch(error => {
      logger.error("🔍 [SENTINEL] Failed to start", { error });
      process.exit(1);
    });
}

