/**
 * Full Stack Workflow Test
 * Tests the complete end-to-end workflow
 */

import { initDatabase } from "./db-serverless";
import { initRedis } from "./redis-serverless";
import { storeIntentsToIPFS, retrieveIntentsFromIPFS } from "./ipfs-storage";
import { createSIWSMessage, verifySIWSSignature, generateNonce } from "./auth-siws";
import { getActiveProvider, executeWithFailover, getProviderStatus } from "./failover";
import { PublicKey, Keypair } from "@solana/web3.js";
import { logger } from "../shared/logger";
import nacl from "tweetnacl";

async function testDatabase() {
  console.log("\n=== Testing Database ===");
  try {
    const connected = await initDatabase();
    if (connected) {
      console.log("✅ Database connection successful");
      return true;
    } else {
      console.log("❌ Database connection failed");
      return false;
    }
  } catch (error) {
    console.log("❌ Database error:", error);
    return false;
  }
}

async function testRedis() {
  console.log("\n=== Testing Redis ===");
  try {
    const connected = await initRedis();
    if (connected) {
      console.log("✅ Redis connection successful");
      
      const { redisSet, redisGet, redisDel } = await import("./redis-serverless");
      await redisSet("test:key", "test:value", { EX: 60 });
      const value = await redisGet("test:key");
      await redisDel("test:key");
      
      if (value === "test:value") {
        console.log("✅ Redis operations successful");
        return true;
      } else {
        console.log("❌ Redis operations failed");
        return false;
      }
    } else {
      console.log("❌ Redis connection failed");
      return false;
    }
  } catch (error) {
    console.log("❌ Redis error:", error);
    return false;
  }
}

async function testIPFS() {
  console.log("\n=== Testing IPFS ===");
  try {
    const testIntents = [
      {
        id: "test-1",
        sessionPubkey: "test-session",
        ownerPubkey: "test-owner",
        itemId: "item-1",
        from: "wallet-1",
        to: "wallet-2",
        amountLamports: BigInt(1000),
        nonce: "nonce-1",
        signature: "sig-1",
        createdAt: Math.floor(Date.now() / 1000),
      },
    ];
    
    const result = await storeIntentsToIPFS(testIntents);
    console.log("✅ IPFS storage successful:", result.cid);
    
    const retrieved = await retrieveIntentsFromIPFS(result.cid);
    if (retrieved.length === testIntents.length) {
      console.log("✅ IPFS retrieval successful");
      return true;
    } else {
      console.log("❌ IPFS retrieval failed");
      return false;
    }
  } catch (error) {
    console.log("❌ IPFS error:", error);
    return false;
  }
}

async function testSIWS() {
  console.log("\n=== Testing SIWS Auth ===");
  try {
    const keypair = Keypair.generate();
    const domain = "test.example.com";
    const nonce = generateNonce();
    
    const message = createSIWSMessage({
      domain,
      address: keypair.publicKey.toString(),
      statement: "Test sign-in",
      uri: "https://test.example.com",
      nonce,
    });
    
    const messageString = JSON.stringify(message);
    const messageBytes = new TextEncoder().encode(messageString);
    const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
    
    const isValid = await verifySIWSSignature(
      message,
      signature,
      keypair.publicKey
    );
    
    if (isValid) {
      console.log("✅ SIWS verification successful");
      return true;
    } else {
      console.log("❌ SIWS verification failed");
      return false;
    }
  } catch (error) {
    console.log("❌ SIWS error:", error);
    return false;
  }
}

async function testFailover() {
  console.log("\n=== Testing Failover ===");
  try {
    const status = getProviderStatus();
    console.log("Provider status:", status);
    
    const provider = await getActiveProvider();
    console.log("Active provider:", provider.name);
    
    await executeWithFailover(async (p) => {
      console.log("Executing with provider:", p.name);
      return { success: true };
    });
    
    console.log("✅ Failover test successful");
    return true;
  } catch (error) {
    console.log("❌ Failover error:", error);
    return false;
  }
}

async function runFullWorkflowTest() {
  console.log("========================================");
  console.log("Full Stack Workflow Test");
  console.log("========================================\n");
  
  const results = {
    database: false,
    redis: false,
    ipfs: false,
    siws: false,
    failover: false,
  };
  
  results.database = await testDatabase();
  results.redis = await testRedis();
  results.ipfs = await testIPFS();
  results.siws = await testSIWS();
  results.failover = await testFailover();
  
  console.log("\n========================================");
  console.log("Test Results Summary");
  console.log("========================================");
  console.log(`Database: ${results.database ? "✅" : "❌"}`);
  console.log(`Redis: ${results.redis ? "✅" : "❌"}`);
  console.log(`IPFS: ${results.ipfs ? "✅" : "❌"}`);
  console.log(`SIWS: ${results.siws ? "✅" : "❌"}`);
  console.log(`Failover: ${results.failover ? "✅" : "❌"}`);
  
  const allPassed = Object.values(results).every(r => r);
  console.log(`\nOverall: ${allPassed ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}`);
  console.log("========================================\n");
  
  return allPassed;
}

// Run if called directly
if (require.main === module) {
  runFullWorkflowTest()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}

export { runFullWorkflowTest };

