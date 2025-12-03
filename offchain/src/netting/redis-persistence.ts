/**
 * ======================================================================
 * REDIS-BASED INTENT PERSISTENCE (SERVERLESS-OPTIMIZED)
 * ======================================================================
 * 
 * Replaces PostgreSQL intent queues with Redis Streams + RedisHash for recovery.
 * This eliminates the SERVER-TANK RISK by removing PostgreSQL dependency for intent queues.
 * 
 * Architecture:
 * - Redis Streams: Intent queue (XADD/XREAD for FIFO processing)
 * - Redis Hash: Intent data storage (HSET/HGET for recovery)
 * - Redis Sets: Nonce tracking (SADD/SISMEMBER for replay protection)
 * - Redis Hash: Session key volume tracking (HINCRBY for atomic updates)
 * 
 * Benefits:
 * - Serverless-friendly (Upstash Redis free tier: 10K commands/day)
 * - No PostgreSQL connection pooling needed
 * - Fast in-memory operations
 * - Automatic expiration (TTL on intents)
 * - Recovery via RedisHash if stream is lost
 */

import { TradeIntent, NettingBatch, NettingResult } from "./types";
import { redisClient, isRedisConnected } from "../shared/redis";
import { logger } from "../shared/logger";

// Redis key prefixes
const INTENT_STREAM_KEY = "intents:stream";
const INTENT_DATA_KEY = "intents:data"; // Hash: intent_id -> JSON
const INTENT_NONCE_KEY = "intents:nonces"; // Set: session_pubkey:nonce
const SESSION_VOLUME_KEY = "session:volume"; // Hash: owner:session -> volume
const BATCH_DATA_KEY = "batches:data"; // Hash: batch_id -> JSON
const PROCESSED_INTENTS_KEY = "intents:processed"; // Set: intent_id

/**
 * Store a trade intent in Redis Stream + Hash
 */
export async function persistIntent(intent: TradeIntent): Promise<void> {
  if (!isRedisConnected() || !redisClient) {
    throw new Error("Redis not connected - cannot persist intent");
  }

  logger.info("[REDIS][INTENT] Persisting intent", {
    intentId: intent.id,
    sessionPubkey: intent.sessionPubkey.substring(0, 20) + "...",
    ownerPubkey: intent.ownerPubkey.substring(0, 20) + "...",
    itemId: intent.itemId,
    amountLamports: intent.amountLamports.toString(),
  });

  try {
    // 1. Store intent data in Redis Hash (for recovery)
    const intentData = {
      id: intent.id,
      sessionPubkey: intent.sessionPubkey,
      ownerPubkey: intent.ownerPubkey,
      itemId: intent.itemId,
      from: intent.from,
      to: intent.to,
      amountLamports: intent.amountLamports.toString(),
      nonce: intent.nonce?.toString() || "0",
      signature: intent.signature,
      createdAt: intent.createdAt.toString(),
      gameId: intent.gameId?.toString() || "",
      listingId: intent.listingId || "",
      intentType: intent.intentType || "",
    };

    await redisClient.hSet(
      INTENT_DATA_KEY,
      intent.id,
      JSON.stringify(intentData)
    );

    // 2. Add to Redis Stream (for FIFO processing)
    // Redis v4 API: xAdd(key, id, fields)
    await redisClient.xAdd(
      INTENT_STREAM_KEY,
      "*", // Auto-generate ID
      {
        intentId: intent.id,
        sessionPubkey: intent.sessionPubkey,
        ownerPubkey: intent.ownerPubkey,
        itemId: intent.itemId,
        amountLamports: intent.amountLamports.toString(),
        createdAt: intent.createdAt.toString(),
      }
    );

    // 3. Track nonce for replay protection
    if (intent.nonce !== undefined && intent.nonce !== null) {
      const nonceKey = `${intent.sessionPubkey}:${intent.nonce}`;
      await redisClient.sAdd(INTENT_NONCE_KEY, nonceKey);
      // Set TTL on nonce set (24 hours) - only if set is new
      const setSize = await redisClient.sCard(INTENT_NONCE_KEY);
      if (setSize === 1) {
        await redisClient.expire(INTENT_NONCE_KEY, 86400);
      }
    }

    // 4. Set TTL on intent data hash (7 days) - set on the hash itself
    const hashExists = await redisClient.hExists(INTENT_DATA_KEY, intent.id);
    if (!hashExists) {
      // Set TTL on the entire hash (will apply to all keys)
      // Note: Individual hash keys don't support TTL, so we set it on the hash
      await redisClient.expire(INTENT_DATA_KEY, 604800);
    }

    logger.info("[REDIS][INTENT] Persist succeeded", {
      intentId: intent.id,
    });
  } catch (error: any) {
    logger.error("[REDIS][INTENT] FAILED to persist intent", {
      intentId: intent.id,
      error: error?.message,
      stack: error?.stack,
    });
    throw error;
  }
}

/**
 * Load intents from Redis Stream
 * Excludes intents that are already processed
 */
export async function loadIntents(
  since?: number,
  limit?: number
): Promise<TradeIntent[]> {
  if (!isRedisConnected() || !redisClient) {
    logger.warn("[REDIS][LOAD_INTENTS] Redis not connected, returning empty array");
    return [];
  }

  try {
    logger.info("[REDIS][LOAD_INTENTS] Starting load", { since, limit });

    // Get processed intent IDs
    const processedIds = await redisClient.sMembers(PROCESSED_INTENTS_KEY);
    const processedSet = new Set(processedIds);

    // Read from stream (XREAD with COUNT)
    // Redis v4 API: xRead(commands, options)
    const streamLimit = limit || 1000;
    const streamResults = await redisClient.xRead(
      {
        key: INTENT_STREAM_KEY,
        id: since ? `${since}-0` : "0", // Start from beginning or since timestamp
      },
      {
        COUNT: streamLimit,
        BLOCK: 0, // Non-blocking (0 = don't block)
      }
    );

    const intents: TradeIntent[] = [];

    if (streamResults && streamResults.length > 0) {
      for (const stream of streamResults) {
        for (const message of stream.messages) {
          const intentId = message.message.intentId as string;

          // Skip if already processed
          if (processedSet.has(intentId)) {
            continue;
          }

          // Load full intent data from hash
          const intentJson = await redisClient.hGet(INTENT_DATA_KEY, intentId);
          if (!intentJson) {
            logger.warn("[REDIS][LOAD_INTENTS] Intent data not found in hash", {
              intentId,
            });
            continue;
          }

          const intentData = JSON.parse(intentJson);
          intents.push({
            id: intentData.id,
            sessionPubkey: intentData.sessionPubkey,
            ownerPubkey: intentData.ownerPubkey,
            itemId: intentData.itemId,
            from: intentData.from,
            to: intentData.to,
            amountLamports: BigInt(intentData.amountLamports),
            nonce: intentData.nonce ? parseInt(intentData.nonce) : undefined,
            signature: intentData.signature,
            createdAt: parseInt(intentData.createdAt),
            gameId: intentData.gameId ? parseInt(intentData.gameId) : undefined,
            listingId: intentData.listingId || undefined,
            intentType: intentData.intentType || undefined,
          });

          if (limit && intents.length >= limit) {
            break;
          }
        }
      }
    }

    logger.info("[REDIS][LOAD_INTENTS] Load complete", {
      totalIntents: intents.length,
      processedCount: processedSet.size,
    });

    return intents;
  } catch (error) {
    logger.error("[REDIS][LOAD_INTENTS] Error loading intents", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Check if intent ID already exists (replay protection)
 */
export async function intentExists(intentId: string): Promise<boolean> {
  if (!isRedisConnected() || !redisClient) {
    return false;
  }

  try {
    const exists = await redisClient.hExists(INTENT_DATA_KEY, intentId);
    return exists;
  } catch (error) {
    logger.error("[REDIS][INTENT] Error checking intent existence", {
      intentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if nonce already used (replay protection)
 */
export async function nonceUsed(sessionPubkey: string, nonce: number): Promise<boolean> {
  if (!isRedisConnected() || !redisClient) {
    return false;
  }

  try {
    const nonceKey = `${sessionPubkey}:${nonce}`;
    const exists = await redisClient.sIsMember(INTENT_NONCE_KEY, nonceKey);
    return exists;
  } catch (error) {
    logger.error("[REDIS][INTENT] Error checking nonce", {
      sessionPubkey,
      nonce,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Get session key volume from Redis
 */
export async function getSessionKeyVolume(
  ownerPubkey: string,
  sessionPubkey: string
): Promise<bigint> {
  if (!isRedisConnected() || !redisClient) {
    return 0n;
  }

  try {
    const key = `${ownerPubkey}:${sessionPubkey}`;
    const volume = await redisClient.hGet(SESSION_VOLUME_KEY, key);
    return volume ? BigInt(volume) : 0n;
  } catch (error) {
    logger.error("[REDIS][SESSION] Error getting volume", {
      ownerPubkey,
      sessionPubkey,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0n;
  }
}

/**
 * Increment session key volume in Redis (atomic)
 */
export async function incrementSessionKeyVolume(
  ownerPubkey: string,
  sessionPubkey: string,
  amountLamports: bigint
): Promise<bigint> {
  if (!isRedisConnected() || !redisClient) {
    throw new Error("Redis not connected - cannot increment volume");
  }

  try {
    const key = `${ownerPubkey}:${sessionPubkey}`;
    const newVolume = await redisClient.hIncrBy(
      SESSION_VOLUME_KEY,
      key,
      amountLamports.toString()
    );
    
    // Set TTL on volume key (30 days)
    await redisClient.expire(SESSION_VOLUME_KEY, 2592000);
    
    return BigInt(newVolume);
  } catch (error) {
    logger.error("[REDIS][SESSION] Error incrementing volume", {
      ownerPubkey,
      sessionPubkey,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Mark intent as processed
 */
export async function markIntentProcessed(intentId: string): Promise<void> {
  if (!isRedisConnected() || !redisClient) {
    return;
  }

  try {
    await redisClient.sAdd(PROCESSED_INTENTS_KEY, intentId);
    // Set TTL on processed set (7 days)
    await redisClient.expire(PROCESSED_INTENTS_KEY, 604800);
  } catch (error) {
    logger.error("[REDIS][INTENT] Error marking intent as processed", {
      intentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Store a netting batch in Redis Hash
 */
export async function persistBatch(batch: NettingBatch): Promise<void> {
  if (!isRedisConnected() || !redisClient) {
    throw new Error("Redis not connected - cannot persist batch");
  }

  try {
    const batchData = {
      batchId: batch.batchId,
      createdAt: batch.createdAt.toString(),
      nettedAt: batch.nettedAt?.toString() || "",
      settled: batch.settled.toString(),
      txSignature: batch.txSignature || "",
      intentIds: JSON.stringify(batch.intentIds),
      result: batch.result ? {
        finalOwners: Array.from(batch.result.finalOwners.entries()),
        netCashDeltas: Array.from(batch.result.netCashDeltas.entries()).map(([k, v]) => [k, v.toString()]),
        consumedIntentIds: batch.result.consumedIntentIds,
        numIntents: batch.result.numIntents,
        numItemsSettled: batch.result.numItemsSettled,
        numWallets: batch.result.numWallets,
      } : null,
    };

    await redisClient.hSet(
      BATCH_DATA_KEY,
      batch.batchId,
      JSON.stringify(batchData)
    );

    // Mark all intents as processed
    for (const intentId of batch.intentIds) {
      await markIntentProcessed(intentId);
    }

    // Set TTL on batch (30 days)
    await redisClient.expire(`${BATCH_DATA_KEY}:${batch.batchId}`, 2592000);

    logger.info("[REDIS][BATCH] Persist succeeded", {
      batchId: batch.batchId,
    });
  } catch (error) {
    logger.error("[REDIS][BATCH] Error persisting batch", {
      batchId: batch.batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Load a netting batch from Redis
 */
export async function loadBatch(batchId: string): Promise<NettingBatch | null> {
  if (!isRedisConnected() || !redisClient) {
    return null;
  }

  try {
    const batchJson = await redisClient.hGet(BATCH_DATA_KEY, batchId);
    if (!batchJson) {
      return null;
    }

    const batchData = JSON.parse(batchJson);
    
    const finalOwners = new Map<string, string>();
    const netCashDeltas = new Map<string, bigint>();

    if (batchData.result) {
      for (const [itemId, owner] of batchData.result.finalOwners) {
        finalOwners.set(itemId, owner);
      }
      for (const [owner, delta] of batchData.result.netCashDeltas) {
        netCashDeltas.set(owner, BigInt(delta));
      }
    }

    const result: NettingResult | undefined = batchData.result ? {
      finalOwners,
      netCashDeltas,
      consumedIntentIds: batchData.result.consumedIntentIds,
      batchId: batchData.batchId,
      nettedAt: batchData.result.nettedAt ? parseInt(batchData.result.nettedAt) : 0,
      numIntents: batchData.result.numIntents,
      numItemsSettled: batchData.result.numItemsSettled,
      numWallets: batchData.result.numWallets,
    } : undefined;

    return {
      batchId: batchData.batchId,
      createdAt: parseInt(batchData.createdAt),
      nettedAt: batchData.nettedAt ? parseInt(batchData.nettedAt) : undefined,
      settled: batchData.settled === "true",
      txSignature: batchData.txSignature || undefined,
      result,
      intentIds: JSON.parse(batchData.intentIds),
    };
  } catch (error) {
    logger.error("[REDIS][BATCH] Error loading batch", {
      batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

