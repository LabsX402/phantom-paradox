/**
 * Metrics collection and cost calculation utilities
 */

export interface CostMetrics {
  auctions: number;
  players: number;
  bids: number;
  solPrice: number;
  
  // Transaction counts
  naiveTxCount: number;
  merkleTxCount: number;
  
  // Costs
  naiveCostSol: number;
  naiveCostUsd: number;
  merkleCostSol: number;
  merkleCostUsd: number;
  
  // Per-auction costs
  costPerAuctionNaive: number;
  costPerAuctionMerkle: number;
  
  // Reduction
  reductionFactor: number;
  reductionPercent: number;
  
  // Enhanced metrics for 10x scale
  perPhaseTimings?: {
    create_auctions_ms: number;
    register_players_ms: number;
    bidding_ms: number;
    settlement_ms: number;
    max_single_tx_ms?: number;
  };
  throughput?: {
    tps_estimate: number; // transactions per second
    ops_per_sec: number; // operations per second (bids + settlements + cancels)
  };
  costBreakdown?: {
    creation_cost_usd: number;
    bidding_cost_usd: number;
    settlement_cost_usd: number;
    max_tx_fee_lamports: number;
    avg_tx_fee_lamports: number;
  };
  computeMetrics?: {
    max_compute_units_used?: number;
    max_tx_size_bytes?: number;
  };
}

const BASE_FEE_LAMPORTS = 5000; // 5,000 lamports per transaction
const LAMPORTS_PER_SOL = 1_000_000_000;
const MERKLE_BATCH_SIZE = 1000; // Auctions per batch

/**
 * Calculate cost metrics for a scenario
 */
export function calculateCostMetrics(
  auctions: number,
  players: number,
  bids: number,
  solPrice: number
): CostMetrics {
  // Base fee per transaction
  const baseFeeSol = BASE_FEE_LAMPORTS / LAMPORTS_PER_SOL;
  const costPerTxUsd = baseFeeSol * solPrice;
  
  // Naive model: 2 tx per auction (create + settle) + 1 tx per bid
  const naiveTxCount = (2 * auctions) + bids;
  const naiveCostSol = naiveTxCount * baseFeeSol;
  const naiveCostUsd = naiveCostSol * solPrice;
  
  // Merkle model: 2 * ceil(auctions / batch_size) for create + settle
  const merkleTxCount = 2 * Math.ceil(auctions / MERKLE_BATCH_SIZE);
  const merkleCostSol = merkleTxCount * baseFeeSol;
  const merkleCostUsd = merkleCostSol * solPrice;
  
  // Per-auction costs
  const costPerAuctionNaive = auctions > 0 ? naiveCostUsd / auctions : 0;
  const costPerAuctionMerkle = auctions > 0 ? merkleCostUsd / auctions : 0;
  
  // Reduction
  const reductionFactor = naiveCostUsd > 0 ? naiveCostUsd / merkleCostUsd : 1;
  const reductionPercent = ((naiveCostUsd - merkleCostUsd) / naiveCostUsd) * 100;
  
  return {
    auctions,
    players,
    bids,
    solPrice,
    naiveTxCount,
    merkleTxCount,
    naiveCostSol,
    naiveCostUsd,
    merkleCostSol,
    merkleCostUsd,
    costPerAuctionNaive,
    costPerAuctionMerkle,
    reductionFactor,
    reductionPercent
  };
}

/**
 * Format metrics for display
 */
export function formatMetrics(metrics: CostMetrics): string {
  return `
Cost Model Metrics
==================
Scenario:
  Auctions: ${metrics.auctions.toLocaleString()}
  Players: ${metrics.players.toLocaleString()}
  Bids: ${metrics.bids.toLocaleString()}
  SOL Price: $${metrics.solPrice}

Transaction Counts:
  Naive Model: ${metrics.naiveTxCount.toLocaleString()} tx
  Merkle Model: ${metrics.merkleTxCount.toLocaleString()} tx
  Reduction: ${metrics.reductionFactor.toFixed(2)}x

Costs (USD):
  Naive Model: $${metrics.naiveCostUsd.toFixed(2)}
  Merkle Model: $${metrics.merkleCostUsd.toFixed(2)}
  Savings: $${(metrics.naiveCostUsd - metrics.merkleCostUsd).toFixed(2)} (${metrics.reductionPercent.toFixed(2)}%)

Per-Auction Cost:
  Naive: $${metrics.costPerAuctionNaive.toFixed(6)}
  Merkle: $${metrics.costPerAuctionMerkle.toFixed(6)}
`;
}

/**
 * Export metrics to JSON
 */
export function exportMetrics(metrics: CostMetrics, filepath: string): void {
  const fs = require('fs');
  const path = require('path');
  
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(filepath, JSON.stringify(metrics, null, 2));
  console.log(`✅ Metrics exported to ${filepath}`);
}

