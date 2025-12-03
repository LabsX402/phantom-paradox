/**
 * ======================================================================
 * GRAPH-BASED NETTING ALGORITHM
 * ======================================================================
 * 
 * Implements dependency-graph based netting for trade intents.
 * 
 * Algorithm:
 * 1. Build a graph of trades (nodes = wallets, edges = trades)
 * 2. For each item, collapse chains (Alice -> Bob -> Charlie -> Dave)
 * 3. Compute final ownership and net cash deltas
 * 
 * Example:
 * - Alice -> Bob (item1, 100 lamports)
 * - Bob -> Charlie (item1, 100 lamports)
 * - Charlie -> Dave (item1, 100 lamports)
 * 
 * Result:
 * - Final owner: Dave (item1)
 * - Net deltas: Bob: +100, Charlie: 0, Dave: -100
 */

import { TradeIntent, NettingResult, SettledItem, NetDelta, GraphNode, GraphEdge } from "./types";
import { logger } from "../shared/logger";

/**
 * Build a graph from trade intents
 */
function buildGraph(intents: TradeIntent[]): {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
} {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  
  for (const intent of intents) {
    // Ensure nodes exist
    if (!nodes.has(intent.from)) {
      nodes.set(intent.from, {
        pubkey: intent.from,
        incoming: new Map(),
        outgoing: new Map(),
      });
    }
    
    if (!nodes.has(intent.to)) {
      nodes.set(intent.to, {
        pubkey: intent.to,
        incoming: new Map(),
        outgoing: new Map(),
      });
    }
    
    const fromNode = nodes.get(intent.from)!;
    const toNode = nodes.get(intent.to)!;
    
    // Add edge
    edges.push({
      from: intent.from,
      to: intent.to,
      itemId: intent.itemId,
      amount: intent.amountLamports,
      intentId: intent.id,
    });
    
    // Track in/out for each node
    const fromOutgoing = fromNode.outgoing.get(intent.itemId) || 0n;
    fromNode.outgoing.set(intent.itemId, fromOutgoing + intent.amountLamports);
    
    const toIncoming = toNode.incoming.get(intent.itemId) || 0n;
    toNode.incoming.set(intent.itemId, toIncoming + intent.amountLamports);
  }
  
  return { nodes, edges };
}

/**
 * Collapse chains for a specific item
 * 
 * For item X:
 * - Alice -> Bob (100)
 * - Bob -> Charlie (100)
 * - Charlie -> Dave (100)
 * 
 * Becomes:
 * - Alice -> Dave (100)
 * - Net deltas: Bob: +100, Charlie: 0, Dave: -100
 */
function collapseItemChain(
  itemId: string,
  edges: GraphEdge[],
  nodes: Map<string, GraphNode>
): {
  finalOwner: string | null;
  netDeltas: Map<string, bigint>;
  consumedIntentIds: string[];
} {
  // Filter edges for this item
  const itemEdges = edges.filter(e => e.itemId === itemId);
  
  if (itemEdges.length === 0) {
    return {
      finalOwner: null,
      netDeltas: new Map(),
      consumedIntentIds: [],
    };
  }
  
  // Build ownership chain
  // Map: owner -> next owner
  const ownershipChain = new Map<string, string>();
  const intentIds: string[] = [];
  
  for (const edge of itemEdges) {
    ownershipChain.set(edge.from, edge.to);
    intentIds.push(edge.intentId);
  }
  
  // Find the start of the chain (someone who sells but doesn't buy)
  let startOwner: string | null = null;
  for (const [from, to] of ownershipChain.entries()) {
    if (!ownershipChain.has(to)) {
      // This is a potential end, but we need to find the start
      continue;
    }
    // Check if 'from' is not bought by anyone
    let isStart = true;
    for (const [otherFrom, otherTo] of ownershipChain.entries()) {
      if (otherTo === from) {
        isStart = false;
        break;
      }
    }
    if (isStart) {
      startOwner = from;
      break;
    }
  }
  
  // If no clear start, use the first edge's from
  if (!startOwner && itemEdges.length > 0) {
    startOwner = itemEdges[0].from;
  }
  
  // Traverse chain to find final owner
  let currentOwner = startOwner;
  let finalOwner: string | null = startOwner;
  const visited = new Set<string>();
  
  while (currentOwner && ownershipChain.has(currentOwner)) {
    if (visited.has(currentOwner)) {
      // Cycle detected - break
      logger.warn("Cycle detected in ownership chain", {
        itemId,
        currentOwner,
      });
      break;
    }
    visited.add(currentOwner);
    finalOwner = ownershipChain.get(currentOwner)!;
    currentOwner = finalOwner;
  }
  
  // Compute net deltas
  // For each intermediate owner: +amount (received) - amount (paid)
  const netDeltas = new Map<string, bigint>();
  
  // Initialize all involved wallets
  const allWallets = new Set<string>();
  for (const edge of itemEdges) {
    allWallets.add(edge.from);
    allWallets.add(edge.to);
  }
  
  for (const wallet of allWallets) {
    netDeltas.set(wallet, 0n);
  }
  
  // For each edge, update deltas
  for (const edge of itemEdges) {
    // Seller receives money
    const sellerDelta = netDeltas.get(edge.from) || 0n;
    netDeltas.set(edge.from, sellerDelta + edge.amount);
    
    // Buyer pays money
    const buyerDelta = netDeltas.get(edge.to) || 0n;
    netDeltas.set(edge.to, buyerDelta - edge.amount);
  }
  
  // Final owner pays the net amount
  if (finalOwner) {
    // The final owner should pay the total amount
    // But they may have already paid in intermediate trades
    // So we need to compute the net
    const finalDelta = netDeltas.get(finalOwner) || 0n;
    // If finalDelta is already negative, that's the net payment
    // If positive, they received more than they paid (shouldn't happen in a chain)
    // For simplicity, we'll keep the computed delta
  }
  
  return {
    finalOwner,
    netDeltas,
    consumedIntentIds: intentIds,
  };
}

/**
 * Run netting on a list of trade intents
 */
export function runNetting(intents: TradeIntent[]): NettingResult {
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
  
  logger.info("Starting netting", {
    numIntents: intents.length,
  });
  
  // Build graph
  const { nodes, edges } = buildGraph(intents);
  
  // Group edges by item
  const itemsByItemId = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    if (!itemsByItemId.has(edge.itemId)) {
      itemsByItemId.set(edge.itemId, []);
    }
    itemsByItemId.get(edge.itemId)!.push(edge);
  }
  
  // Process each item
  const finalOwners = new Map<string, string>();
  const allNetDeltas = new Map<string, bigint>();
  const allConsumedIntentIds = new Set<string>();
  
  for (const [itemId, itemEdges] of itemsByItemId.entries()) {
    const result = collapseItemChain(itemId, itemEdges, nodes);
    
    if (result.finalOwner) {
      finalOwners.set(itemId, result.finalOwner);
    }
    
    // Merge net deltas
    for (const [wallet, delta] of result.netDeltas.entries()) {
      const current = allNetDeltas.get(wallet) || 0n;
      allNetDeltas.set(wallet, current + delta);
    }
    
    // Collect intent IDs
    for (const intentId of result.consumedIntentIds) {
      allConsumedIntentIds.add(intentId);
    }
  }
  
  // Get unique wallets
  const uniqueWallets = new Set<string>();
  for (const intent of intents) {
    uniqueWallets.add(intent.from);
    uniqueWallets.add(intent.to);
  }
  
  const result: NettingResult = {
    finalOwners,
    netCashDeltas: allNetDeltas,
    consumedIntentIds: Array.from(allConsumedIntentIds),
    batchId: "", // Will be set by engine
    nettedAt: Math.floor(Date.now() / 1000),
    numIntents: intents.length,
    numItemsSettled: finalOwners.size,
    numWallets: uniqueWallets.size,
  };
  
  logger.info("Netting complete", {
    numIntents: result.numIntents,
    numItemsSettled: result.numItemsSettled,
    numWallets: result.numWallets,
    finalOwnersCount: result.finalOwners.size,
  });
  
  return result;
}

/**
 * Convert netting result to settlement payload format
 */
export function toSettlementPayload(result: NettingResult): {
  settledItems: SettledItem[];
  netDeltas: NetDelta[];
} {
  const settledItems: SettledItem[] = [];
  for (const [itemId, owner] of result.finalOwners.entries()) {
    settledItems.push({
      itemId,
      finalOwner: owner,
    });
  }
  
  const netDeltas: NetDelta[] = [];
  for (const [owner, delta] of result.netCashDeltas.entries()) {
    if (delta !== 0n) {
      netDeltas.push({
        ownerPubkey: owner,
        deltaLamports: delta,
      });
    }
  }
  
  return { settledItems, netDeltas };
}

