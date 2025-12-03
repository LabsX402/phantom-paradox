/**
 * Direct batch settlement - bypasses loadBatch issues
 */

import "dotenv/config";
import { initDatabase, query } from "../shared/db";
import { settleBatchCompressed } from "../netting/compressedSettlement";
import { markBatchSettled } from "../netting/engine";
import { logger } from "../shared/logger";
import { NettingBatch, NettingResult } from "../netting/types";

async function main() {
  const batchId = process.argv[2] || "7683b77e-b256-4047-8632-d27d3f6e5c37";
  
  await initDatabase();
  
  logger.info("[DIRECT_SETTLE] Loading batch", { batchId });
  
  // Load batch metadata
  const batchRes = await query(
    `SELECT batch_id, created_at, netted_at, settled, tx_signature, num_intents, num_items_settled, num_wallets
     FROM netting_batches WHERE batch_id = $1`,
    [batchId]
  );
  
  if (batchRes.rows.length === 0) {
    logger.error("[DIRECT_SETTLE] Batch not found", { batchId });
    process.exit(1);
  }
  
  const row = batchRes.rows[0];
  
  const force = process.argv.includes("--force");
  if (row.settled && !force) {
    logger.info("[DIRECT_SETTLE] Batch already settled", { batchId, tx: row.tx_signature });
    logger.info("[DIRECT_SETTLE] Use --force to re-settle");
    process.exit(0);
  }
  
  if (force && row.settled) {
    logger.info("[DIRECT_SETTLE] Force mode: re-settling batch", { batchId });
  }
  
  // Load result details directly from tables
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
  
  // Load intent IDs - handle both JSONB and text
  let intentIds: string[] = [];
  try {
    const intentRes = await query(
      `SELECT intent_ids FROM netting_batches WHERE batch_id = $1`,
      [batchId]
    );
    if (intentRes.rows[0]?.intent_ids) {
      const ids = intentRes.rows[0].intent_ids;
      if (typeof ids === 'string') {
        intentIds = JSON.parse(ids);
      } else if (Array.isArray(ids)) {
        intentIds = ids;
      }
    }
  } catch (e) {
    logger.warn("[DIRECT_SETTLE] Could not parse intent_ids, using empty array");
  }
  
  const result: NettingResult = {
    finalOwners,
    netCashDeltas,
    consumedIntentIds: intentIds,
    batchId,
    nettedAt: row.netted_at ? Math.floor(new Date(row.netted_at).getTime() / 1000) : Math.floor(Date.now() / 1000),
    numIntents: row.num_intents,
    numItemsSettled: row.num_items_settled,
    numWallets: row.num_wallets,
  };
  
  const batch: NettingBatch = {
    batchId,
    createdAt: Math.floor(new Date(row.created_at).getTime() / 1000),
    nettedAt: row.netted_at ? Math.floor(new Date(row.netted_at).getTime() / 1000) : undefined,
    settled: false,
    batchHash: Buffer.alloc(32), // Placeholder
    result,
    intentIds,
  };
  
  logger.info("[DIRECT_SETTLE] Batch reconstructed", {
    batchId,
    numIntents: result.numIntents,
    numItems: result.numItemsSettled,
    numWallets: result.numWallets,
  });
  
  // Settle it
  logger.info("[DIRECT_SETTLE] Settling batch on-chain...");
  const txSig = await settleBatchCompressed(batch);
  
  if (txSig === "skipped") {
    logger.error("[DIRECT_SETTLE] Settlement skipped - check ENABLE_COMPRESSED_SETTLEMENT=true");
    process.exit(1);
  }
  
  // Mark as settled in DB
  const { query } = await import("../shared/db");
  await query(
    `UPDATE netting_batches SET settled = true, tx_signature = $1, netted_at = COALESCE(netted_at, NOW()) WHERE batch_id = $2`,
    [txSig, batchId]
  );
  
  // Also mark in memory
  await markBatchSettled(batchId, txSig);
  
  logger.info("[DIRECT_SETTLE] ✅ Batch settled!", { batchId, txSig });
  console.log(`\n✅ Settlement complete!`);
  console.log(`Batch ID: ${batchId}`);
  console.log(`TX Signature: ${txSig}`);
  console.log(`View on Solscan: https://solscan.io/tx/${txSig}?cluster=devnet\n`);
}

main().catch((error) => {
  logger.error("[DIRECT_SETTLE] Fatal error", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});

