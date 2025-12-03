/**
 * End-to-End Test Suite
 * Simulates full Phase 1-5 workflow with 1000 intents
 */

import { initDatabase } from "./db-serverless";
import { initRedis } from "./redis-serverless";
import { storeIntentsToIPFS, retrieveIntentsFromIPFS } from "./ipfs-storage";
import { createSIWSMessage, verifySIWSSignature, generateNonce } from "./auth-siws";
import { executeWithFailover } from "./failover";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { logger } from "../shared/logger";
import nacl from "tweetnacl";
import { TradeIntent } from "../netting/types";
import { persistIntent, loadIntents, persistBatch } from "../netting/persistence";
import { runNettingBatch } from "../netting/engine";
import { v4 as uuidv4 } from "uuid";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

async function testPhase1_Authentication() {
  console.log("\n=== Phase 1: Authentication & Session Setup ===");
  
  try {
    // Generate test keypair
    const keypair = Keypair.generate();
    const domain = "test.phantomgrid.com";
    const nonce = generateNonce();
    
    // Create SIWS message
    const message = createSIWSMessage({
      domain,
      address: keypair.publicKey.toString(),
      statement: "Test sign-in for Phantom Paradox Vault",
      uri: "https://test.phantomgrid.com",
      nonce,
      expirationTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour
    });
    
    // Sign message
    const messageString = JSON.stringify(message);
    const messageBytes = new TextEncoder().encode(messageString);
    const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
    
    // Verify signature
    const isValid = await verifySIWSSignature(message, signature, keypair.publicKey);
    
    if (!isValid) {
      throw new Error("SIWS verification failed");
    }
    
    console.log("✅ Phase 1: Authentication successful");
    return { keypair, message, signature };
  } catch (error) {
    console.log("❌ Phase 1 failed:", error);
    throw error;
  }
}

async function testPhase2_IntentSubmission(count: number = 1000) {
  console.log(`\n=== Phase 2: Intent Submission (${count} intents) ===`);
  
  try {
    await initDatabase();
    await initRedis();
    
    const intents: TradeIntent[] = [];
    const keypair = Keypair.generate();
    const sessionPubkey = keypair.publicKey.toString();
    const ownerPubkey = Keypair.generate().publicKey.toString();
    
    const startTime = Date.now();
    
    // Generate test intents
    for (let i = 0; i < count; i++) {
      const intent: TradeIntent = {
        id: uuidv4(),
        sessionPubkey,
        ownerPubkey,
        itemId: `item-${i % 100}`, // 100 unique items
        from: Keypair.generate().publicKey.toString(),
        to: Keypair.generate().publicKey.toString(),
        amountLamports: BigInt(1000 + i),
        nonce: `nonce-${i}`,
        signature: `sig-${i}`,
        createdAt: Math.floor(Date.now() / 1000) - (count - i), // Stagger timestamps
        gameId: 1,
        listingId: `listing-${i}`,
        intentType: "buy",
      };
      
      intents.push(intent);
    }
    
    console.log(`Generated ${intents.length} intents in ${Date.now() - startTime}ms`);
    
    // Persist intents
    const persistStart = Date.now();
    for (const intent of intents) {
      try {
        await persistIntent(intent);
      } catch (error: any) {
        // Ignore duplicate errors
        if (!error?.message?.includes("duplicate") && !error?.code?.includes("23505")) {
          throw error;
        }
      }
    }
    const persistTime = Date.now() - persistStart;
    console.log(`✅ Persisted ${intents.length} intents in ${persistTime}ms (avg ${persistTime / intents.length}ms/intent)`);
    
    // Store to IPFS
    const ipfsStart = Date.now();
    try {
      const ipfsResult = await storeIntentsToIPFS(intents);
      const ipfsTime = Date.now() - ipfsStart;
      console.log(`✅ Stored to IPFS in ${ipfsTime}ms (CID: ${ipfsResult.cid})`);
      
      // Retrieve from IPFS
      const retrieveStart = Date.now();
      const retrieved = await retrieveIntentsFromIPFS(ipfsResult.cid);
      const retrieveTime = Date.now() - retrieveStart;
      console.log(`✅ Retrieved from IPFS in ${retrieveTime}ms (${retrieved.length} intents)`);
    } catch (error) {
      console.log("⚠️ IPFS storage failed (non-critical):", error);
    }
    
    console.log("✅ Phase 2: Intent submission successful");
    return { intents, count: intents.length };
  } catch (error) {
    console.log("❌ Phase 2 failed:", error);
    throw error;
  }
}

async function testPhase3_NettingBatch() {
  console.log("\n=== Phase 3: Netting Batch Creation ===");
  
  try {
    const loadStart = Date.now();
    const intents = await loadIntents(undefined, 1000);
    const loadTime = Date.now() - loadStart;
    console.log(`Loaded ${intents.length} intents in ${loadTime}ms`);
    
    if (intents.length < 100) {
      console.log("⚠️ Not enough intents for meaningful test (need 100+, have " + intents.length + ")");
      return { skipped: true };
    }
    
    // Run netting batch
    const nettingStart = Date.now();
    const result = await runNettingBatch({
      batchWindowSeconds: 300,
      minIntentsPerBatch: 100, // Lower for testing
      maxIntentsPerBatch: 1000,
    });
    const nettingTime = Date.now() - nettingStart;
    
    console.log(`✅ Netting complete in ${nettingTime}ms`);
    console.log(`  - Batch ID: ${result.batchId}`);
    console.log(`  - Intents processed: ${result.numIntents}`);
    console.log(`  - Items settled: ${result.numItemsSettled}`);
    console.log(`  - Wallets affected: ${result.numWallets}`);
    console.log(`  - Performance: ${nettingTime}ms for ${result.numIntents} intents (${nettingTime / result.numIntents}ms/intent)`);
    
    console.log("✅ Phase 3: Netting batch successful");
    return { result, nettingTime };
  } catch (error: any) {
    if (error.message?.includes("Not enough intents")) {
      console.log("⚠️ Phase 3 skipped: Not enough intents");
      return { skipped: true };
    }
    console.log("❌ Phase 3 failed:", error);
    throw error;
  }
}

async function testPhase4_Settlement() {
  console.log("\n=== Phase 4: On-Chain Settlement (Mock) ===");
  
  try {
    // Mock settlement - in real test, would construct actual transaction
    const mockTx = {
      signature: "mock-signature-" + Date.now(),
      slot: 12345,
      confirmed: true,
    };
    
    console.log("✅ Phase 4: Settlement mock successful");
    console.log(`  - Mock TX: ${mockTx.signature}`);
    return { mockTx };
  } catch (error) {
    console.log("❌ Phase 4 failed:", error);
    throw error;
  }
}

async function testPhase5_EventProcessing() {
  console.log("\n=== Phase 5: Event Processing ===");
  
  try {
    // Mock event processing
    const mockEvent = {
      type: "NetBatchSettled",
      batchId: "test-batch-" + Date.now(),
      timestamp: new Date().toISOString(),
    };
    
    console.log("✅ Phase 5: Event processing mock successful");
    console.log(`  - Event: ${mockEvent.type}`);
    return { mockEvent };
  } catch (error) {
    console.log("❌ Phase 5 failed:", error);
    throw error;
  }
}

async function testColdStarts() {
  console.log("\n=== Cold Start Performance Test ===");
  
  const coldStartTimes: number[] = [];
  const iterations = 5;
  
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    
    // Simulate cold start (reinitialize connections)
    await initDatabase();
    await initRedis();
    
    const duration = Date.now() - start;
    coldStartTimes.push(duration);
    
    console.log(`  Iteration ${i + 1}: ${duration}ms`);
    
    // Wait between iterations
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  const avg = coldStartTimes.reduce((a, b) => a + b, 0) / coldStartTimes.length;
  const min = Math.min(...coldStartTimes);
  const max = Math.max(...coldStartTimes);
  
  console.log(`✅ Cold start metrics:`);
  console.log(`  - Average: ${avg.toFixed(2)}ms`);
  console.log(`  - Min: ${min}ms`);
  console.log(`  - Max: ${max}ms`);
  
  return { avg, min, max, times: coldStartTimes };
}

async function testFailover() {
  console.log("\n=== Failover System Test ===");
  
  try {
    // Test provider selection
    const provider = await executeWithFailover(async (p) => {
      console.log(`  Executing with provider: ${p.name}`);
      return { provider: p.name, success: true };
    });
    
    console.log(`✅ Failover test successful: ${provider.provider}`);
    return provider;
  } catch (error) {
    console.log("❌ Failover test failed:", error);
    throw error;
  }
}

async function runE2ETest() {
  console.log("========================================");
  console.log("End-to-End Workflow Test");
  console.log("========================================\n");
  
  const results: any = {
    phase1: null,
    phase2: null,
    phase3: null,
    phase4: null,
    phase5: null,
    coldStarts: null,
    failover: null,
  };
  
  const startTime = Date.now();
  
  try {
    // Phase 1: Authentication
    results.phase1 = await testPhase1_Authentication();
    
    // Phase 2: Intent Submission (1000 intents)
    results.phase2 = await testPhase2_IntentSubmission(1000);
    
    // Phase 3: Netting Batch
    results.phase3 = await testPhase3_NettingBatch();
    
    // Phase 4: Settlement (mock)
    results.phase4 = await testPhase4_Settlement();
    
    // Phase 5: Event Processing (mock)
    results.phase5 = await testPhase5_EventProcessing();
    
    // Cold Start Test
    results.coldStarts = await testColdStarts();
    
    // Failover Test
    results.failover = await testFailover();
    
    const totalTime = Date.now() - startTime;
    
    console.log("\n========================================");
    console.log("E2E Test Results Summary");
    console.log("========================================");
    console.log(`Phase 1 (Auth): ${results.phase1 ? "✅" : "❌"}`);
    console.log(`Phase 2 (Intents): ${results.phase2 ? `✅ ${results.phase2.count} intents` : "❌"}`);
    console.log(`Phase 3 (Netting): ${results.phase3?.skipped ? "⚠️ Skipped" : results.phase3 ? `✅ ${results.phase3.nettingTime}ms` : "❌"}`);
    console.log(`Phase 4 (Settlement): ${results.phase4 ? "✅" : "❌"}`);
    console.log(`Phase 5 (Events): ${results.phase5 ? "✅" : "❌"}`);
    console.log(`Cold Starts: ${results.coldStarts ? `✅ Avg ${results.coldStarts.avg.toFixed(2)}ms` : "❌"}`);
    console.log(`Failover: ${results.failover ? "✅" : "❌"}`);
    console.log(`\nTotal Time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
    console.log("========================================\n");
    
    return results;
  } catch (error) {
    console.error("Fatal error:", error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  runE2ETest()
    .then(results => {
      process.exit(0);
    })
    .catch(error => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}

export { runE2ETest };

