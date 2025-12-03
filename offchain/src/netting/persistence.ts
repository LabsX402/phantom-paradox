/**
 * ======================================================================
 * NETTING PERSISTENCE LAYER (LEGACY - PostgreSQL)
 * ======================================================================
 * 
 * ⚠️ DEPRECATED: This module uses PostgreSQL for persistence.
 * 
 * For new code, use `redis-persistence.ts` which is serverless-friendly.
 * 
 * This module is kept for:
 * - Migration/backup purposes
 * - Analytics queries
 * - Audit trails
 * 
 * Primary intent queue is now in Redis (see redis-persistence.ts)
 */

import { TradeIntent, NettingBatch, NettingResult } from "./types";
import { query } from "../shared/db";
import { logger } from "../shared/logger";

/**
 * Store a trade intent in the database
 */
export async function persistIntent(intent: TradeIntent): Promise<void> {
  logger.info("[INTENT] Persisting intent", {
    intentId: intent.id,
    sessionPubkey: intent.sessionPubkey.substring(0, 20) + "...",
    ownerPubkey: intent.ownerPubkey.substring(0, 20) + "...",
    itemId: intent.itemId,
    amountLamports: intent.amountLamports.toString(),
    createdAt: intent.createdAt,
  });

  try {
    const result = await query(
      `INSERT INTO trade_intents (
        id, session_pubkey, owner_pubkey, item_id, 
        from_wallet, to_wallet, amount_lamports, nonce,
        signature, created_at, game_id, listing_id, intent_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO NOTHING
      RETURNING id`,
      [
        intent.id,
        intent.sessionPubkey,
        intent.ownerPubkey,
        intent.itemId,
        intent.from,
        intent.to,
        intent.amountLamports.toString(),
        intent.nonce,
        intent.signature,
        new Date(intent.createdAt * 1000),
        // gameId can be string or number - convert to number if possible, otherwise null
        intent.gameId ? (typeof intent.gameId === "string" ? (isNaN(Number(intent.gameId)) ? null : Number(intent.gameId)) : intent.gameId) : null,
        intent.listingId || null,
        intent.intentType || null,
      ]
    );

    if (result.rows.length === 0) {
      // ON CONFLICT DO NOTHING returned no rows - intent already exists
      logger.warn("[INTENT] Intent already exists (duplicate ID)", {
        intentId: intent.id,
      });
      // Don't throw - this is expected for duplicate IDs
      return;
    }

    logger.info("[INTENT] Persist succeeded", {
      intentId: intent.id,
      dbId: result.rows[0]?.id,
    });
  } catch (error: any) {
    logger.error("[INTENT] FAILED to persist intent", {
      intentId: intent.id,
      error: error?.message,
      code: error?.code,
      detail: error?.detail,
      constraint: error?.constraint,
      stack: error?.stack,
    });
    // IMPORTANT: Throw so caller knows it failed
    throw error;
  }
}

/**
 * Load intents from database
 * Excludes intents that are already in a batch (to avoid reprocessing)
 */
export async function loadIntents(
  since?: number,
  limit?: number
): Promise<TradeIntent[]> {
  try {
    logger.info("[LOAD_INTENTS] Starting load", { since, limit });
    
    // CRITICAL: Cross-batch double-spend prevention
    // Exclude intents that are already in a batch (settled or pending)
    // Get all intent IDs that are already in batches
    const batchesResult = await query(
      `SELECT intent_ids FROM netting_batches WHERE intent_ids IS NOT NULL`
    );
    const processedIntentIds = new Set<string>();
    // CRITICAL: Also get items that are already in pending batches to prevent cross-batch double-spend
    const itemsInPendingBatches = new Set<string>();
    
    for (const row of batchesResult.rows) {
      try {
        const intentIds = JSON.parse(row.intent_ids || "[]");
        for (const id of intentIds) {
          processedIntentIds.add(id);
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    // CRITICAL: Get items that are already in pending (unsettled) batches
    // Use SELECT FOR UPDATE to lock rows and prevent race conditions
    // This prevents the same item from appearing in multiple batches before settlement
    const pendingBatchesResult = await query(
      `SELECT si.item_id 
       FROM settled_items si
       INNER JOIN netting_batches nb ON si.batch_id = nb.batch_id
       WHERE nb.settled = FALSE
       FOR UPDATE SKIP LOCKED`
    );
    for (const row of pendingBatchesResult.rows) {
      itemsInPendingBatches.add(row.item_id);
    }
    
    logger.info("[LOAD_INTENTS] Items in pending batches", {
      itemsInPendingBatchesCount: itemsInPendingBatches.size,
    });
    
    logger.info("[LOAD_INTENTS] Processed intent IDs found", {
      totalBatches: batchesResult.rows.length,
      processedIntentIdsCount: processedIntentIds.size,
    });
    
    let sql = `SELECT * FROM trade_intents WHERE 1=1`;
    const params: any[] = [];
    
    if (since) {
      sql += ` AND created_at >= $${params.length + 1}`;
      params.push(new Date(since * 1000));
      logger.info("[LOAD_INTENTS] Time filter", {
        since: new Date(since * 1000).toISOString(),
        sinceTimestamp: since,
      });
    }
    
    // PROOF: Exclude already-processed intents
    if (processedIntentIds.size > 0) {
      const placeholders = Array.from({ length: processedIntentIds.size }, (_, i) => `$${params.length + i + 1}`).join(", ");
      sql += ` AND id NOT IN (${placeholders})`;
      params.push(...Array.from(processedIntentIds));
      logger.info("[LOAD_INTENTS] Excluding processed intents", {
        excludedCount: processedIntentIds.size,
      });
    }
    
    // CRITICAL: Exclude items that are in pending batches (cross-batch double-spend prevention)
    if (itemsInPendingBatches.size > 0) {
      const itemPlaceholders = Array.from({ length: itemsInPendingBatches.size }, (_, i) => `$${params.length + i + 1}`).join(", ");
      sql += ` AND item_id NOT IN (${itemPlaceholders})`;
      params.push(...Array.from(itemsInPendingBatches));
      logger.info("[LOAD_INTENTS] Excluding items in pending batches", {
        excludedItemCount: itemsInPendingBatches.size,
      });
    }
    
    sql += ` ORDER BY created_at ASC`;
    
    if (limit) {
      sql += ` LIMIT $${params.length + 1}`;
      params.push(limit);
      logger.info("[LOAD_INTENTS] Limit applied", { limit });
    }
    
    // CRITICAL: Use SELECT FOR UPDATE to lock intents during batch creation
    // This prevents race conditions where two batches try to process the same intent
    sql += ` FOR UPDATE SKIP LOCKED`;
    
    const result = await query(sql, params);
    
    logger.info("[LOAD_INTENTS] Query complete", {
      totalIntentsFound: result.rows.length,
      excludedProcessed: processedIntentIds.size,
      hasTimeFilter: !!since,
      hasLimit: !!limit,
    });
    
    // Filter out intents whose items are already in pending batches (cross-batch double-spend prevention)
    const filteredRows = result.rows.filter((row: any) => {
      if (itemsInPendingBatches.has(row.item_id)) {
        logger.debug("[LOAD_INTENTS] Excluding intent - item in pending batch", {
          intentId: row.id,
          itemId: row.item_id,
        });
        return false;
      }
      return true;
    });
    
    logger.info("[LOAD_INTENTS] Cross-batch filtering", {
      totalIntents: result.rows.length,
      filteredIntents: filteredRows.length,
      excludedItems: itemsInPendingBatches.size,
    });
    
    return filteredRows.map((row: any) => ({
      id: row.id,
      sessionPubkey: row.session_pubkey,
      ownerPubkey: row.owner_pubkey,
      itemId: row.item_id,
      from: row.from_wallet,
      to: row.to_wallet,
      amountLamports: BigInt(row.amount_lamports),
      nonce: row.nonce,
      signature: row.signature,
      createdAt: Math.floor(new Date(row.created_at).getTime() / 1000),
      gameId: row.game_id,
      listingId: row.listing_id,
      intentType: row.intent_type,
    }));
  } catch (error) {
    logger.error("Error loading intents", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Store a netting batch in the database
 */
export async function persistBatch(batch: NettingBatch): Promise<void> {
  // CRITICAL: Use database transaction for atomicity
  // If any part fails, entire batch persistence is rolled back
  const { query, getPool } = await import("../shared/db");
  const pool = getPool();
  
  if (!pool) {
    throw new Error("Database pool not available");
  }
  
  // Use a client for transaction support
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");
    
    try {
      await client.query(
        `INSERT INTO netting_batches (
          batch_id, created_at, netted_at, settled, tx_signature,
          num_intents, num_items_settled, num_wallets, intent_ids
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (batch_id) DO UPDATE SET
          netted_at = EXCLUDED.netted_at,
          settled = EXCLUDED.settled,
          tx_signature = EXCLUDED.tx_signature`,
        [
          batch.batchId,
          new Date(batch.createdAt * 1000),
          batch.nettedAt ? new Date(batch.nettedAt * 1000) : null,
          batch.settled,
          batch.txSignature || null,
          batch.result?.numIntents || 0,
          batch.result?.numItemsSettled || 0,
          batch.result?.numWallets || 0,
          JSON.stringify(batch.intentIds),
        ]
      );
      
      // Store result details if available (within same transaction)
      if (batch.result) {
        // Use client for transaction consistency
        await persistBatchResultWithClient(client, batch.batchId, batch.result);
      }
      
      // Commit transaction
      await client.query("COMMIT");
    } catch (error) {
      // Rollback on error
      await client.query("ROLLBACK").catch(() => {
        // Ignore rollback errors
      });
      throw error;
    }
  } catch (error) {
    logger.error("Error persisting batch", {
      batchId: batch.batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Persist batch result using a database client (for transaction support)
 */
async function persistBatchResultWithClient(
  client: any,
  batchId: string,
  result: NettingResult
): Promise<void> {
  try {
    // Store settled items
    for (const [itemId, owner] of result.finalOwners.entries()) {
      await client.query(
        `INSERT INTO settled_items (batch_id, item_id, final_owner)
         VALUES ($1, $2, $3)
         ON CONFLICT (batch_id, item_id) DO UPDATE SET final_owner = EXCLUDED.final_owner`,
        [batchId, itemId, owner]
      );
    }
    
    // Store net deltas
    for (const [owner, delta] of result.netCashDeltas.entries()) {
      if (delta !== 0n) {
        await client.query(
          `INSERT INTO net_cash_deltas (batch_id, owner_pubkey, delta_lamports)
           VALUES ($1, $2, $3)
           ON CONFLICT (batch_id, owner_pubkey) DO UPDATE SET delta_lamports = EXCLUDED.delta_lamports`,
          [batchId, owner, delta.toString()]
        );
      }
    }
  } catch (error) {
    logger.error("Error persisting batch result", {
      batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Store netting result details
 */
async function persistBatchResult(
  batchId: string,
  result: NettingResult
): Promise<void> {
  try {
    // Store final owners
    for (const [itemId, owner] of result.finalOwners.entries()) {
      await query(
        `INSERT INTO settled_items (batch_id, item_id, final_owner)
         VALUES ($1, $2, $3)
         ON CONFLICT (batch_id, item_id) DO UPDATE SET final_owner = EXCLUDED.final_owner`,
        [batchId, itemId, owner]
      );
    }
    
    // Store net deltas
    for (const [owner, delta] of result.netCashDeltas.entries()) {
      if (delta !== 0n) {
        await query(
          `INSERT INTO net_cash_deltas (batch_id, owner_pubkey, delta_lamports)
           VALUES ($1, $2, $3)
           ON CONFLICT (batch_id, owner_pubkey) DO UPDATE SET delta_lamports = EXCLUDED.delta_lamports`,
          [batchId, owner, delta.toString()]
        );
      }
    }
  } catch (error) {
    logger.error("Error persisting batch result", {
      batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - this is supplementary data
  }
}

/**
 * Load a netting batch from database
 */
export async function loadBatch(batchId: string): Promise<NettingBatch | null> {
  try {
    const result = await query(
      `SELECT * FROM netting_batches WHERE batch_id = $1`,
      [batchId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row = result.rows[0];
    
    // Load result details
    const finalOwners = new Map<string, string>();
    const netCashDeltas = new Map<string, bigint>();
    
    const ownersResult = await query(
      `SELECT item_id, final_owner FROM settled_items WHERE batch_id = $1`,
      [batchId]
    );
    for (const ownerRow of ownersResult.rows) {
      finalOwners.set(ownerRow.item_id, ownerRow.final_owner);
    }
    
    const deltasResult = await query(
      `SELECT owner_pubkey, delta_lamports FROM net_cash_deltas WHERE batch_id = $1`,
      [batchId]
    );
    for (const deltaRow of deltasResult.rows) {
      netCashDeltas.set(deltaRow.owner_pubkey, BigInt(deltaRow.delta_lamports));
    }
    
    const nettingResult: NettingResult = {
      finalOwners,
      netCashDeltas,
      consumedIntentIds: JSON.parse(row.intent_ids || "[]"),
      batchId,
      nettedAt: row.netted_at ? Math.floor(new Date(row.netted_at).getTime() / 1000) : 0,
      numIntents: row.num_intents,
      numItemsSettled: row.num_items_settled,
      numWallets: row.num_wallets,
    };
    
    return {
      batchId,
      createdAt: Math.floor(new Date(row.created_at).getTime() / 1000),
      nettedAt: row.netted_at ? Math.floor(new Date(row.netted_at).getTime() / 1000) : undefined,
      settled: row.settled,
      txSignature: row.tx_signature || undefined,
      result: nettingResult,
      intentIds: JSON.parse(row.intent_ids || "[]"),
    };
  } catch (error) {
    logger.error("Error loading batch", {
      batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

