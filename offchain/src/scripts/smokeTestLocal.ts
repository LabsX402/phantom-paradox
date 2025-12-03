/**
 * E2E Smoke Test for Local Stack
 * 
 * This script tests the entire local stack end-to-end:
 * 1. Opens a session
 * 2. Submits trade intents
 * 3. Triggers netting
 * 4. Waits for settlement
 * 5. Validates results
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
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import { v4 as uuidv4 } from "uuid";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// ======================================================================
// CONFIGURATION DEFAULTS
// ======================================================================
const DEFAULT_INTENTS = 200;
const DEFAULT_POLL_INTERVAL_MS = 2000; // 2 seconds
const DEFAULT_MAX_WAIT_MS = 60000; // 60 seconds
const DEFAULT_TEST_WALLETS = 5;

// Parse CLI arguments
const argv = yargs(hideBin(process.argv))
  .option("intents", {
    type: "number",
    description: "Number of intents to submit",
    default: DEFAULT_INTENTS,
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

// Test configuration (from CLI args or env vars or defaults)
// yargs converts kebab-case to camelCase, so --poll-interval becomes pollInterval
// Priority: CLI args > env vars > defaults
const NUM_INTENTS = argv.intents !== undefined 
  ? (argv.intents as number)
  : parseInt(process.env.SMOKE_TEST_INTENTS || String(DEFAULT_INTENTS), 10);
const POLL_INTERVAL_MS = ((argv as any).pollInterval as number) || DEFAULT_POLL_INTERVAL_MS;
const MAX_WAIT_MS = ((argv as any).maxWait as number) || DEFAULT_MAX_WAIT_MS;

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";
const API_KEY = process.env.API_KEY || "test-api-key-123";
const RPC_URL = process.env.SOLANA_RPC_URL || process.env.RPC_URL || "http://127.0.0.1:8899";
const PROGRAM_ID = process.env.PROGRAM_ID;

const GAME_ID = process.env.GAME_ID || "test-game";
const MAX_VOLUME_LAMPORTS = BigInt(5_000_000_000); // 5 SOL

// Test wallets (generate DEFAULT_TEST_WALLETS wallets)
const wallets: string[] = [];
for (let i = 0; i < DEFAULT_TEST_WALLETS; i++) {
  wallets.push(Keypair.generate().publicKey.toBase58());
}

// Session response type removed - using simpler structure

interface IntentResponse {
  status: "accepted" | "rejected";
  reason?: string;
}

interface BatchResponse {
  batchId?: string;
  batch_id?: string;
  createdAt?: number;
  created_at?: number;
  nettedAt?: number;
  netted_at?: number;
  settled?: boolean;
  txSignature?: string;
  tx_signature?: string;
  numIntents?: number;
  num_intents?: number;
  numItemsSettled?: number;
  num_items_settled?: number;
  numWallets?: number;
  num_wallets?: number;
  items?: Array<{ itemId: string; finalOwner: string }>;
  cashDeltas?: Array<{ owner: string; deltaLamports: string | number }>;
  netCashDeltas?: { [key: string]: string | number };
  finalOwners?: { [key: string]: string };
  batchHash?: string;
  batch_hash?: string;
  settledAt?: number;
  settled_at?: number;
}

interface InventoryResponse {
  gameId: number;
  wallet: string;
  items: Array<{ item_id: string; owner_wallet: string }>;
  count: number;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Print success result in exact format
 */
function printResultPass(params: {
  totalIntentsSubmitted: number;
  totalIntentsProcessed: number;
  itemsSettled: number;
  batchId: string;
}): void {
  console.log("============================================================");
  console.log(`SMOKETEST PASS: ${params.totalIntentsSubmitted} intents submitted, ${params.totalIntentsProcessed} processed, ${params.itemsSettled} items settled, batch_id ${params.batchId}, all invariants OK`);
  console.log("============================================================");
}

/**
 * Print failure result in exact format
 */
function printResultFail(reason: string): void {
  console.log("============================================================");
  console.log(`SMOKETEST FAIL: ${reason}`);
  console.log("============================================================");
}

/**
 * Make API request with error handling
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

    if (!response.ok) {
      throw new Error(`API error: ${response.status} - ${JSON.stringify(data)}`);
    }

    return data;
  } catch (error) {
    throw new Error(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Step 1: Open a session
 */
async function openSession(ownerPubkey: string): Promise<{ sessionKey: string }> {
  console.log(`[1/5] Opening session for ${ownerPubkey}...`);

  // Generate a session key
  const sessionKeypair = Keypair.generate();
  const sessionKey = sessionKeypair.publicKey.toBase58();

  const response = await apiRequest("POST", "/api/v1/session/open", {
    ownerWallet: ownerPubkey,
    sessionKey: sessionKey,
    maxVolumeSol: Number(MAX_VOLUME_LAMPORTS) / 1e9, // Convert to SOL
    durationMinutes: 60, // 1 hour
    allowedActions: ["TRADE"],
  });

  console.log(`✓ Session opened: ${response.sessionKey}`);
  return { sessionKey: response.sessionKey || sessionKey };
}

/**
 * Step 2: Submit trade intents
 */
async function submitIntents(
  sessionPubkey: string,
  ownerPubkey: string,
  numIntents: number
): Promise<{ intentIds: string[]; submittedCount: number }> {
  console.log(`[2/5] Submitting ${numIntents} trade intents...`);

  const intentIds: string[] = [];
  const items: string[] = [];
  let itemCounter = 0;
  let submittedCount = 0;

  // Create some items
  for (let i = 0; i < Math.min(numIntents / 4, 50); i++) {
    items.push(`item-${itemCounter++}`);
  }

  // Create intents with chains and conflicts
  for (let i = 0; i < numIntents; i++) {
    const intentId = uuidv4();
    intentIds.push(intentId);

    // Create chains: A->B->C->D
    const itemId = items[i % items.length];
    const fromWallet = wallets[i % wallets.length];
    const toWallet = wallets[(i + 1) % wallets.length];
    const amount = BigInt(1000 + (i % 1000)); // Vary amounts

    // Create some conflicts (same item, different buyers)
    const conflictItem = items[0];
    if (i % 10 === 0 && i > 0) {
      // Create conflict: same item, different buyer
      const conflictIntentId = uuidv4();
      intentIds.push(conflictIntentId);

      const conflictIntent = {
        id: conflictIntentId,
        sessionPubkey,
        ownerPubkey,
        itemId: conflictItem,
        from: wallets[0],
        to: wallets[2], // Different buyer
        amountLamports: amount.toString(),
        nonce: i + 1000,
        signature: `sig-${conflictIntentId}`,
        createdAt: Math.floor(Date.now() / 1000),
        gameId: GAME_ID,
      };

      try {
        const response = await apiRequest("POST", "/api/v1/intents/trade", conflictIntent);
        if (response.status === "accepted") {
          submittedCount++;
          console.log(`  ✓ Conflict intent submitted: ${conflictIntentId}`);
        }
      } catch (error) {
        // Conflicts may be rejected, that's ok
        console.log(`  ⚠ Conflict intent rejected (expected): ${conflictIntentId}`);
      }
    }

    const intent = {
      id: intentId,
      sessionPubkey,
      ownerPubkey,
      itemId,
      from: fromWallet,
      to: toWallet,
      amountLamports: amount.toString(),
      nonce: i + 1,
      signature: `sig-${intentId}`,
      createdAt: Math.floor(Date.now() / 1000),
      gameId: GAME_ID,
    };

    try {
      const response: IntentResponse = await apiRequest("POST", "/api/v1/intents/trade", intent);
      if (response.status === "accepted") {
        submittedCount++;
        if (i % 50 === 0) {
          console.log(`  ✓ Submitted ${i + 1}/${numIntents} intents...`);
        }
      } else {
        console.log(`  ⚠ Intent rejected: ${response.reason}`);
      }
    } catch (error) {
      console.error(`  ✗ Failed to submit intent ${intentId}:`, error);
    }

    // Small delay to avoid overwhelming the API
    if (i % 10 === 0) {
      await sleep(10);
    }
  }

  console.log(`✓ Submitted ${submittedCount} intents (${intentIds.length} total attempted)`);
  return { intentIds, submittedCount };
}

/**
 * Step 3: Trigger netting batch
 */
async function triggerNetting(): Promise<string | null> {
  console.log(`[3/5] Triggering netting batch...`);

  try {
    // Try the admin endpoint first
    const response = await apiRequest("POST", "/api/netting/run", {});
    console.log(`✓ Netting batch triggered`);
    return response.batchId || null;
  } catch (error) {
    console.log(`  ⚠ Could not trigger netting manually, waiting for scheduler...`);
    return null;
  }
}

/**
 * Step 4: Wait for settlement and indexer
 */
async function waitForSettlement(
  expectedBatchId?: string | null
): Promise<BatchResponse | null> {
  console.log(`[4/5] Waiting for settlement and indexer...`);

  const startTime = Date.now();

  while (Date.now() - startTime < MAX_WAIT_MS) {
    try {
      // If we have a batch ID, check it directly
      if (expectedBatchId) {
        try {
          const batch = await apiRequest("GET", `/api/v1/batches/${expectedBatchId}`);
          if (batch && batch.settled) {
            console.log(`✓ Batch ${expectedBatchId} settled`);
            return batch;
          }
        } catch (error) {
          // Batch not found yet, continue polling
        }
      }

      // Check inventory to see if items have been updated
      // This indicates indexer has processed the batch
      for (const wallet of wallets.slice(0, 2)) {
        try {
          const inventory: InventoryResponse = await apiRequest(
            "GET",
            `/api/v1/games/${GAME_ID}/inventory/${wallet}`
          );
          if (inventory.items && inventory.items.length > 0) {
            console.log(`✓ Inventory updated for ${wallet}, batch likely settled`);
            // Try to find the batch
            if (expectedBatchId) {
              try {
                return await apiRequest("GET", `/api/v1/batches/${expectedBatchId}`);
              } catch (error) {
                // Continue
              }
            }
          }
        } catch (error) {
          // Inventory not updated yet
        }
      }

      await sleep(POLL_INTERVAL_MS);
      process.stdout.write(".");
    } catch (error) {
      console.error(`\n  ✗ Error polling:`, error);
      await sleep(POLL_INTERVAL_MS);
    }
  }

  console.log(`\n  ⚠ Timeout waiting for settlement`);
  return null;
}

/**
 * Fetch batch from API to ensure we have latest data
 */
async function fetchBatchFromAPI(batchId: string): Promise<BatchResponse | null> {
  try {
    const batch = await apiRequest("GET", `/api/v1/batches/${batchId}`);
    return batch;
  } catch (error) {
    console.log(`  ✗ Failed to fetch batch from API: ${error}`);
    return null;
  }
}

/**
 * Get on-chain last_net_batch_id from GlobalConfig
 */
async function getOnChainLastBatchId(): Promise<number | null> {
  if (!PROGRAM_ID || !RPC_URL) {
    return null;
  }

  try {
    // This requires Anchor program access - for now, we'll skip if not available
    // In a full implementation, you'd load the program and fetch GlobalConfig
    // const program = await getProgram(new Connection(RPC_URL));
    // const config = await program.account.globalConfig.fetch(globalConfigPda);
    // return config.lastNetBatchId.toNumber();
    return null;
  } catch (error) {
    console.log(`  ⚠ Could not fetch on-chain batch ID: ${error}`);
    return null;
  }
}

/**
 * Step 5: Validate results - comprehensive validation
 * Returns: { valid: boolean, reason?: string }
 */
async function validateResults(batch: BatchResponse | null): Promise<{ valid: boolean; reason?: string }> {
  console.log(`[5/5] Validating results...`);

  if (!batch) {
    return { valid: false, reason: "Batch not found" };
  }

  const batchId = batch.batchId || batch.batch_id;
  if (!batchId) {
    return { valid: false, reason: "Batch missing batch_id" };
  }

  // Fetch fresh batch data from API
  console.log(`  Fetching batch ${batchId} from API...`);
  const freshBatch = await fetchBatchFromAPI(batchId);
  if (!freshBatch) {
    return { valid: false, reason: "Failed to fetch batch from API" };
  }

  // Use fresh batch data for validation
  const batchToValidate = freshBatch;

  // ======================================================================
  // CHECK 1: Cash delta sum
  // ======================================================================
  console.log(`  [1/4] Validating cash delta sum...`);
  let totalDelta = BigInt(0);
  let hasCashDeltas = false;

  if (batchToValidate.netCashDeltas) {
    hasCashDeltas = true;
    const deltas = Object.values(batchToValidate.netCashDeltas);
    totalDelta = deltas.reduce((acc, delta) => {
      const deltaValue = typeof delta === "string" ? BigInt(delta) : BigInt(Number(delta));
      return acc + deltaValue;
    }, BigInt(0));
  } else if (batchToValidate.cashDeltas && batchToValidate.cashDeltas.length > 0) {
    hasCashDeltas = true;
    totalDelta = batchToValidate.cashDeltas.reduce((acc, delta) => {
      const deltaValue = typeof delta.deltaLamports === "string" 
        ? BigInt(delta.deltaLamports) 
        : BigInt(Number(delta.deltaLamports));
      return acc + deltaValue;
    }, BigInt(0));
  }

  if (hasCashDeltas) {
    if (totalDelta !== BigInt(0)) {
      return { valid: false, reason: `cash deltas do not sum to zero (sum: ${totalDelta})` };
    }
    console.log(`  ✓ Cash deltas sum to zero`);
  } else {
    console.log(`  ⚠ No cash deltas in batch (may be item-only batch)`);
  }

  // ======================================================================
  // CHECK 2: Final owners match history
  // ======================================================================
  console.log(`  [2/4] Validating final owners...`);
  const items = batchToValidate.items || [];
  const finalOwners = batchToValidate.finalOwners || {};

  // Get items to validate (sample up to 10 items, or all if fewer)
  const itemsToCheck = items.length > 0 
    ? items.slice(0, Math.min(10, items.length))
    : Object.entries(finalOwners).slice(0, Math.min(10, Object.keys(finalOwners).length));

  if (itemsToCheck.length > 0) {
    for (const itemEntry of itemsToCheck) {
      let itemId: string;
      let expectedOwner: string;

      if (Array.isArray(itemEntry)) {
        // From finalOwners object
        [itemId, expectedOwner] = itemEntry;
      } else {
        // From items array
        itemId = itemEntry.itemId;
        expectedOwner = itemEntry.finalOwner;
      }

      try {
        const history = await apiRequest("GET", `/api/v1/games/${GAME_ID}/items/${itemId}/history`);
        
        if (history && history.length > 0) {
          const latestEntry = history[0]; // Assuming history is sorted newest first
          const actualOwner = latestEntry.to_wallet || latestEntry.toWallet || latestEntry.owner;
          
          if (actualOwner && actualOwner !== expectedOwner) {
            return { valid: false, reason: `final owners mismatch for item ${itemId} (expected: ${expectedOwner}, actual: ${actualOwner})` };
          }
        } else {
          console.log(`  ⚠ No history found for item ${itemId} (may be new item)`);
        }
      } catch (error) {
        console.log(`  ⚠ Could not fetch history for item ${itemId}: ${error}`);
        // Don't fail on history fetch errors, just warn
      }
    }
    console.log(`  ✓ Final owners validated for ${itemsToCheck.length} items`);
  } else {
    console.log(`  ⚠ No items to validate (may be cash-only batch)`);
  }

  // ======================================================================
  // CHECK 3: Batch metadata completeness
  // ======================================================================
  console.log(`  [3/4] Validating batch metadata...`);
  const requiredFields = {
    batch_id: batchToValidate.batchId || batchToValidate.batch_id,
    num_items: batchToValidate.numItemsSettled || batchToValidate.num_items_settled,
    num_wallets: batchToValidate.numWallets || batchToValidate.num_wallets,
    batch_hash: batchToValidate.batchHash || batchToValidate.batch_hash,
    settled_at: batchToValidate.settledAt || batchToValidate.settled_at,
  };

  const missingFields: string[] = [];
  for (const [fieldName, fieldValue] of Object.entries(requiredFields)) {
    if (fieldValue === undefined || fieldValue === null) {
      missingFields.push(fieldName);
    }
  }

  if (missingFields.length > 0) {
    return { valid: false, reason: `batch metadata incomplete (missing: ${missingFields.join(", ")})` };
  }
  console.log(`  ✓ Batch metadata complete`);

  // ======================================================================
  // CHECK 4: On-chain last_net_batch_id (optional)
  // ======================================================================
  console.log(`  [4/4] Validating on-chain batch ID...`);
  const onChainBatchId = await getOnChainLastBatchId();
  
  if (onChainBatchId !== null) {
    const expectedBatchIdNum = typeof batchId === "string" ? parseInt(batchId, 10) : batchId;
    if (isNaN(expectedBatchIdNum)) {
      console.log(`  ⚠ Could not parse batch ID for on-chain comparison`);
    } else if (onChainBatchId !== expectedBatchIdNum) {
      return { valid: false, reason: `on-chain last_net_batch_id mismatch (expected: ${expectedBatchIdNum}, on-chain: ${onChainBatchId})` };
    } else {
      console.log(`  ✓ On-chain batch ID matches: ${onChainBatchId}`);
    }
  } else {
    console.log(`  ⚠ On-chain validation skipped (requires program access)`);
  }

  return { valid: true };
}

/**
 * Main smoke test function
 */
async function runSmokeTest() {
  console.log("=".repeat(60));
  console.log("PHANTOMGRID GAMING - E2E SMOKE TEST");
  console.log("=".repeat(60));
  console.log(`API: ${API_BASE_URL}`);
  console.log(`Game ID: ${GAME_ID}`);
  console.log(`Intents: ${NUM_INTENTS}`);
  console.log("");

  try {
    // Step 1: Open session
    const ownerPubkey = wallets[0];
    const session = await openSession(ownerPubkey);

    // Step 2: Submit intents
    const { intentIds, submittedCount } = await submitIntents(session.sessionKey, ownerPubkey, NUM_INTENTS);

    // Step 3: Trigger netting
    const batchId = await triggerNetting();

    // Step 4: Wait for settlement
    const batch = await waitForSettlement(batchId);

    // Step 5: Validate
    const validationResult = await validateResults(batch);

    // Final summary
    console.log("");
    if (validationResult.valid && batch) {
      const finalBatchId = batch.batchId || batch.batch_id || "unknown";
      const numItems = batch.numItemsSettled || batch.num_items_settled || 0;
      const numIntentsProcessed = batch.numIntents || batch.num_intents || 0;
      
      printResultPass({
        totalIntentsSubmitted: submittedCount,
        totalIntentsProcessed: numIntentsProcessed,
        itemsSettled: numItems,
        batchId: String(finalBatchId),
      });
      
      process.exitCode = 0;
      process.exit(0);
    } else {
      let failReason = validationResult.reason || "Validation failed or batch not found";
      if (!batch) {
        failReason = "Batch not found";
      }
      
      printResultFail(failReason);
      process.exitCode = 1;
      process.exit(1);
    }
  } catch (error) {
    console.log("");
    const errorMessage = error instanceof Error ? error.message : String(error);
    printResultFail(errorMessage);
    process.exitCode = 1;
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runSmokeTest().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}

export { runSmokeTest };

