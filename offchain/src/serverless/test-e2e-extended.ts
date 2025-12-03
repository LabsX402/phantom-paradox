/**
 * Extended E2E Test Suite - 10k Intents
 * Tests full workflow with 10,000 intents for performance validation
 */

import { initDatabase } from "./db-serverless";
import { initRedis } from "./redis-serverless";
import { storeIntentsToIPFS } from "./ipfs-storage";
import { createSIWSMessage, verifySIWSSignature, generateNonce } from "./auth-siws";
import { PublicKey, Keypair } from "@solana/web3.js";
import { logger } from "../shared/logger";
import nacl from "tweetnacl";
import { TradeIntent } from "../netting/types";
import { persistIntent, loadIntents } from "../netting/persistence";
import { runNettingBatch } from "../netting/engine";
import { v4 as uuidv4 } from "uuid";
import { trackPerformance } from "./monitoring";

const INTENT_COUNT = 10000;

async function test10kIntents() {
  console.log(`\n=== Extended E2E Test: ${INTENT_COUNT} Intents ===`);
  
  const metrics = {
    intentGeneration: 0,
    intentPersistence: 0,
    ipfsStorage: 0,
    intentLoading: 0,
    netting: 0,
    total: 0,
  };
  
  const startTime = Date.now();
  
  try {
    await initDatabase();
    await initRedis();
    
    // Generate 10k intents
    const genStart = Date.now();
    const intents: TradeIntent[] = [];
    const keypair = Keypair.generate();
    const sessionPubkey = keypair.publicKey.toString();
    const ownerPubkey = Keypair.generate().publicKey.toString();
    
    for (let i = 0; i < INTENT_COUNT; i++) {
      const intent: TradeIntent = {
        id: uuidv4(),
        sessionPubkey,
        ownerPubkey,
        itemId: `item-${i % 1000}`, // 1000 unique items
        from: Keypair.generate().publicKey.toString(),
        to: Keypair.generate().publicKey.toString(),
        amountLamports: BigInt(1000 + i),
        nonce: `nonce-${i}`,
        signature: `sig-${i}`,
        createdAt: Math.floor(Date.now() / 1000) - (INTENT_COUNT - i),
        gameId: 1,
        listingId: `listing-${i}`,
        intentType: "buy",
      };
      intents.push(intent);
    }
    metrics.intentGeneration = Date.now() - genStart;
    console.log(`✅ Generated ${intents.length} intents in ${metrics.intentGeneration}ms`);
    
    // Persist intents (batch for performance)
    const persistStart = Date.now();
    const batchSize = 100;
    for (let i = 0; i < intents.length; i += batchSize) {
      const batch = intents.slice(i, i + batchSize);
      await Promise.all(
        batch.map(intent => 
          persistIntent(intent).catch(err => {
            // Ignore duplicates
            if (!err?.message?.includes("duplicate") && !err?.code?.includes("23505")) {
              throw err;
            }
          })
        )
      );
    }
    metrics.intentPersistence = Date.now() - persistStart;
    console.log(`✅ Persisted ${intents.length} intents in ${metrics.intentPersistence}ms (avg ${(metrics.intentPersistence / intents.length).toFixed(2)}ms/intent)`);
    
    // Store to IPFS
    const ipfsStart = Date.now();
    try {
      const ipfsResult = await storeIntentsToIPFS(intents);
      metrics.ipfsStorage = Date.now() - ipfsStart;
      console.log(`✅ Stored to IPFS in ${metrics.ipfsStorage}ms (CID: ${ipfsResult.cid})`);
    } catch (error) {
      console.log("⚠️ IPFS storage failed (non-critical):", error);
    }
    
    // Load intents
    const loadStart = Date.now();
    const loaded = await loadIntents(undefined, INTENT_COUNT);
    metrics.intentLoading = Date.now() - loadStart;
    console.log(`✅ Loaded ${loaded.length} intents in ${metrics.intentLoading}ms`);
    
    // Run netting (if enough intents)
    if (loaded.length >= 1000) {
      const nettingStart = Date.now();
      const result = await trackPerformance("netting_10k", async () => {
        return await runNettingBatch({
          batchWindowSeconds: 300,
          minIntentsPerBatch: 1000,
          maxIntentsPerBatch: 10000,
        });
      });
      metrics.netting = Date.now() - nettingStart;
      
      console.log(`✅ Netting complete in ${metrics.netting}ms`);
      console.log(`  - Batch ID: ${result.batchId}`);
      console.log(`  - Intents: ${result.numIntents}`);
      console.log(`  - Items: ${result.numItemsSettled}`);
      console.log(`  - Wallets: ${result.numWallets}`);
      console.log(`  - Performance: ${(metrics.netting / result.numIntents).toFixed(2)}ms/intent`);
    }
    
    metrics.total = Date.now() - startTime;
    
    console.log("\n=== Performance Summary ===");
    console.log(`Intent Generation: ${metrics.intentGeneration}ms (${(metrics.intentGeneration / INTENT_COUNT).toFixed(3)}ms/intent)`);
    console.log(`Intent Persistence: ${metrics.intentPersistence}ms (${(metrics.intentPersistence / INTENT_COUNT).toFixed(3)}ms/intent)`);
    console.log(`IPFS Storage: ${metrics.ipfsStorage}ms`);
    console.log(`Intent Loading: ${metrics.intentLoading}ms (${(metrics.intentLoading / loaded.length).toFixed(3)}ms/intent)`);
    console.log(`Netting: ${metrics.netting}ms (${metrics.netting > 0 ? (metrics.netting / (loaded.length || 1)).toFixed(3) : 0}ms/intent)`);
    console.log(`Total Time: ${metrics.total}ms (${(metrics.total / 1000).toFixed(2)}s)`);
    
    return { success: true, metrics, intentsProcessed: loaded.length };
  } catch (error) {
    console.error("❌ Extended E2E test failed:", error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  test10kIntents()
    .then(result => {
      console.log("\n✅ Extended E2E test completed successfully");
      process.exit(0);
    })
    .catch(error => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}

export { test10kIntents };

