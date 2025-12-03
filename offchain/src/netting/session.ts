/**
 * ======================================================================
 * SESSION KEY VALIDATION
 * ======================================================================
 * 
 * Validates session keys and trade intents.
 * 
 * Responsibilities:
 * - Verify session key policies (expiry, volume limits)
 * - Verify intent signatures
 * - Check intent constraints against policies
 * 
 * NOTE: All TradeIntents MUST pass verifyIntentSignature() here. 
 * This is the single gate. There is no bypass path in production.
 */

import { PublicKey } from "@solana/web3.js";
import { SessionKeyPolicy, TradeIntent, IntentValidationResult, AllowedAction } from "./types";
import { logger } from "../shared/logger";
import nacl from "tweetnacl";
import { redisClient, isRedisConnected } from "../shared/redis";

/**
 * In-memory store of active session key policies (fallback if Redis unavailable)
 * In production, this would be backed by Redis/DB
 */
const sessionKeyPolicies = new Map<string, SessionKeyPolicy>();

/**
 * Track spent volume per session key (fallback if Redis unavailable)
 */
const sessionKeySpent = new Map<string, bigint>();

/**
 * Register a session key policy
 * Stores in Redis if available, falls back to in-memory
 */
export async function registerSessionKeyPolicy(policy: SessionKeyPolicy): Promise<void> {
  const key = `session:${policy.ownerPubkey}:${policy.sessionPubkey}`;
  
  // Store in Redis if available
  if (isRedisConnected() && redisClient) {
    try {
      const policyData = JSON.stringify({
        ownerPubkey: policy.ownerPubkey,
        sessionPubkey: policy.sessionPubkey,
        maxVolumeLamports: policy.maxVolumeLamports.toString(),
        expiresAt: policy.expiresAt,
        allowedActions: policy.allowedActions,
        createdAt: policy.createdAt || Math.floor(Date.now() / 1000),
      });
      
      // Store policy with TTL (expires when session expires)
      const ttl = policy.expiresAt - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await redisClient.setEx(key, ttl, policyData);
        await redisClient.set(`${key}:spent`, "0");
      }
    } catch (error) {
      logger.warn("Failed to store session key in Redis, using in-memory fallback", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  // Always store in-memory as fallback
  sessionKeyPolicies.set(key, policy);
  sessionKeySpent.set(key, 0n);
  
  logger.info("Session key policy registered", {
    owner: policy.ownerPubkey,
    session: policy.sessionPubkey,
    maxVolume: policy.maxVolumeLamports.toString(),
    expiresAt: new Date(policy.expiresAt * 1000).toISOString(),
    storage: isRedisConnected() ? "redis" : "memory",
  });
}

/**
 * Register a session key from mobile bridge (with master signature verification)
 * This is the "Login Once" feature for mobile apps
 */
export async function registerSessionKey(
  masterPubkey: string,
  sessionPubkey: string,
  masterSignature: string,
  expiry: number,
  maxSpendLimit: bigint
): Promise<{ success: boolean; reason?: string }> {
  // Verify master signature
  // The signature should be of a message containing: sessionPubkey, expiry, maxSpendLimit
  const message = JSON.stringify({
    type: "session_key_authorization",
    masterPubkey,
    sessionPubkey,
    expiry,
    maxSpendLimit: maxSpendLimit.toString(),
  });
  
  try {
    const messageBytes = Buffer.from(message);
    const signatureBytes = Buffer.from(masterSignature, "base64");
    const masterKey = new PublicKey(masterPubkey);
    
    // Verify signature
    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      masterKey.toBuffer()
    );
    
    if (!isValid) {
      return { success: false, reason: "Invalid master signature" };
    }
    
    // Create policy
    const policy: SessionKeyPolicy = {
      ownerPubkey: masterPubkey,
      sessionPubkey,
      maxVolumeLamports: maxSpendLimit,
      expiresAt: expiry,
      allowedActions: ["TRADE"], // Scoped: Trade ONLY, No Withdrawals
      createdAt: Math.floor(Date.now() / 1000),
    };
    
    // Register policy
    await registerSessionKeyPolicy(policy);
    
    return { success: true };
  } catch (error) {
    logger.error("Failed to register session key", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, reason: "Internal error" };
  }
}

/**
 * Get a session key policy
 * Checks Redis first, falls back to in-memory
 */
export async function getSessionKeyPolicy(
  ownerPubkey: string,
  sessionPubkey: string
): Promise<SessionKeyPolicy | null> {
  const key = `session:${ownerPubkey}:${sessionPubkey}`;
  
  // Try Redis first
  if (isRedisConnected() && redisClient) {
    try {
      const policyData = await redisClient.get(key);
      if (policyData) {
        const parsed = JSON.parse(policyData);
        return {
          ownerPubkey: parsed.ownerPubkey,
          sessionPubkey: parsed.sessionPubkey,
          maxVolumeLamports: BigInt(parsed.maxVolumeLamports),
          expiresAt: parsed.expiresAt,
          allowedActions: parsed.allowedActions,
          createdAt: parsed.createdAt,
        };
      }
    } catch (error) {
      logger.warn("Failed to get session key from Redis, using in-memory fallback", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  // Fallback to in-memory (use the key format without "session:" prefix for backward compat)
  const memoryKey = `${ownerPubkey}:${sessionPubkey}`;
  return sessionKeyPolicies.get(memoryKey) || null;
}

/**
 * Validate a session key policy
 */
export function validateSessionKeyPolicy(
  policy: SessionKeyPolicy
): { valid: boolean; reason?: string } {
  const now = Math.floor(Date.now() / 1000);
  
  // Check expiry
  if (policy.expiresAt <= now) {
    return { valid: false, reason: "Session key expired" };
  }
  
  // Check max volume
  const key = `${policy.ownerPubkey}:${policy.sessionPubkey}`;
  const spent = sessionKeySpent.get(key) || 0n;
  if (spent >= policy.maxVolumeLamports) {
    return { valid: false, reason: "Session key volume limit exceeded" };
  }
  
  return { valid: true };
}

/**
 * Verify a trade intent signature
 * 
 * CRITICAL: This uses nacl (tweetnacl) for Ed25519 signature verification.
 * If this is stubbed (returns true), anyone can drain the entire game economy
 * by sending fake signatures.
 * 
 * @param intent The trade intent to verify
 * @returns true if signature is valid
 */
export async function verifyIntentSignature(
  intent: TradeIntent
): Promise<boolean> {
  try {
    // Construct the message that was signed
    const message = constructIntentMessage(intent);
    
    // 1. Construct the message EXACTLY as the client signed it
    // CRITICAL: The serialization order must match the client-side exactly.
    // Ideally, use a canonical serialization like Borsh, but JSON works if strictly ordered.
    // For this implementation, we assume the message is the stringified payload.
    const messageString = constructIntentMessage(intent);
    const messageBuffer = Buffer.from(messageString, "utf-8");
    
    // 2. Decode the signature
    let signatureBuffer: Buffer;
    try {
      signatureBuffer = Buffer.from(intent.signature, "base64");
    } catch {
      // Fallback to hex if base64 fails
      try {
        signatureBuffer = Buffer.from(intent.signature, "hex");
      } catch {
        logger.error("Invalid signature format (not base64 or hex)", {
          intentId: intent.id,
        });
        return false;
      }
    }
    
    // 3. Decode the session public key
    const sessionKeyBuffer = new PublicKey(intent.sessionPubkey).toBuffer();
    
    // 4. Verify using Ed25519 (TweetNaCl)
    const isValid = nacl.sign.detached.verify(
      messageBuffer,
      signatureBuffer,
      sessionKeyBuffer
    );
    
    if (!isValid) {
      logger.warn("Intent signature verification failed", {
        intentId: intent.id,
        sessionPubkey: intent.sessionPubkey.substring(0, 20) + "...",
      });
    }
    
    return isValid;
  } catch (error) {
    logger.error("Error verifying intent signature", {
      intentId: intent.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return false;
  }
}

/**
 * Construct the message that should be signed for an intent
 * 
 * NOTE: Ensure your Frontend/Client uses this EXACT same structure and order.
 * We intentionally exclude signature and createdAt from the *signed message*
 * if the client doesn't include them in the signature payload.
 * 
 * For production, consider using a binary format (Borsh) to avoid JSON spacing issues.
 */
function constructIntentMessage(intent: TradeIntent): string {
  // Simple deterministic JSON stringification
  // CRITICAL: The serialization order must match the client-side exactly.
  // Adjust this object to match exactly what your client.signMessage() receives.
  const payload = {
    id: intent.id,
    sessionPubkey: intent.sessionPubkey,
    ownerPubkey: intent.ownerPubkey,
    itemId: intent.itemId,
    from: intent.from,
    to: intent.to,
    amountLamports: intent.amountLamports.toString(),
    nonce: intent.nonce,
    // We intentionally exclude signature/createdAt/gameId from the *signed message*
    // if the client doesn't include them in the signature payload.
    intentType: intent.intentType || "TRADE",
  };
  return JSON.stringify(payload);
}

/**
 * Validate a trade intent against its session key policy
 * 
 * CRITICAL: Signature verification is the FIRST check (single gate).
 * No intent can be marked valid without passing verifyIntentSignature().
 * 
 * The only exception is if ALLOW_UNSIGNED_INTENTS=true (dev/test only).
 */
export async function validateTradeIntent(
  intent: TradeIntent
): Promise<IntentValidationResult> {
  // ======================================================================
  // SINGLE GATE: Signature Verification (FIRST CHECK)
  // ======================================================================
  // CRITICAL: Before any policy checks, verify the signature.
  // This is the single gate that prevents forged intents.
  const allowUnsigned = process.env.ALLOW_UNSIGNED_INTENTS === "true";
  
  // CRITICAL: HARD FAIL in production if bypass enabled
  if (allowUnsigned && process.env.NODE_ENV === "production") {
    logger.error("🚨 CRITICAL SECURITY VIOLATION: ALLOW_UNSIGNED_INTENTS=true in PRODUCTION!");
    logger.error("🚨 This allows anyone to forge intents - SHUTTING DOWN");
    process.exit(1); // HARD FAIL - Do not allow unsigned intents in production
  }
  
  if (!allowUnsigned) {
    const sigValid = await verifyIntentSignature(intent);
    if (!sigValid) {
      return {
        valid: false,
        reason: "Invalid signature",
      };
    }
  } else {
    // Dev/test mode bypass - log warning
    logger.warn("⚠️ ALLOW_UNSIGNED_INTENTS=true - Signature verification bypassed (DEV/TEST ONLY)", {
      intentId: intent.id,
      sessionPubkey: intent.sessionPubkey.substring(0, 20) + "...",
    });
  }
  
  // ======================================================================
  // POLICY CHECKS (after signature verification)
  // ======================================================================
  // Get session key policy
  const policy = await getSessionKeyPolicy(intent.ownerPubkey, intent.sessionPubkey);
  
  if (!policy) {
    return {
      valid: false,
      reason: "Session key policy not found",
    };
  }
  
  // Validate policy (expiry, volume)
  const policyValidation = validateSessionKeyPolicy(policy);
  if (!policyValidation.valid) {
    return {
      valid: false,
      reason: policyValidation.reason,
      policy,
    };
  }
  
  // Check if action is allowed
  if (intent.intentType && !policy.allowedActions.includes(intent.intentType)) {
    return {
      valid: false,
      reason: `Action ${intent.intentType} not allowed for this session key`,
      policy,
    };
  }
  
  // Check volume limit
  // CRITICAL: Load volume from Redis first (persistent, serverless-friendly), then check in-memory cache
  // Fix for M-3: Session Key Volume Tracking (Off-Chain State) vulnerability
  // Prevents volume limit bypass on service restart (similar to XDEX audit finding)
  // ELIMINATES SERVER-TANK RISK: Uses Redis instead of PostgreSQL
  let spent = 0n;
  try {
    const { getSessionKeyVolume } = await import("./redis-persistence");
    const redisVolume = await getSessionKeyVolume(intent.ownerPubkey, intent.sessionPubkey);
    const memorySpent = sessionKeySpent.get(`${intent.ownerPubkey}:${intent.sessionPubkey}`) || 0n;
    // Use maximum of both to prevent bypass
    spent = redisVolume > memorySpent ? redisVolume : memorySpent;
  } catch (error) {
    // Fallback to in-memory if Redis fails
    logger.warn("Failed to load session key volume from Redis, using in-memory", {
      error: error instanceof Error ? error.message : String(error),
    });
    const key = `${intent.ownerPubkey}:${intent.sessionPubkey}`;
    spent = sessionKeySpent.get(key) || 0n;
  }
  
  const newSpent = spent + intent.amountLamports;

  if (newSpent > policy.maxVolumeLamports) {
    return {
      valid: false,
      reason: "Intent would exceed session key volume limit",
      policy,
    };
  }
  
  // CRITICAL: Persist volume to Redis after validation (atomic increment)
  // ELIMINATES SERVER-TANK RISK: Uses Redis instead of PostgreSQL
  try {
    const { incrementSessionKeyVolume } = await import("./redis-persistence");
    await incrementSessionKeyVolume(intent.ownerPubkey, intent.sessionPubkey, intent.amountLamports);
  } catch (error) {
    // Non-fatal - in-memory tracking continues
    logger.warn("Failed to persist session key volume to Redis", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  
  // Also update in-memory cache
  const key = `${intent.ownerPubkey}:${intent.sessionPubkey}`;
  sessionKeySpent.set(key, newSpent);
  
  // All checks passed
  return {
    valid: true,
    policy,
  };
}

/**
 * Record intent volume (call after intent is accepted)
 */
export function recordIntentVolume(
  ownerPubkey: string,
  sessionPubkey: string,
  amountLamports: bigint
): void {
  const key = `${ownerPubkey}:${sessionPubkey}`;
  const current = sessionKeySpent.get(key) || 0n;
  sessionKeySpent.set(key, current + amountLamports);
}

/**
 * Reset session key spent volume (for testing)
 */
export function resetSessionKeyVolume(
  ownerPubkey: string,
  sessionPubkey: string
): void {
  const key = `${ownerPubkey}:${sessionPubkey}`;
  sessionKeySpent.set(key, 0n);
}

/**
 * Get current spent volume for a session key
 */
export function getSessionKeySpent(
  ownerPubkey: string,
  sessionPubkey: string
): bigint {
  const key = `${ownerPubkey}:${sessionPubkey}`;
  return sessionKeySpent.get(key) || 0n;
}

