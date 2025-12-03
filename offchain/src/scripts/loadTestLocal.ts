/**
 * Local Load Test for PhantomGrid Gaming
 * 
 * This script performs a load test to ensure the architecture behaves under pressure:
 * 1. Generates 5,000-10,000 trade intents
 * 2. Submits them as fast as reasonably possible
 * 3. Waits for netting batches to settle
 * 4. Measures and logs performance metrics
 * 5. Validates invariants and API responsiveness
 */

import dotenv from "dotenv";
dotenv.config();

// Use node-fetch if available, otherwise use built-in fetch (Node 18+)
let fetch: any;
try {
  fetch = require("node-fetch");
} catch {
  // Node 18+ has built-in fetch
  fetch = globalThis.fetch;
}
import { Keypair } from "@solana/web3.js";
import { v4 as uuidv4 } from "uuid";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// ======================================================================
// CONFIGURATION DEFAULTS
// ======================================================================
const DEFAULT_INTENTS = 7500; // Between 5k-10k
const DEFAULT_CONCURRENCY = 50; // Parallel requests
const DEFAULT_POLL_INTERVAL_MS = 2000; // 2 seconds
const DEFAULT_MAX_WAIT_MS = 300000; // 5 minutes for load test
const DEFAULT_TEST_WALLETS = 20; // More wallets for load test
const DEFAULT_TEST_ITEMS = 100; // More items for load test

// Parse CLI arguments
const argv = yargs(hideBin(process.argv))
  .option("intents", {
    type: "number",
    description: "Number of intents to submit",
    default: DEFAULT_INTENTS,
  })
  .option("concurrency", {
    type: "number",
    description: "Number of parallel requests",
    default: DEFAULT_CONCURRENCY,
  })
  .option("poll-interval", {
    type: "number",
    description: "Poll interval in milliseconds",
    default: DEFAULT_POLL_INTERVAL_MS,
  })
  .option("max-wait", {
    type: "number",
    description: "Maximum wait time in milliseconds",
    default: DEFAULT_MAX_WAIT_MS,
  })
  .parseSync();

// Test configuration
const NUM_INTENTS = (argv.intents as number) || DEFAULT_INTENTS;
const CONCURRENCY = ((argv as any).concurrency as number) || DEFAULT_CONCURRENCY;
const POLL_INTERVAL_MS = ((argv as any).pollInterval as number) || DEFAULT_POLL_INTERVAL_MS;
const MAX_WAIT_MS = ((argv as any).maxWait as number) || DEFAULT_MAX_WAIT_MS;

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";
const API_KEY = process.env.API_KEY || "test-api-key-123";
const GAME_ID = process.env.GAME_ID || "test-game";
const MAX_VOLUME_LAMPORTS = BigInt(50_000_000_000); // 50 SOL for load test

// Generate test wallets
const wallets: string[] = [];
for (let i = 0; i < DEFAULT_TEST_WALLETS; i++) {
  wallets.push(Keypair.generate().publicKey.toBase58());
}

// Generate test items
const items: string[] = [];
for (let i = 0; i < DEFAULT_TEST_ITEMS; i++) {
  items.push(`item-${i}`);
}

// Metrics tracking
interface LoadTestMetrics {
  submissionStartTime: number;
  submissionEndTime: number;
  submissionDuration: number;
  totalIntentsSubmitted: number;
  totalIntentsRejected: number;
  totalIntentsFailed: number;
  firstBatchSettledTime: number | null;
  timeToFirstBatch: number | null;
  batchesCreated: string[];
  batchesSettled: string[];
  finalItemsSettled: number;
  finalWalletsAffected: number;
  apiErrors: number;
  api500Errors: number;
  rateLimitHits: number;
}

const metrics: LoadTestMetrics = {
  submissionStartTime: 0,
  submissionEndTime: 0,
  submissionDuration: 0,
  totalIntentsSubmitted: 0,
  totalIntentsRejected: 0,
  totalIntentsFailed: 0,
  firstBatchSettledTime: null,
  timeToFirstBatch: null,
  batchesCreated: [],
  batchesSettled: [],
  finalItemsSettled: 0,
  finalWalletsAffected: 0,
  apiErrors: 0,
  api500Errors: 0,
  rateLimitHits: 0,
};

interface IntentResponse {
  status: "accepted" | "rejected";
  reason?: string;
}

interface BatchResponse {
  batchId?: string;
  batch_id?: string;
  settled?: boolean;
  numIntents?: number;
  num_intents?: number;
  numItemsSettled?: number;
  num_items_settled?: number;
  numWallets?: number;
  num_wallets?: number;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Make API request with error handling and metrics tracking
 */
async function apiRequest(
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<any> {
  const url = `${API_BASE_URL}${path}`;
  const options: any = {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      ...headers,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    // Track API errors
    if (!response.ok) {
      metrics.apiErrors++;
      if (response.status === 500) {
        metrics.api500Errors++;
      }
      if (response.status === 429) {
        metrics.rateLimitHits++;
      }
      throw new Error(`API error: ${response.status} - ${JSON.stringify(data)}`);
    }

    return data;
  } catch (error) {
    metrics.apiErrors++;
    throw new Error(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Open a session for a wallet
 */
async function openSession(ownerPubkey: string): Promise<{ sessionKey: string }> {
  const sessionKeypair = Keypair.generate();
  const sessionKey = sessionKeypair.publicKey.toBase58();

  const response = await apiRequest("POST", "/api/v1/session/open", {
    ownerWallet: ownerPubkey,
    sessionKey: sessionKey,
    maxVolumeSol: Number(MAX_VOLUME_LAMPORTS) / 1e9,
    durationMinutes: 120, // 2 hours for load test
    allowedActions: ["TRADE"],
  });

  return { sessionKey: response.sessionKey || sessionKey };
}

/**
 * Submit a single intent
 */
async function submitIntent(
  intent: any
): Promise<{ success: boolean; accepted: boolean }> {
  try {
    const response: IntentResponse = await apiRequest("POST", "/api/v1/intents/trade", intent);
    if (response.status === "accepted") {
      metrics.totalIntentsSubmitted++;
      return { success: true, accepted: true };
    } else {
      metrics.totalIntentsRejected++;
      return { success: true, accepted: false };
    }
  } catch (error) {
    metrics.totalIntentsFailed++;
    return { success: false, accepted: false };
  }
}

/**
 * Submit intents with concurrency control
 */
async function submitIntentsBatch(
  intents: any[],
  concurrency: number
): Promise<void> {
  const chunks: any[][] = [];
  for (let i = 0; i < intents.length; i += concurrency) {
    chunks.push(intents.slice(i, i + concurrency));
  }

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const promises = chunk.map(intent => submitIntent(intent));
    await Promise.all(promises);

    if (chunkIndex % 10 === 0) {
      const progress = ((chunkIndex + 1) * concurrency / intents.length * 100).toFixed(1);
      console.log(`  Progress: ${progress}% (${(chunkIndex + 1) * concurrency}/${intents.length} intents)`);
    }

    // Small delay to avoid overwhelming the API
    if (chunkIndex < chunks.length - 1) {
      await sleep(10);
    }
  }
}

/**
 * Generate trade intents
 */
function generateIntents(
  sessionPubkey: string,
  ownerPubkey: string,
  numIntents: number
): any[] {
  const intents: any[] = [];

  for (let i = 0; i < numIntents; i++) {
    const itemId = items[i % items.length];
    const fromWallet = wallets[i % wallets.length];
    const toWallet = wallets[(i + 1) % wallets.length];
    const amount = BigInt(1000 + (i % 10000)); // Vary amounts

    const intent = {
      id: uuidv4(),
      sessionPubkey,
      ownerPubkey,
      itemId,
      from: fromWallet,
      to: toWallet,
      amountLamports: amount.toString(),
      nonce: i + 1,
      signature: `sig-${i}`,
      createdAt: Math.floor(Date.now() / 1000),
      gameId: GAME_ID,
    };

    intents.push(intent);
  }

  return intents;
}

/**
 * Trigger netting batch manually
 */
async function triggerNettingBatch(): Promise<string | null> {
  try {
    const response = await apiRequest("POST", "/api/netting/run", {});
    const batchId = response.batchId || response.batch_id;
    if (batchId && !metrics.batchesCreated.includes(String(batchId))) {
      metrics.batchesCreated.push(String(batchId));
    }
    return batchId || null;
  } catch (error) {
    return null;
  }
}

/**
 * Check if batch is settled
 * Note: Netting engine uses string UUIDs, v1 API uses numeric IDs from database
 */
async function checkBatchSettled(batchId: string): Promise<BatchResponse | null> {
  try {
    // Try netting API first (works with string UUIDs from netting engine)
    const nettingBatch = await apiRequest("GET", `/api/netting/batch/${batchId}`).catch(() => null);
    if (nettingBatch && nettingBatch.settled) {
      return nettingBatch;
    }
    
    // Try v1 API (indexer) - only works if batchId is numeric and indexer has processed it
    // Check if batchId is numeric
    if (!isNaN(Number(batchId))) {
      try {
        const batch = await apiRequest("GET", `/api/v1/batches/${batchId}`);
        // V1 API returns settledAt (timestamp), not settled (boolean)
        if (batch && (batch.settledAt || batch.settled_at)) {
          return { ...batch, settled: true }; // Add settled flag for consistency
        }
      } catch (error) {
        // Batch not found in indexer yet, that's ok
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Poll for settled batches
 */
async function waitForBatches(
  maxWaitMs: number
): Promise<{ batches: BatchResponse[]; firstSettledTime: number | null }> {
  const startTime = Date.now();
  const settledBatches: BatchResponse[] = [];
  let firstSettledTime: number | null = null;
  let lastTriggerTime = Date.now();
  const TRIGGER_INTERVAL_MS = 10000; // Trigger netting every 10 seconds

  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Periodically trigger netting if there are pending intents
      if (Date.now() - lastTriggerTime > TRIGGER_INTERVAL_MS) {
        const pending = await apiRequest("GET", "/api/netting/pending").catch(() => ({ pendingIntents: 0 }));
        if (pending.pendingIntents > 0) {
          await triggerNettingBatch();
          lastTriggerTime = Date.now();
        }
      }

      // Check all known batches for settlement
      for (const batchId of metrics.batchesCreated) {
        if (metrics.batchesSettled.includes(batchId)) continue;
        
        const batch = await checkBatchSettled(batchId);
        if (batch && batch.settled) {
          if (!metrics.batchesSettled.includes(batchId)) {
            metrics.batchesSettled.push(batchId);
            settledBatches.push(batch);
            
            if (firstSettledTime === null) {
              firstSettledTime = Date.now();
            }
          }
        }
      }

      // Check if we've settled all batches or if there are no more pending intents
      const pending = await apiRequest("GET", "/api/netting/pending").catch(() => ({ pendingIntents: 0 }));
      if (pending.pendingIntents === 0 && metrics.batchesCreated.length > 0) {
        // Give it a bit more time for final batches to settle
        await sleep(POLL_INTERVAL_MS * 2);
        break;
      }

      await sleep(POLL_INTERVAL_MS);
      process.stdout.write(".");
    } catch (error) {
      // Continue polling
    }
  }

  return { batches: settledBatches, firstSettledTime };
}

/**
 * Get all settled batches
 */
async function getSettledBatches(): Promise<BatchResponse[]> {
  const settledBatches: BatchResponse[] = [];
  
  for (const batchId of metrics.batchesCreated) {
    const batch = await checkBatchSettled(batchId).catch(() => null);
    if (batch && batch.settled) {
      if (!metrics.batchesSettled.includes(batchId)) {
        metrics.batchesSettled.push(batchId);
      }
      settledBatches.push(batch);
    }
  }
  
  return settledBatches;
}

/**
 * Validate invariants
 */
async function validateInvariants(batches: BatchResponse[]): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  for (const batch of batches) {
    const batchId = batch.batchId || batch.batch_id;
    if (!batchId) continue;

    try {
      const fullBatch = await apiRequest("GET", `/api/v1/batches/${batchId}`).catch(() => null);
      if (!fullBatch) continue;

      // Check cash deltas sum to zero
      if (fullBatch.netCashDeltas) {
        const deltas = Object.values(fullBatch.netCashDeltas);
        const sum = deltas.reduce((acc: bigint, delta: any) => {
          const deltaValue = typeof delta === "string" ? BigInt(delta) : BigInt(Number(delta));
          return acc + deltaValue;
        }, BigInt(0));

        if (sum !== BigInt(0)) {
          errors.push(`Batch ${batchId}: cash deltas do not sum to zero (sum: ${sum})`);
        }
      }
    } catch (error) {
      // Skip if we can't fetch batch
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check API responsiveness
 */
async function checkApiResponsiveness(): Promise<{ responsive: boolean; latency: number }> {
  const startTime = Date.now();
  try {
    await apiRequest("GET", "/health");
    const latency = Date.now() - startTime;
    return { responsive: latency < 1000, latency }; // Should respond in < 1s
  } catch (error) {
    return { responsive: false, latency: Date.now() - startTime };
  }
}

/**
 * Check if indexer has caught up (batches are queryable via v1 API)
 */
async function checkIndexerCaughtUp(batchIds: string[]): Promise<{ caughtUp: boolean; foundBatches: number }> {
  let foundBatches = 0;
  
  for (const batchId of batchIds.slice(0, 10)) { // Check first 10 batches
    try {
      const batch = await apiRequest("GET", `/api/v1/batches/${batchId}`);
      if (batch) {
        foundBatches++;
      }
    } catch (error) {
      // Batch not found in indexer yet
    }
  }
  
  // Indexer is caught up if at least 80% of checked batches are found
  const caughtUp = foundBatches >= Math.min(batchIds.length, 10) * 0.8;
  return { caughtUp, foundBatches };
}

/**
 * Print metrics summary
 */
function printMetrics() {
  const submissionRate = metrics.submissionDuration > 0 
    ? (metrics.totalIntentsSubmitted / (metrics.submissionDuration / 1000)).toFixed(2)
    : "0";
  
  console.log("\n" + "=".repeat(80));
  console.log("LOAD TEST METRICS");
  console.log("=".repeat(80));
  console.log(`Total Intents: ${NUM_INTENTS}`);
  console.log(`Submitted: ${metrics.totalIntentsSubmitted}`);
  console.log(`Rejected: ${metrics.totalIntentsRejected}`);
  console.log(`Failed: ${metrics.totalIntentsFailed}`);
  console.log(`Submission Time: ${(metrics.submissionDuration / 1000).toFixed(2)}s`);
  console.log(`Submission Rate: ${submissionRate} intents/sec`);
  console.log(`Time to First Batch: ${metrics.timeToFirstBatch ? (metrics.timeToFirstBatch / 1000).toFixed(2) + "s" : "N/A"}`);
  console.log(`Batches Created: ${metrics.batchesCreated.length}`);
  console.log(`Batches Settled: ${metrics.batchesSettled.length}`);
  console.log(`Final Items Settled: ${metrics.finalItemsSettled}`);
  console.log(`Final Wallets Affected: ${metrics.finalWalletsAffected}`);
  console.log(`API Errors: ${metrics.apiErrors}`);
  console.log(`API 500 Errors: ${metrics.api500Errors}`);
  console.log(`Rate Limit Hits: ${metrics.rateLimitHits}`);
  console.log("=".repeat(80));
}

/**
 * Main load test function
 */
async function runLoadTest() {
  console.log("=".repeat(80));
  console.log("PHANTOMGRID GAMING - LOCAL LOAD TEST");
  console.log("=".repeat(80));
  console.log(`API: ${API_BASE_URL}`);
  console.log(`Game ID: ${GAME_ID}`);
  console.log(`Intents: ${NUM_INTENTS}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Wallets: ${wallets.length}`);
  console.log(`Items: ${items.length}`);
  console.log("");

  try {
    // Step 1: Open session
    console.log("[1/5] Opening session...");
    const ownerPubkey = wallets[0];
    const session = await openSession(ownerPubkey);
    console.log(`✓ Session opened: ${session.sessionKey}`);

    // Step 2: Generate intents
    console.log(`[2/5] Generating ${NUM_INTENTS} intents...`);
    const intents = generateIntents(session.sessionKey, ownerPubkey, NUM_INTENTS);
    console.log(`✓ Generated ${intents.length} intents`);

    // Step 3: Submit intents (with timing)
    console.log(`[3/5] Submitting ${NUM_INTENTS} intents (concurrency: ${CONCURRENCY})...`);
    metrics.submissionStartTime = Date.now();
    await submitIntentsBatch(intents, CONCURRENCY);
    metrics.submissionEndTime = Date.now();
    metrics.submissionDuration = metrics.submissionEndTime - metrics.submissionStartTime;
    console.log(`✓ Submission complete in ${(metrics.submissionDuration / 1000).toFixed(2)}s`);

    // Step 4: Wait for batches to settle
    console.log(`[4/5] Waiting for batches to settle (max ${MAX_WAIT_MS / 1000}s)...`);
    console.log(`  Triggering initial netting batch...`);
    await triggerNettingBatch();
    
    const { batches, firstSettledTime } = await waitForBatches(MAX_WAIT_MS);
    if (firstSettledTime) {
      metrics.firstBatchSettledTime = firstSettledTime;
      metrics.timeToFirstBatch = firstSettledTime - metrics.submissionEndTime;
      console.log(`\n✓ First batch settled after ${(metrics.timeToFirstBatch! / 1000).toFixed(2)}s`);
    } else {
      console.log(`\n⚠ No batches settled within timeout`);
    }

    // Get all settled batches (final check)
    console.log(`  Checking for additional settled batches...`);
    const settledBatches = await getSettledBatches();
    metrics.batchesSettled = [...new Set(settledBatches.map(b => b.batchId || b.batch_id || "").filter(Boolean))];
    
    // Calculate final counts
    for (const batch of settledBatches) {
      metrics.finalItemsSettled += batch.numItemsSettled || batch.num_items_settled || 0;
      metrics.finalWalletsAffected += batch.numWallets || batch.num_wallets || 0;
    }
    
    console.log(`✓ Found ${metrics.batchesSettled.length} settled batches`);

    // Step 5: Validate
    console.log(`[5/5] Validating results...`);
    
    // Check API responsiveness
    const apiCheck = await checkApiResponsiveness();
    if (!apiCheck.responsive) {
      console.log(`✗ API not responsive (latency: ${apiCheck.latency}ms)`);
    } else {
      console.log(`✓ API responsive (latency: ${apiCheck.latency}ms)`);
    }

    // Check indexer caught up
    if (metrics.batchesSettled.length > 0) {
      const indexerCheck = await checkIndexerCaughtUp(metrics.batchesSettled);
      if (!indexerCheck.caughtUp) {
        console.log(`✗ Indexer not caught up (found ${indexerCheck.foundBatches}/${Math.min(metrics.batchesSettled.length, 10)} batches)`);
      } else {
        console.log(`✓ Indexer caught up (found ${indexerCheck.foundBatches}/${Math.min(metrics.batchesSettled.length, 10)} batches)`);
      }
    } else {
      console.log(`⚠ No batches to check indexer status`);
    }

    // Validate invariants
    const invariantCheck = await validateInvariants(settledBatches);
    if (!invariantCheck.valid) {
      console.log(`✗ Invariant violations:`);
      invariantCheck.errors.forEach(err => console.log(`  - ${err}`));
    } else {
      console.log(`✓ All invariants valid`);
    }

    // Print metrics
    printMetrics();

    // Final assertions
    const indexerCheck = metrics.batchesSettled.length > 0 
      ? await checkIndexerCaughtUp(metrics.batchesSettled)
      : { caughtUp: false, foundBatches: 0 };
    
    const allPassed = 
      metrics.api500Errors === 0 &&
      invariantCheck.valid &&
      apiCheck.responsive &&
      metrics.batchesSettled.length > 0 &&
      (metrics.batchesSettled.length === 0 || indexerCheck.caughtUp);

    if (allPassed) {
      console.log("\n" + "=".repeat(80));
      console.log("LOAD TEST PASSED");
      console.log("=".repeat(80));
      process.exitCode = 0;
      process.exit(0);
    } else {
      console.log("\n" + "=".repeat(80));
      console.log("LOAD TEST FAILED");
      console.log("=".repeat(80));
      if (metrics.api500Errors > 0) {
        console.log(`- API 500 errors: ${metrics.api500Errors}`);
      }
      if (!invariantCheck.valid) {
        console.log(`- Invariant violations: ${invariantCheck.errors.length}`);
      }
      if (!apiCheck.responsive) {
        console.log(`- API not responsive`);
      }
      if (metrics.batchesSettled.length === 0) {
        console.log(`- No batches settled`);
      }
      if (metrics.batchesSettled.length > 0 && !indexerCheck.caughtUp) {
        console.log(`- Indexer not caught up`);
      }
      process.exitCode = 1;
      process.exit(1);
    }
  } catch (error) {
    console.error("\n" + "=".repeat(80));
    console.error("LOAD TEST ERROR");
    console.error("=".repeat(80));
    console.error(error instanceof Error ? error.message : String(error));
    printMetrics();
    process.exitCode = 1;
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runLoadTest().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}

export { runLoadTest };

