/**
 * Indexer Integration - Connects netting engine to indexer
 * 
 * This module ensures that when batches are settled, the indexer
 * is notified to update its state reconstruction.
 */

import { Indexer } from "./indexer";
import { SettledItem, NetDelta } from "../netting/types";
import { logger } from "../shared/logger";

let indexerInstance: Indexer | null = null;

/**
 * Initialize indexer integration
 */
export function initializeIndexer(connection: any): Promise<void> {
  if (!indexerInstance) {
    indexerInstance = new Indexer(connection);
    return indexerInstance.initialize();
  }
  return Promise.resolve();
}

/**
 * Start the indexer service
 */
export async function startIndexer(): Promise<void> {
  if (!indexerInstance) {
    throw new Error("Indexer not initialized. Call initializeIndexer() first.");
  }
  await indexerInstance.start();
}

/**
 * Notify indexer of a settled batch
 * 
 * This is called by the netting engine after successfully settling a batch on-chain.
 */
export async function notifyBatchSettled(
  batchId: number,
  gameId: number,
  items: SettledItem[],
  cashDeltas: NetDelta[]
): Promise<void> {
  if (!indexerInstance) {
    logger.warn("Indexer not initialized, skipping batch notification");
    return;
  }

  try {
    // Update item ownership
    const ownershipUpdates = items.map((item) => ({
      itemId: parseInt(item.itemId),
      gameId,
      owner: item.finalOwner,
    }));

    await indexerInstance.updateItemOwnership(batchId, ownershipUpdates);

    // Update wallet balances
    const balanceUpdates = cashDeltas.map((delta) => ({
      wallet: delta.ownerPubkey,
      deltaLamports: Number(delta.deltaLamports),
    }));

    await indexerInstance.updateWalletBalances(batchId, gameId, balanceUpdates);

    logger.info("Indexer notified of batch settlement", {
      batchId,
      numItems: items.length,
      numDeltas: cashDeltas.length,
    });
  } catch (error) {
    logger.error("Error notifying indexer of batch settlement", {
      error,
      batchId,
    });
    // Don't throw - indexer errors shouldn't break settlement
  }
}

/**
 * Get indexer instance (for testing/debugging)
 */
export function getIndexer(): Indexer | null {
  return indexerInstance;
}

