/**
 * Fast Linear Netting Engine
 * 
 * Alternative implementation using linear state maps.
 * Processes intents in order, tracks ownership, accumulates net cash deltas.
 */

import { TradeIntent, NettingResult } from "./types";
import { logger } from "../shared/logger";

/**
 * Fast linear netting function
 * Processes intents sequentially using state maps
 */
export function runFastNetting(intents: TradeIntent[]): NettingResult {
  const startTime = process.hrtime.bigint();
  
  if (intents.length === 0) {
    return {
      finalOwners: new Map(),
      netCashDeltas: new Map(),
      consumedIntentIds: [],
      batchId: "",
      nettedAt: Math.floor(Date.now() / 1000),
      numIntents: 0,
      numItemsSettled: 0,
      numWallets: 0,
    };
  }
  
  // State maps
  const itemOwners = new Map<string, string>(); // itemId -> current owner
  const netCashDeltas = new Map<string, bigint>(); // wallet -> net change
  const consumedIntentIds: string[] = [];
  const skippedIntentIds: string[] = [];
  const activeWallets = new Set<string>();
  
  logger.info("[FAST_NET] Starting fast linear netting", {
    numIntents: intents.length,
  });
  
  // CRITICAL: Safe BigInt arithmetic helper to prevent overflow
  function safeAdd(a: bigint, b: bigint): bigint {
    const result = a + b;
    // Check for overflow: if both are positive, result should be >= a
    // If both are negative, result should be <= a
    if (a > 0n && b > 0n && result < a) {
      throw new Error(`BigInt overflow: ${a} + ${b}`);
    }
    if (a < 0n && b < 0n && result > a) {
      throw new Error(`BigInt underflow: ${a} + ${b}`);
    }
    return result;
  }
  
  // Process each intent in order
  for (const intent of intents) {
    // Track active wallets
    activeWallets.add(intent.from);
    activeWallets.add(intent.to);
    
    // Get current owner (defaults to intent.from if item not seen before)
    const currentOwner = itemOwners.get(intent.itemId) || intent.from;
    
    // Validate chain sequence: currentOwner must match intent.from
    if (currentOwner !== intent.from) {
      logger.warn("[FAST_NET] Invalid chain sequence - skipping intent", {
        intentId: intent.id,
        itemId: intent.itemId,
        expectedOwner: currentOwner,
        actualOwner: intent.from,
      });
      skippedIntentIds.push(intent.id);
      continue; // Skip this intent
    }
    
    // Update item ownership
    itemOwners.set(intent.itemId, intent.to);
    
    // Update net cash deltas with safe arithmetic
    const fromDelta = netCashDeltas.get(intent.from) || 0n;
    const toDelta = netCashDeltas.get(intent.to) || 0n;
    
    // Seller receives payment (+amount), buyer pays (-amount)
    try {
      netCashDeltas.set(intent.from, safeAdd(fromDelta, intent.amountLamports));
      netCashDeltas.set(intent.to, safeAdd(toDelta, -intent.amountLamports));
    } catch (error) {
      logger.error("[FAST_NET] Arithmetic error - skipping intent", {
        intentId: intent.id,
        error: error instanceof Error ? error.message : String(error),
      });
      skippedIntentIds.push(intent.id);
      continue;
    }
    
    // Track consumed intent
    consumedIntentIds.push(intent.id);
  }
  
  // CRITICAL: Invariant check - cash conservation
  // Sum of all net cash deltas should be zero (pure netting)
  const totalDelta = Array.from(netCashDeltas.values()).reduce((a, b) => a + b, 0n);
  if (totalDelta !== 0n) {
    logger.error("[FAST_NET] Cash conservation violated!", {
      totalDelta: totalDelta.toString(),
      numDeltas: netCashDeltas.size,
    });
    throw new Error(`Cash conservation violated: total delta = ${totalDelta.toString()}`);
  }
  
  // CRITICAL: Invariant check - item uniqueness
  // Each item should have exactly one final owner
  const itemIds = Array.from(itemOwners.keys());
  const uniqueItemIds = new Set(itemIds);
  if (itemIds.length !== uniqueItemIds.size) {
    logger.error("[FAST_NET] Item uniqueness violated!", {
      itemIdsCount: itemIds.length,
      uniqueItemIdsCount: uniqueItemIds.size,
    });
    throw new Error("Item uniqueness violated: duplicate items in finalOwners");
  }
  
  // Remove zero deltas (cleanup)
  for (const [wallet, delta] of netCashDeltas.entries()) {
    if (delta === 0n) {
      netCashDeltas.delete(wallet);
    }
  }
  
  // Calculate duration
  const endTime = process.hrtime.bigint();
  const durationNs = endTime - startTime;
  const durationMs = Number(durationNs) / 1_000_000; // Convert nanoseconds to milliseconds
  
  logger.info(`[FAST_NET][WRAITH] Processed ${intents.length} intents in ${durationMs.toFixed(3)}ms`, {
    numIntents: intents.length,
    processed: consumedIntentIds.length,
    skipped: skippedIntentIds.length,
    durationMs: durationMs.toFixed(3),
    numItemsSettled: itemOwners.size,
    numWallets: activeWallets.size,
    numNonZeroDeltas: netCashDeltas.size,
    cashConservation: totalDelta === 0n ? "OK" : "VIOLATED",
  });
  
  // Return NettingResult-compatible object
  return {
    finalOwners: itemOwners,
    netCashDeltas,
    consumedIntentIds,
    skippedIntentIds: skippedIntentIds.length > 0 ? skippedIntentIds : undefined,
    batchId: "", // Engine will set this later
    nettedAt: Math.floor(Date.now() / 1000),
    numIntents: intents.length,
    numItemsSettled: itemOwners.size,
    numWallets: activeWallets.size,
  };
}

/**
 * Re-export toSettlementPayload from graph.ts for compatibility
 * (Fast netting uses the same settlement payload format)
 */
export { toSettlementPayload } from "./graph";

