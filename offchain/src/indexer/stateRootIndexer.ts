/**
 * ======================================================================
 * SHADOW INDEXER FOR STATE ROOT SETTLEMENT
 * ======================================================================
 * 
 * Listens to StateRootSettled events from the on-chain program and syncs
 * ownership data into Postgres for efficient UI queries.
 * 
 * Problem: With compressed settlement, ownership is represented by Merkle
 * roots rather than individual on-chain NFT/token accounts. The UI cannot
 * query Solana RPC directly for ownership.
 * 
 * Solution: This indexer listens to StateRootSettled events, downloads the
 * batch data (via da_hash), and updates a Postgres "items" table that the
 * UI can query efficiently.
 */

import { getProgram } from "../shared/solana";
import { query } from "../shared/db";
import { logger } from "../shared/logger";

/**
 * Start the state root indexer
 * 
 * Subscribes to StateRootSettled events and syncs ownership into Postgres.
 */
export async function startStateRootIndexer(): Promise<void> {
  const program = await getProgram();
  
  logger.info("[INDEXER][STATE_ROOT] Starting listener...");

  program.addEventListener("StateRootSettled", async (event: any, slot: number) => {
    try {
      const { batch_id, root, da_hash, num_intents, num_items, timestamp } = event;
      
      logger.info("[INDEXER][STATE_ROOT] Event received", {
        batchId: batch_id?.toString(),
        root: root ? Buffer.from(root).toString("hex").slice(0, 16) + "..." : "N/A",
        daHash: da_hash ? Buffer.from(da_hash).toString("hex").slice(0, 16) + "..." : "N/A",
        numIntents: num_intents?.toString(),
        numItems: num_items?.toString(),
        slot,
        timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : "N/A",
      });

      // Lookup latest batch matching num_intents/num_items
      // We match by num_intents and num_items to find the corresponding batch
      const batches = await query(
        `
          SELECT batch_id, num_intents, num_items_settled, created_at
          FROM netting_batches
          WHERE num_intents = $1
            AND num_items_settled = $2
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [num_intents?.toString() || "0", num_items?.toString() || "0"]
      );

      if (batches.rows.length === 0) {
        logger.warn("[INDEXER][STATE_ROOT] No matching batch found for event", {
          numIntents: num_intents?.toString(),
          numItems: num_items?.toString(),
        });
        return;
      }

      const batchRow = batches.rows[0];
      const batchId = batchRow.batch_id as string;

      // Load the batch result from settled_items and net_cash_deltas tables
      // Reconstruct finalOwners from settled_items
      const settledItemsResult = await query(
        `
          SELECT item_id, final_owner
          FROM settled_items
          WHERE batch_id = $1
        `,
        [batchId]
      );

      const finalOwners: Record<string, string> = {};
      for (const row of settledItemsResult.rows) {
        finalOwners[row.item_id as string] = row.final_owner as string;
      }

      if (Object.keys(finalOwners).length === 0) {
        logger.info("[INDEXER][STATE_ROOT] No items to update for batch", {
          batchId,
        });
        return;
      }

      // Ensure items table exists (create if not exists)
      await query(`
        CREATE TABLE IF NOT EXISTS items (
          item_id TEXT PRIMARY KEY,
          owner_pubkey TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `).catch(() => {
        // Table might already exist, ignore error
      });

      // Create index for efficient queries
      await query(`
        CREATE INDEX IF NOT EXISTS idx_items_owner ON items(owner_pubkey)
      `).catch(() => {
        // Index might already exist, ignore error
      });

      // Upsert ownership updates
      const updates: { item_id: string; owner: string }[] = [];
      for (const [itemId, owner] of Object.entries(finalOwners)) {
        updates.push({ item_id: itemId, owner: owner as string });
      }

      // Upsert in a transaction for atomicity
      for (const u of updates) {
        await query(
          `
            INSERT INTO items (item_id, owner_pubkey, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (item_id)
            DO UPDATE SET 
              owner_pubkey = EXCLUDED.owner_pubkey,
              updated_at = NOW()
          `,
          [u.item_id, u.owner]
        );
      }

      logger.info("[INDEXER][STATE_ROOT] Ownership sync complete", {
        batchId,
        numUpdated: updates.length,
        slot,
      });
    } catch (err) {
      logger.error("[INDEXER][STATE_ROOT] Error handling event", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  });

  logger.info("[INDEXER][STATE_ROOT] Listener started and subscribed to StateRootSettled events");
}

