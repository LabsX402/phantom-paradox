/**
 * PROOF: 1000+ Actions Per TX
 * 
 * This script proves that PhantomGrid Gaming can batch 1,000+ player actions
 * into a single on-chain settlement transaction.
 * 
 * Usage:
 *   npx ts-node src/scripts/proof1000Actions.ts [session_id]
 * 
 * If no session_id is provided, uses the latest session with the most intents.
 */

import dotenv from "dotenv";
dotenv.config();

import { query, initDatabase } from "../shared/db";
import { writeFileSync } from "fs";
import { join } from "path";

const DEVNET_EXPLORER = "https://solscan.io/tx";

interface BatchProof {
  batchId: string;
  totalIntents: number;
  settled: boolean;
  txSignature: string | null;
  createdAt: string;
  numItemsSettled: number;
  numWallets: number;
}

interface SessionProof {
  sessionId: string;
  totalIntents: number;
  totalBatches: number;
  batches: BatchProof[];
  proofBatch: BatchProof | null;
}

async function getLatestSession(): Promise<string | null> {
  const result = await query(`
    SELECT session_pubkey, COUNT(*) as intent_count
    FROM trade_intents
    GROUP BY session_pubkey
    ORDER BY intent_count DESC
    LIMIT 1
  `);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0].session_pubkey;
}

async function getSessionProof(sessionId: string): Promise<SessionProof> {
  // Get total intents for this session
  const intentsResult = await query(`
    SELECT COUNT(*) as count
    FROM trade_intents
    WHERE session_pubkey = $1
  `, [sessionId]);
  
  const totalIntents = parseInt(intentsResult.rows[0].count);
  
  // Get all batches that contain intents from this session
  // We need to check which batches have intents from this session
  const batchesResult = await query(`
    SELECT 
      b.batch_id,
      b.created_at,
      b.settled,
      b.tx_signature,
      b.num_intents,
      b.num_items_settled,
      b.num_wallets
    FROM netting_batches b
    WHERE EXISTS (
      SELECT 1
      FROM trade_intents ti
      WHERE ti.session_pubkey = $1
        AND (b.intent_ids::jsonb ? ti.id OR b.intent_ids::jsonb @> jsonb_build_array(ti.id))
    )
    ORDER BY b.created_at DESC
  `, [sessionId]);
  
  // Alternative: if intent_ids doesn't work, get batches by matching intent timestamps
  // For now, let's try a simpler approach - get all batches and check their intent_ids
  const allBatchesResult = await query(`
    SELECT 
      batch_id,
      created_at,
      settled,
      tx_signature,
      num_intents,
      num_items_settled,
      num_wallets,
      intent_ids
    FROM netting_batches
    ORDER BY created_at DESC
    LIMIT 100
  `);
  
  // Get all intent IDs for this session
  const sessionIntentsResult = await query(`
    SELECT id
    FROM trade_intents
    WHERE session_pubkey = $1
  `, [sessionId]);
  
  const sessionIntentIds = new Set(sessionIntentsResult.rows.map((r: any) => r.id));
  
  // Filter batches that contain intents from this session
  const batches: BatchProof[] = [];
  for (const row of allBatchesResult.rows) {
    if (!row.intent_ids) continue;
    
    const intentIds = Array.isArray(row.intent_ids) 
      ? row.intent_ids 
      : JSON.parse(row.intent_ids);
    
    // Check if any intent in this batch belongs to our session
    const hasSessionIntent = intentIds.some((id: string) => sessionIntentIds.has(id));
    
    if (hasSessionIntent) {
      batches.push({
        batchId: row.batch_id,
        totalIntents: row.num_intents || 0,
        settled: row.settled || false,
        txSignature: row.tx_signature || null,
        createdAt: row.created_at,
        numItemsSettled: row.num_items_settled || 0,
        numWallets: row.num_wallets || 0,
      });
    }
  }
  
  // Find the proof batch (≥1000 intents + settled + has tx signature)
  const proofBatch = batches.find(
    (b) => b.totalIntents >= 1000 && b.settled && b.txSignature !== null
  ) || null;
  
  return {
    sessionId,
    totalIntents,
    totalBatches: batches.length,
    batches,
    proofBatch,
  };
}

async function printProof(proof: SessionProof) {
  console.log("\n" + "=".repeat(80));
  console.log("PROOF: 1000+ Actions Per TX - PhantomGrid Gaming");
  console.log("=".repeat(80));
  console.log();
  
  console.log(`Session ID: ${proof.sessionId}`);
  console.log(`Total Intents: ${proof.totalIntents.toLocaleString()}`);
  console.log(`Total Batches: ${proof.totalBatches}`);
  console.log();
  
  console.log("Batch Breakdown:");
  console.log("-".repeat(80));
  
  let maxBatchSize = 0;
  for (const batch of proof.batches) {
    const size = batch.totalIntents;
    maxBatchSize = Math.max(maxBatchSize, size);
    
    const status = batch.settled 
      ? (batch.txSignature ? "✅ SETTLED" : "⚠️  SETTLED (no tx)") 
      : "⏳ PENDING";
    
    console.log(`  Batch: ${batch.batchId.substring(0, 8)}...`);
    console.log(`    Intents: ${size.toLocaleString()}`);
    console.log(`    Status: ${status}`);
    if (batch.txSignature) {
      console.log(`    TX: ${DEVNET_EXPLORER}/${batch.txSignature}`);
    }
    console.log(`    Items: ${batch.numItemsSettled.toLocaleString()}`);
    console.log(`    Wallets: ${batch.numWallets.toLocaleString()}`);
    console.log();
  }
  
  console.log("-".repeat(80));
  console.log(`Max Batch Size: ${maxBatchSize.toLocaleString()} intents`);
  console.log();
  
  if (proof.proofBatch) {
    console.log("🎯 PROOF BATCH FOUND:");
    console.log("=".repeat(80));
    console.log(`  Batch ID: ${proof.proofBatch.batchId}`);
    console.log(`  Intents: ${proof.proofBatch.totalIntents.toLocaleString()}`);
    console.log(`  Status: ✅ SETTLED ON-CHAIN`);
    console.log(`  Transaction: ${DEVNET_EXPLORER}/${proof.proofBatch.txSignature}`);
    console.log(`  Items Settled: ${proof.proofBatch.numItemsSettled.toLocaleString()}`);
    console.log(`  Wallets Affected: ${proof.proofBatch.numWallets.toLocaleString()}`);
    console.log();
    console.log(`✅ PROOF: Batch ${proof.proofBatch.batchId.substring(0, 8)}... has ${proof.proofBatch.totalIntents.toLocaleString()} intents and was settled in tx ${proof.proofBatch.txSignature}`);
    console.log("=".repeat(80));
  } else {
    console.log("⚠️  NO PROOF BATCH FOUND");
    console.log("   Need a batch with:");
    console.log("   - ≥ 1,000 intents");
    console.log("   - settled = true");
    console.log("   - tx_signature IS NOT NULL");
    console.log();
    
    // Show closest matches
    const largeBatches = proof.batches
      .filter((b) => b.totalIntents >= 500)
      .sort((a, b) => b.totalIntents - a.totalIntents)
      .slice(0, 3);
    
    if (largeBatches.length > 0) {
      console.log("Closest matches:");
      for (const batch of largeBatches) {
        console.log(`  - Batch ${batch.batchId.substring(0, 8)}...: ${batch.totalIntents} intents, settled=${batch.settled}, tx=${batch.txSignature ? "yes" : "no"}`);
      }
    }
  }
  
  console.log();
}

async function generateMarkdown(proof: SessionProof): Promise<void> {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  
  let markdown = `# PROOF: 1000+ Actions Per TX - PhantomGrid Gaming

**Date:** ${dateStr}  
**Status:** ${proof.proofBatch ? "✅ PROOF COMPLETE" : "⚠️  PROOF INCOMPLETE"}  
**Cluster:** Devnet

## Summary

This document proves that **PhantomGrid Gaming can batch 1,000+ player actions/intents into a single on-chain settlement transaction**.

## Test Run Details

### Session Information
- **Session ID:** \`${proof.sessionId}\`
- **Total Intents Submitted:** ${proof.totalIntents.toLocaleString()}
- **Total Batches Created:** ${proof.totalBatches}
- **Max Batch Size:** ${proof.batches.length > 0 ? Math.max(...proof.batches.map(b => b.totalIntents)).toLocaleString() : 0} intents

`;

  if (proof.proofBatch) {
    markdown += `### Proof Batch

**Batch ID:** \`${proof.proofBatch.batchId}\`  
**Intents:** ${proof.proofBatch.totalIntents.toLocaleString()}  
**Status:** ✅ SETTLED ON-CHAIN  
**Transaction Signature:** \`${proof.proofBatch.txSignature}\`  
**Devnet Explorer:** https://solscan.io/tx/${proof.proofBatch.txSignature}

**Items Settled:** ${proof.proofBatch.numItemsSettled.toLocaleString()}  
**Wallets Affected:** ${proof.proofBatch.numWallets.toLocaleString()}

`;
  } else {
    markdown += `### Proof Batch

⚠️ **NO PROOF BATCH FOUND**

Need a batch with:
- ≥ 1,000 intents
- settled = true
- tx_signature IS NOT NULL

`;
  }

  markdown += `## Batch Breakdown

| Batch ID | Intents | Status | TX Signature |
|----------|---------|--------|--------------|
`;

  for (const batch of proof.batches) {
    const status = batch.settled 
      ? (batch.txSignature ? "✅ SETTLED" : "⚠️ SETTLED (no tx)") 
      : "⏳ PENDING";
    const txLink = batch.txSignature 
      ? `[${batch.txSignature.substring(0, 8)}...](https://solscan.io/tx/${batch.txSignature})`
      : "N/A";
    
    markdown += `| \`${batch.batchId.substring(0, 16)}...\` | ${batch.totalIntents.toLocaleString()} | ${status} | ${txLink} |\n`;
  }

  markdown += `
## Verification

`;

  if (proof.proofBatch) {
    markdown += `### On-Chain Verification
1. Transaction: https://solscan.io/tx/${proof.proofBatch.txSignature}
2. Program: \`8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x\`
3. Instruction: \`settle_net_batch\`

### Database Verification
- **Table:** \`netting_batches\`
- **Batch ID:** \`${proof.proofBatch.batchId}\`
- **Query:**
  \`\`\`sql
  SELECT batch_id, num_intents, settled, tx_signature
  FROM netting_batches
  WHERE batch_id = '${proof.proofBatch.batchId}';
  \`\`\`

## Conclusion

✅ **PROOF COMPLETE:** Batch \`${proof.proofBatch.batchId.substring(0, 16)}...\` contains **${proof.proofBatch.totalIntents.toLocaleString()} intents** and was settled in a **single on-chain transaction** \`${proof.proofBatch.txSignature}\`.

This demonstrates that PhantomGrid Gaming's off-chain netting engine can:
- Process 1,000+ player actions off-chain
- Batch them into a single settlement
- Settle all actions in one on-chain transaction
- Achieve massive cost savings (1,000+ actions → 1 transaction)
`;
  } else {
    markdown += `⚠️ **PROOF INCOMPLETE**

No batch found with:
- ≥ 1,000 intents
- settled = true
- tx_signature IS NOT NULL

Please ensure:
1. Load test completed successfully
2. On-chain settlement is enabled (\`ENABLE_ONCHAIN_SETTLEMENT=true\`)
3. Netting engine is running and processing batches
4. Server authority has sufficient SOL for transactions
`;
  }

  markdown += `
---

**Generated by:** \`npx ts-node src/scripts/proof1000Actions.ts\`
**Session:** \`${proof.sessionId}\`
`;

  const markdownPath = join(process.cwd(), "PROOF_1000ACTIONS_PER_TX.md");
  writeFileSync(markdownPath, markdown);
  console.log(`\n📄 Proof markdown saved to: ${markdownPath}`);
}

async function main() {
  try {
    await initDatabase();
    
    const sessionId = process.argv[2] || await getLatestSession();
    
    if (!sessionId) {
      console.error("❌ No sessions found in database");
      console.error("   Run a load test first to generate intents");
      process.exit(1);
    }
    
    console.log(`Analyzing session: ${sessionId}...`);
    
    const proof = await getSessionProof(sessionId);
    await printProof(proof);
    await generateMarkdown(proof);
    
    process.exit(proof.proofBatch ? 0 : 1);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();

