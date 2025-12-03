/**
 * ======================================================================
 * BATTLE TEST - PHANTOMGRID WRAITH EDITION
 * ======================================================================
 * 
 * Stress test the netting engine with massive batches (10k, 50k, 100k intents).
 * 
 * Measures:
 * - CPU / RAM usage
 * - DB writes/reads per batch
 * - Solana tx count (should be ~1 per batch)
 * - Time per batch
 * - Cost per 1M actions
 * 
 * Usage:
 *   npm run battle:test -- --intents 10000
 *   npm run battle:test -- --intents 50000
 *   npm run battle:test -- --intents 100000
 */

import dotenv from "dotenv";
dotenv.config();

import { initDatabase, query } from "../shared/db";
import { submitIntent, runNettingBatch } from "../netting/engine";
import { registerSessionKeyPolicy } from "../netting/session";
import { TradeIntent, SessionKeyPolicy } from "../netting/types";
import { Keypair, PublicKey } from "@solana/web3.js";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../shared/logger";
import { performance } from "perf_hooks";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

interface BattleTestResult {
  numIntents: number;
  batchId: string;
  numItemsSettled: number;
  numWallets: number;
  nettingTimeMs: number;
  dbWrites: number;
  dbReads: number;
  solanaTxs: number;
  memoryUsageMB: number;
  cpuUsagePercent: number;
}

/**
 * Generate chain intents (A->B, B->C, C->D) for battle test
 */
function generateChainIntents(
  numIntents: number,
  numItems: number,
  wallets: Keypair[],
  sessionKeys: Map<string, { keypair: Keypair; policy: SessionKeyPolicy }>
): TradeIntent[] {
  const intents: TradeIntent[] = [];
  const numWallets = wallets.length;
  
  // Generate intents as chains
  let intentCount = 0;
  for (let itemIdx = 0; itemIdx < numItems && intentCount < numIntents; itemIdx++) {
    const itemId = `item_${itemIdx}`;
    
    // Create chain: A->B, B->C, C->D, ...
    for (let w = 0; w < numWallets - 1 && intentCount < numIntents; w++) {
      const fromWallet = wallets[w];
      const toWallet = wallets[w + 1];
      const session = sessionKeys.get(fromWallet.publicKey.toBase58());
      
      if (!session) continue;
      
      const intent: TradeIntent = {
        id: uuidv4(),
        sessionPubkey: session.policy.sessionPubkey,
        ownerPubkey: fromWallet.publicKey.toBase58(),
        itemId,
        from: fromWallet.publicKey.toBase58(),
        to: toWallet.publicKey.toBase58(),
        amountLamports: BigInt(100_000_000), // 0.1 SOL
        nonce: intentCount,
        signature: Buffer.from(`fake_sig_${intentCount}`).toString("base64"),
        createdAt: Math.floor(Date.now() / 1000),
        intentType: "TRADE",
      };
      
      intents.push(intent);
      intentCount++;
    }
  }
  
  return intents;
}

/**
 * Measure system resources
 */
function getSystemMetrics(): { memoryMB: number; cpuPercent: number } {
  const memUsage = process.memoryUsage();
  const memoryMB = memUsage.heapUsed / 1024 / 1024;
  
  // CPU usage is harder to measure accurately in Node.js
  // This is a simplified approximation
  const cpuUsage = process.cpuUsage();
  const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
  
  return { memoryMB, cpuPercent };
}

/**
 * Count database operations
 */
async function countDbOperations(batchId: string): Promise<{ writes: number; reads: number }> {
  try {
    // Count writes (intents + batch + settled_items + net_cash_deltas)
    const intentCount = await query(
      "SELECT COUNT(*) as count FROM trade_intents WHERE id IN (SELECT jsonb_array_elements_text(intent_ids) FROM netting_batches WHERE batch_id = $1)",
      [batchId]
    );
    
    const batchCount = await query(
      "SELECT COUNT(*) as count FROM netting_batches WHERE batch_id = $1",
      [batchId]
    );
    
    const itemsCount = await query(
      "SELECT COUNT(*) as count FROM settled_items WHERE batch_id = $1",
      [batchId]
    );
    
    const deltasCount = await query(
      "SELECT COUNT(*) as count FROM net_cash_deltas WHERE batch_id = $1",
      [batchId]
    );
    
    const writes = 
      parseInt(intentCount.rows[0]?.count || "0") +
      parseInt(batchCount.rows[0]?.count || "0") +
      parseInt(itemsCount.rows[0]?.count || "0") +
      parseInt(deltasCount.rows[0]?.count || "0");
    
    // Estimate reads (simplified - actual count would require query logging)
    const reads = writes * 2; // Rough estimate: 2 reads per write
    
    return { writes, reads };
  } catch (error) {
    logger.warn("Failed to count DB operations", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { writes: 0, reads: 0 };
  }
}

/**
 * Run battle test
 */
async function runBattleTest(numIntents: number): Promise<BattleTestResult> {
  logger.info("[BATTLE_TEST] Starting battle test", { numIntents });
  
  // Setup
  await initDatabase();
  
  const numWallets = Math.min(100, Math.ceil(numIntents / 100)); // ~100 intents per wallet
  const numItems = Math.min(1000, Math.ceil(numIntents / 10)); // ~10 intents per item
  
  // Create session keys
  const sessionKeys = new Map<string, { keypair: Keypair; policy: SessionKeyPolicy }>();
  const wallets: Keypair[] = [];
  
  for (let i = 0; i < numWallets; i++) {
    const w = Keypair.generate();
    wallets.push(w);
    const s = Keypair.generate();
    const policy: SessionKeyPolicy = {
      ownerPubkey: w.publicKey.toBase58(),
      sessionPubkey: s.publicKey.toBase58(),
      maxVolumeLamports: BigInt(1_000_000_000_000_000), // 1M SOL max
      expiresAt: Math.floor(Date.now() / 1000) + 86400 * 365, // 1 year
      allowedActions: ["TRADE", "BID", "BUY_NOW"],
      createdAt: Math.floor(Date.now() / 1000),
    };
    registerSessionKeyPolicy(policy);
    sessionKeys.set(w.publicKey.toBase58(), { keypair: s, policy });
  }
  
  // Generate intents
  logger.info("[BATTLE_TEST] Generating intents", { numIntents, numWallets, numItems });
  const intents = generateChainIntents(numIntents, numItems, wallets, sessionKeys);
  
  // Measure memory before
  const metricsBefore = getSystemMetrics();
  
  // Submit intents
  logger.info("[BATTLE_TEST] Submitting intents", { count: intents.length });
  const submitStart = performance.now();
  
  let submitted = 0;
  let failed = 0;
  
  for (const intent of intents) {
    const result = await submitIntent(intent);
    if (result.accepted) {
      submitted++;
    } else {
      failed++;
      if (failed < 10) {
        logger.warn("[BATTLE_TEST] Intent rejected", {
          intentId: intent.id,
          reason: result.reason,
        });
      }
    }
    
    // Progress logging
    if (submitted % 1000 === 0) {
      logger.info("[BATTLE_TEST] Submission progress", {
        submitted,
        failed,
        total: intents.length,
      });
    }
  }
  
  const submitTime = performance.now() - submitStart;
  logger.info("[BATTLE_TEST] Submission complete", {
    submitted,
    failed,
    submitTimeMs: submitTime.toFixed(2),
  });
  
  // Run netting batch
  logger.info("[BATTLE_TEST] Running netting batch", { submitted });
  const nettingStart = performance.now();
  
  const result = await runNettingBatch({
    minIntentsPerBatch: submitted,
    maxIntentsPerBatch: submitted + 1000,
  });
  
  const nettingTime = performance.now() - nettingStart;
  
  // Measure memory after
  const metricsAfter = getSystemMetrics();
  const memoryDelta = metricsAfter.memoryMB - metricsBefore.memoryMB;
  
  // Count DB operations
  const dbOps = await countDbOperations(result.batchId);
  
  // Count Solana transactions (check if batch was settled)
  const batchResult = await query(
    "SELECT settled, tx_signature FROM netting_batches WHERE batch_id = $1",
    [result.batchId]
  );
  const solanaTxs = batchResult.rows[0]?.settled && batchResult.rows[0]?.tx_signature ? 1 : 0;
  
  const battleResult: BattleTestResult = {
    numIntents: submitted,
    batchId: result.batchId,
    numItemsSettled: result.numItemsSettled,
    numWallets: result.numWallets,
    nettingTimeMs: nettingTime,
    dbWrites: dbOps.writes,
    dbReads: dbOps.reads,
    solanaTxs,
    memoryUsageMB: memoryDelta,
    cpuUsagePercent: metricsAfter.cpuPercent,
  };
  
  logger.info("[BATTLE_TEST] Battle test complete", battleResult);
  
  return battleResult;
}

/**
 * Calculate cost per 1M actions
 */
function calculateCosts(result: BattleTestResult): {
  costPer1MActions: number;
  breakdown: {
    compute: number;
    database: number;
    solana: number;
    total: number;
  };
} {
  // Assumptions (adjust based on your infrastructure):
  // - Compute: $0.10 per hour per vCPU (AWS EC2 t3.medium = 2 vCPU = $0.20/hour)
  // - Database: $0.10 per 1M writes, $0.01 per 1M reads (AWS RDS)
  // - Solana: $0.00025 per transaction (current devnet/mainnet fees)
  
  const computeCostPerHour = 0.20; // $0.20/hour for 2 vCPU
  const dbWriteCostPer1M = 0.10;
  const dbReadCostPer1M = 0.01;
  const solanaTxCost = 0.00025;
  
  // Calculate costs for this batch
  const batchTimeHours = result.nettingTimeMs / 1000 / 3600;
  const computeCost = computeCostPerHour * batchTimeHours;
  
  const dbWriteCost = (result.dbWrites / 1_000_000) * dbWriteCostPer1M;
  const dbReadCost = (result.dbReads / 1_000_000) * dbReadCostPer1M;
  const solanaCost = result.solanaTxs * solanaTxCost;
  
  const totalCost = computeCost + dbWriteCost + dbReadCost + solanaCost;
  
  // Scale to 1M actions
  const costPer1MActions = (totalCost / result.numIntents) * 1_000_000;
  
  return {
    costPer1MActions,
    breakdown: {
      compute: (computeCost / result.numIntents) * 1_000_000,
      database: ((dbWriteCost + dbReadCost) / result.numIntents) * 1_000_000,
      solana: (solanaCost / result.numIntents) * 1_000_000,
      total: costPer1MActions,
    },
  };
}

/**
 * Main function
 */
async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option("intents", {
      type: "number",
      default: 10000,
      description: "Number of intents to generate",
    })
    .option("runs", {
      type: "number",
      default: 1,
      description: "Number of test runs",
    })
    .parse();
  
  const numIntents = argv.intents;
  const numRuns = argv.runs;
  
  logger.info("[BATTLE_TEST] Starting battle test suite", {
    numIntents,
    numRuns,
    profile: process.env.NETTING_PROFILE || "CLASSIC",
  });
  
  const results: BattleTestResult[] = [];
  
  for (let run = 1; run <= numRuns; run++) {
    logger.info("[BATTLE_TEST] Run", { run, total: numRuns });
    const result = await runBattleTest(numIntents);
    results.push(result);
    
    // Calculate costs
    const costs = calculateCosts(result);
    
    console.log("\n" + "=".repeat(80));
    console.log(`BATTLE TEST RUN ${run}/${numRuns} - ${numIntents.toLocaleString()} INTENTS`);
    console.log("=".repeat(80));
    console.log(`Batch ID: ${result.batchId}`);
    console.log(`Intents Processed: ${result.numIntents.toLocaleString()}`);
    console.log(`Items Settled: ${result.numItemsSettled.toLocaleString()}`);
    console.log(`Wallets: ${result.numWallets.toLocaleString()}`);
    console.log(`Netting Time: ${result.nettingTimeMs.toFixed(2)}ms`);
    console.log(`DB Writes: ${result.dbWrites.toLocaleString()}`);
    console.log(`DB Reads: ${result.dbReads.toLocaleString()}`);
    console.log(`Solana Txs: ${result.solanaTxs}`);
    console.log(`Memory Delta: ${result.memoryUsageMB.toFixed(2)}MB`);
    console.log("\n💰 COST ANALYSIS (per 1M actions):");
    console.log(`  Compute: $${costs.breakdown.compute.toFixed(4)}`);
    console.log(`  Database: $${costs.breakdown.database.toFixed(4)}`);
    console.log(`  Solana: $${costs.breakdown.solana.toFixed(4)}`);
    console.log(`  TOTAL: $${costs.costPer1MActions.toFixed(4)}`);
    console.log("=".repeat(80) + "\n");
    
    // Wait between runs
    if (run < numRuns) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second cooldown
    }
  }
  
  // Summary
  if (results.length > 1) {
    const avgNettingTime = results.reduce((sum, r) => sum + r.nettingTimeMs, 0) / results.length;
    const avgCost = results.reduce((sum, r) => sum + calculateCosts(r).costPer1MActions, 0) / results.length;
    
    console.log("\n" + "=".repeat(80));
    console.log("BATTLE TEST SUMMARY");
    console.log("=".repeat(80));
    console.log(`Runs: ${numRuns}`);
    console.log(`Intents per run: ${numIntents.toLocaleString()}`);
    console.log(`Avg Netting Time: ${avgNettingTime.toFixed(2)}ms`);
    console.log(`Avg Cost per 1M Actions: $${avgCost.toFixed(4)}`);
    console.log("=".repeat(80) + "\n");
  }
}

if (require.main === module) {
  main().catch(error => {
    logger.error("[BATTLE_TEST] Fatal error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  });
}

