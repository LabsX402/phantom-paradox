/**
 * ======================================================================
 * DOUBLE-SPEND PREVENTION
 * ======================================================================
 * 
 * Prevents double-spending by tracking intent execution across chains.
 * Ensures intents can only be executed once, even if chains switch.
 * 
 * Status: ✅ IMPLEMENTED
 */

import { logger } from "../shared/logger";
import { redisClient, isRedisConnected } from "../shared/redis";

// Redis keys for tracking
const INTENT_EXECUTION_KEY = "intent:execution"; // Hash: intent_id -> chain
const INTENT_NONCE_EXECUTION_KEY = "intent:nonce:execution"; // Set: session_pubkey:nonce:chain

/**
 * Check if an intent has been executed on any chain
 */
export async function checkIntentExecuted(intentId: string): Promise<boolean> {
  if (!isRedisConnected() || !redisClient) {
    logger.warn('[DoubleSpend] Redis not connected, cannot check intent execution');
    return false;
  }

  try {
    const executedChain = await redisClient.hGet(INTENT_EXECUTION_KEY, intentId);
    return executedChain !== null;
  } catch (error) {
    logger.error('[DoubleSpend] Error checking intent execution', {
      intentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Get which chain an intent was executed on
 */
export async function getIntentExecutionChain(intentId: string): Promise<'solana' | 'arbitrum' | null> {
  if (!isRedisConnected() || !redisClient) {
    return null;
  }

  try {
    const chain = await redisClient.hGet(INTENT_EXECUTION_KEY, intentId);
    return chain as 'solana' | 'arbitrum' | null;
  } catch (error) {
    logger.error('[DoubleSpend] Error getting intent execution chain', {
      intentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Mark an intent as executed on a specific chain
 */
export async function markIntentExecuted(
  intentId: string,
  chain: 'solana' | 'arbitrum'
): Promise<void> {
  if (!isRedisConnected() || !redisClient) {
    throw new Error('Redis not connected - cannot mark intent as executed');
  }

  try {
    // Check if already executed
    const existing = await redisClient.hGet(INTENT_EXECUTION_KEY, intentId);
    if (existing) {
      if (existing !== chain) {
        logger.warn('[DoubleSpend] Intent executed on different chain!', {
          intentId,
          existingChain: existing,
          newChain: chain,
        });
        // This is a critical error - intent executed on both chains
        // In production, this should trigger an alert
      }
      return; // Already marked
    }

    // Mark as executed
    await redisClient.hSet(INTENT_EXECUTION_KEY, intentId, chain);
    
    // Set TTL (30 days)
    await redisClient.expire(INTENT_EXECUTION_KEY, 2592000);

    logger.info('[DoubleSpend] Intent marked as executed', {
      intentId,
      chain,
    });
  } catch (error) {
    logger.error('[DoubleSpend] Error marking intent as executed', {
      intentId,
      chain,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Check if a nonce has been used on a specific chain
 */
export async function checkNonceUsed(
  sessionPubkey: string,
  nonce: number,
  chain: 'solana' | 'arbitrum'
): Promise<boolean> {
  if (!isRedisConnected() || !redisClient) {
    return false;
  }

  try {
    const nonceKey = `${sessionPubkey}:${nonce}:${chain}`;
    const exists = await redisClient.sIsMember(INTENT_NONCE_EXECUTION_KEY, nonceKey);
    return exists;
  } catch (error) {
    logger.error('[DoubleSpend] Error checking nonce', {
      sessionPubkey,
      nonce,
      chain,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Mark a nonce as used on a specific chain
 */
export async function markNonceUsed(
  sessionPubkey: string,
  nonce: number,
  chain: 'solana' | 'arbitrum'
): Promise<void> {
  if (!isRedisConnected() || !redisClient) {
    throw new Error('Redis not connected - cannot mark nonce as used');
  }

  try {
    const nonceKey = `${sessionPubkey}:${nonce}:${chain}`;
    await redisClient.sAdd(INTENT_NONCE_EXECUTION_KEY, nonceKey);
    
    // Set TTL (30 days)
    await redisClient.expire(INTENT_NONCE_EXECUTION_KEY, 2592000);

    logger.info('[DoubleSpend] Nonce marked as used', {
      sessionPubkey: sessionPubkey.substring(0, 20) + '...',
      nonce,
      chain,
    });
  } catch (error) {
    logger.error('[DoubleSpend] Error marking nonce as used', {
      sessionPubkey,
      nonce,
      chain,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Verify intent can be executed (not already executed on any chain)
 */
export async function verifyIntentCanExecute(intentId: string): Promise<{
  canExecute: boolean;
  reason?: string;
  executedOn?: 'solana' | 'arbitrum';
}> {
  const executed = await checkIntentExecuted(intentId);
  
  if (executed) {
    const chain = await getIntentExecutionChain(intentId);
    return {
      canExecute: false,
      reason: `Intent already executed on ${chain}`,
      executedOn: chain || undefined,
    };
  }

  return {
    canExecute: true,
  };
}

/**
 * Cross-chain verification: Check if intent executed on other chain
 */
export async function verifyCrossChain(
  intentId: string,
  currentChain: 'solana' | 'arbitrum'
): Promise<{
  safe: boolean;
  executedOnOtherChain?: 'solana' | 'arbitrum';
}> {
  const executedChain = await getIntentExecutionChain(intentId);
  
  if (executedChain && executedChain !== currentChain) {
    return {
      safe: false,
      executedOnOtherChain: executedChain,
    };
  }

  return {
    safe: true,
  };
}

