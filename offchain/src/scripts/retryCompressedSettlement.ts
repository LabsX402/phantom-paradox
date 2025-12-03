/**
 * ======================================================================
 * SETTLEMENT RETRY SCRIPT
 * ======================================================================
 * 
 * Scans for unsettled batches and retries compressed settlement.
 * 
 * Usage:
 *   npx ts-node src/scripts/retryCompressedSettlement.ts [--batch-id <id>] [--max-retries <n>]
 */

import "dotenv/config";
import { initDatabase, query } from "../shared/db";
import { settleBatchCompressed } from "../netting/compressedSettlement";
import { loadBatch } from "../netting/persistence";
import { markBatchSettled } from "../netting/engine";
import { logger } from "../shared/logger";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

interface Args {
  batchId?: string;
  maxRetries?: number;
  minIntents?: number;
}

async function main() {
  await initDatabase();
  
  const argv = await yargs(hideBin(process.argv))
    .option("batch-id", {
      type: "string",
      description: "Specific batch ID to retry (optional)",
    })
    .option("max-retries", {
      type: "number",
      default: 3,
      description: "Maximum number of retry attempts",
    })
    .option("min-intents", {
      type: "number",
      default: 1000,
      description: "Minimum number of intents to retry",
    })
    .parse();
  
  const args: Args = {
    batchId: argv["batch-id"] as string | undefined,
    maxRetries: argv["max-retries"] as number,
    minIntents: argv["min-intents"] as number,
  };
  
  logger.info("[RETRY] Starting settlement retry", args);
  
  // Find unsettled batches
  let batches: any[];
  if (args.batchId) {
    const result = await query(
      `SELECT batch_id, num_intents, settled, tx_signature, created_at
       FROM netting_batches
       WHERE batch_id = $1 AND settled = FALSE`,
      [args.batchId]
    );
    batches = result.rows;
  } else {
    const result = await query(
      `SELECT batch_id, num_intents, settled, tx_signature, created_at
       FROM netting_batches
       WHERE settled = FALSE
         AND num_intents >= $1
       ORDER BY created_at ASC
       LIMIT 10`,
      [args.minIntents]
    );
    batches = result.rows;
  }
  
  if (batches.length === 0) {
    logger.info("[RETRY] No unsettled batches found");
    return;
  }
  
  logger.info("[RETRY] Found unsettled batches", { count: batches.length });
  
  for (const row of batches) {
    const batchId = row.batch_id;
    logger.info("[RETRY] Processing batch", { batchId, numIntents: row.num_intents });
    
    try {
      // Load full batch data
      const batch = await loadBatch(batchId);
      if (!batch || !batch.result) {
        logger.warn("[RETRY] Batch not found or missing result", { batchId });
        continue;
      }
      
      // Retry compressed settlement
      const txSig = await settleBatchCompressed(batch);
      
      if (txSig === "skipped") {
        logger.info("[RETRY] Settlement skipped (not enabled)", { batchId });
        continue;
      }
      
      // Mark as settled
      await markBatchSettled(batchId, txSig);
      logger.info("[RETRY] Batch settled successfully", { batchId, txSig });
      
    } catch (error) {
      logger.error("[RETRY] Failed to settle batch", {
        batchId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with next batch
    }
  }
  
  logger.info("[RETRY] Retry complete");
}

main().catch((error) => {
  logger.error("[RETRY] Fatal error", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});

