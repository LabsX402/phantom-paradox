/**
 * ======================================================================
 * PHANTOM BRIDGE - Mobile/Plugin API Layer
 * ======================================================================
 * 
 * Makes Phantom Paradox friendly for Mobile Apps (iOS/Android) and Browser Extensions.
 * 
 * Features:
 * 1. Session Key Registration ("Login Once")
 * 2. Push Notifications (Balance Updates)
 * 3. Agent Status Polling (Heartbeat)
 * 
 * Mobile devices cannot keep WebSockets open 24/7, so we use REST API + Push.
 */

import { Router, Request, Response } from "express";
import { registerSessionKey } from "../netting/session";
import { redisClient, isRedisConnected } from "../shared/redis";
import { logger } from "../shared/logger";
import { getPendingIntentCount } from "../netting/engine";
import { PublicKey } from "@solana/web3.js";
import { recordHeartbeat } from "../indexer/analytics";
import nacl from "tweetnacl";
import bs58 from "bs58";

const router = Router();

// ======================================================================
// SESSION KEY REGISTRATION (The "Login Once" Feature)
// ======================================================================

/**
 * POST /mobile/session/register
 * Register a session key for mobile/plugin use
 * 
 * Body: {
 *   masterSignature: string (base64), // Master wallet signature
 *   sessionPublicKey: string,          // Session key pubkey
 *   expiry: number,                     // Unix timestamp
 *   maxSpendLimit: string              // BigInt as string (lamports)
 * }
 * 
 * Returns: {
 *   success: boolean,
 *   reason?: string
 * }
 */
router.post("/mobile/session/register", async (req: Request, res: Response) => {
  try {
    const { masterSignature, sessionPublicKey, expiry, maxSpendLimit } = req.body;
    
    if (!masterSignature || !sessionPublicKey || !expiry || !maxSpendLimit) {
      return res.status(400).json({
        success: false,
        reason: "missing_fields",
      });
    }
    
    // Extract master pubkey from signature verification (would need to be passed)
    // For now, we'll require it in the body
    const masterPubkey = req.body.masterPubkey;
    if (!masterPubkey) {
      return res.status(400).json({
        success: false,
        reason: "masterPubkey_required",
      });
    }
    
    // Validate expiry
    const now = Math.floor(Date.now() / 1000);
    if (expiry <= now) {
      return res.status(400).json({
        success: false,
        reason: "expiry_must_be_future",
      });
    }
    
    // Register session key
    const result = await registerSessionKey(
      masterPubkey,
      sessionPublicKey,
      masterSignature,
      expiry,
      BigInt(maxSpendLimit)
    );
    
    if (result.success) {
      logger.info("Mobile session key registered", {
        masterPubkey,
        sessionPublicKey,
        expiry: new Date(expiry * 1000).toISOString(),
        maxSpendLimit,
      });
      
      res.json({ success: true });
    } else {
      res.status(400).json({
        success: false,
        reason: result.reason,
      });
    }
  } catch (error) {
    logger.error("Error registering mobile session key", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      reason: "internal_error",
    });
  }
});

// ======================================================================
// PUSH NOTIFICATIONS (The "Wake Up" Signal)
// ======================================================================

/**
 * POST /mobile/device/register_token
 * Register a device token for push notifications
 * 
 * Body: {
 *   walletAddress: string,
 *   fcmToken: string,      // Firebase Cloud Messaging token
 *   platform: "ios" | "android" | "chrome"
 * }
 * 
 * Returns: {
 *   success: boolean
 * }
 */
router.post("/mobile/device/register_token", async (req: Request, res: Response) => {
  try {
    const { walletAddress, fcmToken, platform } = req.body;
    
    if (!walletAddress || !fcmToken || !platform) {
      return res.status(400).json({
        success: false,
        reason: "missing_fields",
      });
    }
    
    // Validate platform
    if (!["ios", "android", "chrome"].includes(platform)) {
      return res.status(400).json({
        success: false,
        reason: "invalid_platform",
      });
    }
    
    // Store device token in Redis
    if (isRedisConnected() && redisClient) {
      const key = `device:${walletAddress}`;
      const deviceData = JSON.stringify({
        fcmToken,
        platform,
        registeredAt: Math.floor(Date.now() / 1000),
      });
      
      // Store with 30-day expiry (tokens should be refreshed periodically)
      await redisClient.setEx(key, 30 * 24 * 60 * 60, deviceData);
      
      logger.info("Device token registered", {
        walletAddress,
        platform,
      });
      
      res.json({ success: true });
    } else {
      logger.warn("Redis not available - device token registration skipped");
      res.status(503).json({
        success: false,
        reason: "push_notifications_unavailable",
      });
    }
  } catch (error) {
    logger.error("Error registering device token", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      reason: "internal_error",
    });
  }
});

/**
 * Helper function to notify a wallet (called by engine when batch settles)
 * 
 * @param walletAddress - Wallet to notify
 * @param message - Notification message
 */
export async function notifyWallet(walletAddress: string, message: string): Promise<void> {
  if (!isRedisConnected() || !redisClient) {
    return; // Push notifications unavailable
  }
  
  try {
    const key = `device:${walletAddress}`;
    const deviceData = await redisClient.get(key);
    
    if (!deviceData) {
      // No device registered for this wallet
      return;
    }
    
    const device = JSON.parse(deviceData);
    
    // TODO: Integrate with FCM (Firebase Cloud Messaging) or APNS (Apple Push Notification Service)
    // For now, we just log the notification
    logger.info("Push notification queued", {
      walletAddress,
      platform: device.platform,
      message,
      fcmToken: device.fcmToken.substring(0, 20) + "...", // Log partial token
    });
    
    // In production, you would:
    // 1. Queue the notification in a job queue (Bull, BullMQ, etc.)
    // 2. Worker sends via FCM/APNS
    // 3. Handle delivery failures and retries
    
  } catch (error) {
    logger.error("Error sending push notification", {
      walletAddress,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ======================================================================
// AGENT STATUS (The "Heartbeat" Polling)
// ======================================================================

/**
 * GET /agent/status
 * Get current system status for agent polling
 * 
 * Returns: {
 *   piFee: string,              // Current π-Standard fee (lamports)
 *   riskScore: number,          // System risk score (0-100)
 *   poltergeistActivity: number, // Ghost trade activity level (0-100)
 *   pendingIntents: number,     // Current pending intents
 *   systemHealth: "healthy" | "degraded" | "critical"
 * }
 */
router.get("/agent/status", async (req: Request, res: Response) => {
  try {
    // Get pending intent count
    const pendingIntents = getPendingIntentCount();
    
    // Calculate risk score (simplified - in production, use more sophisticated metrics)
    let riskScore = 0;
    if (pendingIntents > 10000) {
      riskScore = 80; // High load
    } else if (pendingIntents > 5000) {
      riskScore = 50; // Medium load
    } else {
      riskScore = 20; // Low load
    }
    
    // Poltergeist activity (simplified - in production, track actual ghost injection rate)
    const poltergeistActivity = Math.min(100, Math.floor(pendingIntents / 100));
    
    // Calculate current π-Standard fee (simplified)
    // In production, this would query the last batch's piFeeLamports
    const baseFee = 5000; // Base fee in lamports
    const anonymitySet = Math.max(10, pendingIntents / 10); // Estimate
    const privacyDiscount = Math.min(0.5, anonymitySet / 200);
    const piFee = Math.floor(baseFee * (1 - privacyDiscount));
    
    // System health
    let systemHealth: "healthy" | "degraded" | "critical" = "healthy";
    if (pendingIntents > 50000) {
      systemHealth = "critical";
    } else if (pendingIntents > 20000) {
      systemHealth = "degraded";
    }
    
    res.json({
      piFee: piFee.toString(),
      riskScore,
      poltergeistActivity,
      pendingIntents,
      systemHealth,
      timestamp: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    logger.error("Error getting agent status", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: "internal_error",
    });
  }
});

// ======================================================================
// AGENT HEARTBEAT ENDPOINT (WRAITH C2)
// ======================================================================

/**
 * POST /heartbeat
 * Agent heartbeat endpoint - receives metrics from agent nodes
 * 
 * Body: {
 *   agent_id: string,
 *   metrics: {
 *     active_connections: number,
 *     bytes_relayed_delta: number,
 *     latency_ms: number,
 *     load_factor: number,
 *     speed: number,
 *     current_job: string | null
 *   },
 *   timestamp: number,
 *   signature: string (bs58 encoded)
 * }
 * 
 * Returns: {
 *   success: boolean,
 *   earnings_accumulated?: string, // Lamports accumulated
 *   next_payout_estimate?: string
 * }
 */
router.post("/heartbeat", async (req: Request, res: Response) => {
  try {
    const { agent_id, metrics, timestamp, signature } = req.body;
    
    // Validate required fields
    if (!agent_id || !metrics || !signature) {
      return res.status(400).json({
        success: false,
        error: "missing_fields",
      });
    }
    
    // Verify signature (agent must sign with their secret key)
    try {
      const payload = {
        agent_id,
        metrics,
        timestamp: timestamp || Date.now(),
      };
      const msg = new TextEncoder().encode(JSON.stringify(payload));
      const publicKey = bs58.decode(agent_id);
      const sig = bs58.decode(signature);
      
      // Verify signature
      if (!nacl.sign.detached.verify(msg, sig, publicKey)) {
        return res.status(401).json({
          success: false,
          error: "invalid_signature",
        });
      }
    } catch (sigError) {
      return res.status(401).json({
        success: false,
        error: "signature_verification_failed",
      });
    }
    
    // Record heartbeat in database
    await recordHeartbeat(agent_id, metrics.current_job || undefined, {
      active_connections: metrics.active_connections,
      bytes_relayed_delta: metrics.bytes_relayed_delta,
      latency_ms: metrics.latency_ms,
      load_factor: metrics.load_factor,
      speed: metrics.speed,
    });
    
    // Calculate earnings using PARADOX engine (π-Standard)
    // This uses a proprietary algorithm that considers:
    // - Load factor (efficiency)
    // - Bytes relayed (volume)
    // - Latency (quality)
    // - System risk score
    const { query } = await import("../shared/db");
    
    // Ensure agent_earnings table exists
    await query(`
      CREATE TABLE IF NOT EXISTS agent_earnings (
        id SERIAL PRIMARY KEY,
        agent_id TEXT NOT NULL,
        earnings_lamports BIGINT NOT NULL,
        earned_at TIMESTAMP NOT NULL DEFAULT NOW(),
        metrics JSONB
      )
    `).catch(() => {}); // Ignore if exists
    
    // Create index if it doesn't exist
    await query(`
      CREATE INDEX IF NOT EXISTS idx_agent_earned_at 
      ON agent_earnings (agent_id, earned_at)
    `).catch(() => {}); // Ignore if exists
    
    // Get agent's accumulated earnings (from last 12 hours)
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const [earningsResult] = await query(
      `SELECT COALESCE(SUM(earnings_lamports), 0) as total_earnings
       FROM agent_earnings
       WHERE agent_id = $1 AND earned_at > $2`,
      [agent_id, twelveHoursAgo]
    );
    
    const accumulatedEarnings = earningsResult?.total_earnings || "0";
    
    // Calculate current heartbeat earnings (simplified π-Standard calculation)
    // Uses load factor, bytes relayed, and system metrics
    const baseRate = 1000; // Base rate in lamports per heartbeat
    const loadMultiplier = Math.min(metrics.load_factor / 100, 1.0); // Cap at 100% load
    const volumeMultiplier = Math.min(metrics.bytes_relayed_delta / (10 * 1024 * 1024), 2.0); // Cap at 10MB
    const latencyPenalty = metrics.latency_ms > 100 ? 0.8 : 1.0; // Penalty for high latency
    
    const heartbeatEarnings = Math.floor(
      baseRate * loadMultiplier * volumeMultiplier * latencyPenalty
    );
    
    // Store earnings (if > 0)
    if (heartbeatEarnings > 0) {
      await query(
        `INSERT INTO agent_earnings (agent_id, earnings_lamports, earned_at, metrics)
         VALUES ($1, $2, NOW(), $3)`,
        [agent_id, heartbeatEarnings, JSON.stringify(metrics)]
      );
    }
    
    // Calculate next payout estimate (12 hours from now)
    const nextPayoutEstimate = BigInt(accumulatedEarnings) + BigInt(heartbeatEarnings);
    
    logger.info("Agent heartbeat received", {
      agent_id: agent_id.substring(0, 8) + "...",
      load_factor: metrics.load_factor,
      earnings: heartbeatEarnings,
      accumulated: accumulatedEarnings,
    });
    
    res.json({
      success: true,
      earnings_accumulated: nextPayoutEstimate.toString(),
      next_payout_estimate: nextPayoutEstimate.toString(),
      heartbeat_earnings: heartbeatEarnings.toString(),
    });
  } catch (error) {
    logger.error("Error processing heartbeat", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: "internal_error",
    });
  }
});

// ======================================================================
// WALLET BALANCE QUERY (Mobile-Friendly)
// ======================================================================

/**
 * GET /mobile/wallet/:walletAddress/balance
 * Get wallet balance (from database shadow indexer)
 * 
 * Returns: {
 *   walletAddress: string,
 *   balanceLamports: string,
 *   lastBatchId: string
 * }
 */
router.get("/mobile/wallet/:walletAddress/balance", async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    // Validate pubkey
    try {
      new PublicKey(walletAddress);
    } catch {
      return res.status(400).json({
        error: "invalid_wallet_address",
      });
    }
    
    // Query database (shadow indexer)
    const { query } = await import("../shared/db");
    const result = await query(
      `SELECT balance_lamports, last_batch_id 
       FROM wallet_balances 
       WHERE wallet = $1 
       ORDER BY updated_at DESC 
       LIMIT 1`,
      [walletAddress]
    );
    
    if (result.rows.length === 0) {
      return res.json({
        walletAddress,
        balanceLamports: "0",
        lastBatchId: null,
      });
    }
    
    const row = result.rows[0];
    res.json({
      walletAddress,
      balanceLamports: row.balance_lamports?.toString() || "0",
      lastBatchId: row.last_batch_id?.toString() || null,
    });
  } catch (error) {
    logger.error("Error getting wallet balance", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: "internal_error",
    });
  }
});

export default router;
export { notifyWallet };

