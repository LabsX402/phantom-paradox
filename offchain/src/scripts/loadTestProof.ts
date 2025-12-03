/**
 * Load Test for PROOF: 1000+ Actions Per TX
 * 
 * This script generates 1,500-2,000 intents in a SINGLE session
 * to prove that PhantomGrid can batch 1,000+ actions into one settlement tx.
 * 
 * Requirements:
 *   - ENABLE_ONCHAIN_SETTLEMENT=true
 *   - SOLANA_RPC_URL=https://api.devnet.solana.com
 *   - PHANTOMGRID_PROGRAM_ID=<devnet program id>
 *   - SERVER_AUTHORITY_SECRET_KEY=<server authority key>
 *   - API + netting services running
 * 
 * Usage:
 *   npx ts-node src/scripts/loadTestProof.ts [--intents 2000]
 */

import dotenv from "dotenv";
dotenv.config();

// Use node-fetch if available, otherwise use built-in fetch (Node 18+)
let fetch: any;
try {
  fetch = require("node-fetch");
} catch {
  fetch = globalThis.fetch;
}

import { Keypair } from "@solana/web3.js";
import { v4 as uuidv4 } from "uuid";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// Parse CLI arguments
const argv = yargs(hideBin(process.argv))
  .option("intents", {
    type: "number",
    description: "Number of intents to submit (default: 2000)",
    default: 2000,
  })
  .option("concurrency", {
    type: "number",
    description: "Number of parallel requests (default: 100)",
    default: 100,
  })
  .parseSync();

const NUM_INTENTS = (argv.intents as number) || 2000;
const CONCURRENCY = ((argv as any).concurrency as number) || 100;

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";
const API_KEY = process.env.API_KEY || "test-api-key-123";
const GAME_ID = process.env.GAME_ID || "test-game";

// CRITICAL: Single session for all intents
const SESSION_KEYPAIR = Keypair.generate();
const SESSION_PUBKEY = SESSION_KEYPAIR.publicKey.toBase58();
const OWNER_PUBKEY = Keypair.generate().publicKey.toBase58();

console.log("=".repeat(80));
console.log("PROOF LOAD TEST: 1000+ Actions Per TX");
console.log("=".repeat(80));
console.log();
console.log(`Session: ${SESSION_PUBKEY}`);
console.log(`Target Intents: ${NUM_INTENTS.toLocaleString()}`);
console.log(`Concurrency: ${CONCURRENCY}`);
console.log();

// Verify environment
const ENABLE_ONCHAIN = process.env.ENABLE_ONCHAIN_SETTLEMENT === "true";
const PROGRAM_ID = process.env.PHANTOMGRID_PROGRAM_ID;
const RPC_URL = process.env.SOLANA_RPC_URL;

if (!ENABLE_ONCHAIN) {
  console.warn("⚠️  WARNING: ENABLE_ONCHAIN_SETTLEMENT is not 'true'");
  console.warn("   Settlement will not happen on-chain!");
}

if (!PROGRAM_ID) {
  console.warn("⚠️  WARNING: PHANTOMGRID_PROGRAM_ID not set");
}

if (!RPC_URL || !RPC_URL.includes("devnet")) {
  console.warn("⚠️  WARNING: SOLANA_RPC_URL doesn't look like devnet");
}

console.log(`On-chain Settlement: ${ENABLE_ONCHAIN ? "✅ ENABLED" : "❌ DISABLED"}`);
console.log(`Program ID: ${PROGRAM_ID || "NOT SET"}`);
console.log(`RPC URL: ${RPC_URL || "NOT SET"}`);
console.log();

// Generate test data
const wallets: string[] = [];
for (let i = 0; i < 50; i++) {
  wallets.push(Keypair.generate().publicKey.toBase58());
}

const items: string[] = [];
for (let i = 0; i < 200; i++) {
  items.push(`item-${i}`);
}

// Generate intents as CHAINS (A->B, B->C, C->D) to avoid double-spends
// This allows the conflict resolver to pass all intents (only rejects actual double-spends)
function generateIntents(numIntents: number): any[] {
  const intents: any[] = [];
  
  // Create chains: For each item, create a chain of trades
  // Item1: Wallet0->Wallet1, Wallet1->Wallet2, Wallet2->Wallet3, etc.
  // This ensures no double-spends (each seller only sells each item once)
  
  let intentCount = 0;
  const NUM_ITEMS = Math.min(50, items.length); // Use fewer items to create longer chains
  
  for (let itemIdx = 0; itemIdx < NUM_ITEMS && intentCount < numIntents; itemIdx++) {
    const item = items[itemIdx];
    
    // Create a chain for this item: A->B, B->C, C->D...
    for (let w = 0; w < wallets.length - 1 && intentCount < numIntents; w++) {
      const fromWallet = wallets[w];
      const toWallet = wallets[w + 1];
      const amount = Math.floor(Math.random() * 10_000_000) + 1_000_000; // 0.001-0.01 SOL
      
      const intentId = `intent-${intentCount}-${Date.now()}`;
      intents.push({
        id: intentId,
        sessionPubkey: SESSION_PUBKEY,
        ownerPubkey: OWNER_PUBKEY,
        itemId: item,
        from: fromWallet,
        to: toWallet,
        amountLamports: amount.toString(),
        nonce: intentCount,
        signature: `sig-${intentId}`,
        createdAt: Math.floor(Date.now() / 1000),
        gameId: GAME_ID,
      });
      intentCount++;
    }
  }
  
  // If we need more intents, create additional chains with different items
  while (intentCount < numIntents) {
    const item = items[intentCount % items.length];
    const fromIdx = intentCount % (wallets.length - 1);
    const toIdx = (fromIdx + 1) % wallets.length;
    
    const fromWallet = wallets[fromIdx];
    const toWallet = wallets[toIdx];
    const amount = Math.floor(Math.random() * 10_000_000) + 1_000_000;
    
    const intentId = `intent-${intentCount}-${Date.now()}`;
    intents.push({
      id: intentId,
      sessionPubkey: SESSION_PUBKEY,
      ownerPubkey: OWNER_PUBKEY,
      itemId: item,
      from: fromWallet,
      to: toWallet,
      amountLamports: amount.toString(),
      nonce: intentCount,
      signature: `sig-${intentId}`,
      createdAt: Math.floor(Date.now() / 1000),
      gameId: GAME_ID,
    });
    intentCount++;
  }
  
  return intents;
}

// Submit intents in parallel batches
async function submitIntents(intents: any[]): Promise<{ submitted: number; failed: number }> {
  let submitted = 0;
  let failed = 0;
  
  const batches: any[][] = [];
  for (let i = 0; i < intents.length; i += CONCURRENCY) {
    batches.push(intents.slice(i, i + CONCURRENCY));
  }
  
  console.log(`Submitting ${intents.length.toLocaleString()} intents in ${batches.length} batches...`);
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const promises = batch.map(async (intent) => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/v1/intents/trade`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
          },
          body: JSON.stringify(intent),
        });
        
        const data = await response.json();
        if (response.ok && data.status === "accepted") {
          submitted++;
          return true;
        } else {
          failed++;
          if (i < 3) console.log(`  Failed: ${data.reason || response.statusText}`);
          return false;
        }
      } catch (error) {
        failed++;
        return false;
      }
    });
    
    await Promise.all(promises);
    
    if ((i + 1) % 10 === 0 || i === batches.length - 1) {
      process.stdout.write(`\r  Progress: ${((i + 1) * CONCURRENCY).toLocaleString()}/${intents.length.toLocaleString()} (${submitted} submitted, ${failed} failed)`);
    }
  }
  
  console.log();
  return { submitted, failed };
}

// Wait for batches to settle
async function waitForSettlement(maxWaitMs: number = 300000): Promise<void> {
  console.log("\nWaiting for batches to settle...");
  console.log("(This may take a few minutes)");
  
  const startTime = Date.now();
  let lastPending = 0;
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const pending = await fetch(`${API_BASE_URL}/api/netting/pending`, {
        headers: { "x-api-key": API_KEY },
      }).then((r: any) => r.json()).catch(() => ({ pendingIntents: 0 }));
      
      const pendingCount = pending.pendingIntents || 0;
      
      if (pendingCount !== lastPending) {
        console.log(`  Pending intents: ${pendingCount.toLocaleString()}`);
        lastPending = pendingCount;
      }
      
      if (pendingCount === 0) {
        // Give it a bit more time for final settlement
        await new Promise((resolve) => setTimeout(resolve, 10000));
        break;
      }
      
      await new Promise((resolve) => setTimeout(resolve, 5000));
      process.stdout.write(".");
    } catch (error) {
      // Continue waiting
    }
  }
  
  console.log("\n");
}

async function openSession(): Promise<string> {
  console.log("Opening session...");
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/session/open`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify({
        ownerWallet: OWNER_PUBKEY,
        sessionKey: SESSION_PUBKEY,
        maxVolumeSol: 1000, // 1000 SOL max volume
        durationMinutes: 60, // 1 hour
        allowedActions: ["TRADE"],
      }),
    });
    
    const data = await response.json();
    if (response.ok) {
      console.log(`✓ Session opened: ${data.sessionKey || SESSION_PUBKEY}`);
      return data.sessionKey || SESSION_PUBKEY;
    } else {
      console.log(`⚠ Session response: ${JSON.stringify(data)}`);
      return SESSION_PUBKEY;
    }
  } catch (error) {
    console.log(`⚠ Could not open session: ${error}`);
    return SESSION_PUBKEY;
  }
}

async function main() {
  try {
    // Open session first
    await openSession();
    console.log();
    
    console.log("Generating intents...");
    const intents = generateIntents(NUM_INTENTS);
    console.log(`Generated ${intents.length.toLocaleString()} intents`);
    console.log();
    
    console.log("Submitting intents...");
    const { submitted, failed } = await submitIntents(intents);
    console.log();
    console.log(`✅ Submitted: ${submitted.toLocaleString()}`);
    if (failed > 0) {
      console.log(`❌ Failed: ${failed.toLocaleString()}`);
    }
    console.log();
    
    if (submitted < 1000) {
      console.warn("⚠️  WARNING: Less than 1,000 intents submitted");
      console.warn("   May not be able to prove 1000+ actions per tx");
    }
    
    console.log("Waiting for netting engine to process batches...");
    await waitForSettlement();
    
    console.log("=".repeat(80));
    console.log("✅ Load test complete!");
    console.log();
    console.log(`Session ID: ${SESSION_PUBKEY}`);
    console.log(`Intents submitted: ${submitted.toLocaleString()}`);
    console.log();
    console.log("Next steps:");
    console.log(`  1. Run: npx ts-node src/scripts/proof1000Actions.ts ${SESSION_PUBKEY}`);
    console.log("  2. This will show the proof with batch details and tx signatures");
    console.log("=".repeat(80));
    
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();

