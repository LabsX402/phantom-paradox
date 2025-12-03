/**
 * ======================================================================
 * PROOF DEVNET - Generate Markdown proof for latest settled batch
 * ======================================================================
 * 
 * Reads the database and generates a Markdown proof file for the latest
 * large devnet batch settlement.
 * 
 * Usage:
 *   npm run proof:devnet
 *   npm run proof:devnet -- --minIntents 10000
 */

import "dotenv/config";
import { query, initDatabase } from "../shared/db";
import { logger } from "../shared/logger";
import * as fs from "fs";
import * as path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

interface BatchRow {
  batch_id: string;
  num_intents: number;
  num_items_settled: number;
  num_wallets: number;
  settled: boolean;
  tx_signature: string | null;
  created_at: Date;
  netted_at: Date | null;
}

async function main() {
  try {
    // Parse CLI args
    const argv = await yargs(hideBin(process.argv))
      .option("minIntents", {
        type: "number",
        default: 1000,
        description: "Minimum number of intents required",
      })
      .parse();

    const minIntents = argv.minIntents;

    // Connect to DB
    await initDatabase();
    logger.info(`[PROOF] Connected to database, searching for batches with >= ${minIntents} intents`);

    // Query the latest settled batch
    const result = await query(
      `SELECT batch_id,
              num_intents,
              num_items_settled,
              num_wallets,
              settled,
              tx_signature,
              created_at,
              netted_at
       FROM netting_batches
       WHERE settled = true
         AND num_intents >= $1
       ORDER BY netted_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [minIntents]
    );

    if (result.rows.length === 0) {
      console.error(`❌ No settled batch found with >= ${minIntents} intents`);
      console.error("   Make sure you've run a battle test and let it settle on-chain.");
      process.exit(1);
    }

    const batch: BatchRow = result.rows[0];
    logger.info(`[PROOF] Found batch: ${batch.batch_id} with ${batch.num_intents} intents`);

    // Calculate compression ratio
    const compressionRatio =
      batch.num_items_settled > 0
        ? (batch.num_intents / batch.num_items_settled).toFixed(2)
        : "N/A";

    // Format dates
    const createdAt = new Date(batch.created_at).toISOString();
    const settledAt = batch.netted_at
      ? new Date(batch.netted_at).toISOString()
      : createdAt;

    // Get program ID from env or use default
    const programId =
      process.env.PHANTOMGRID_PROGRAM_ID ||
      "8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x";

    // Build Markdown
    const markdown = `# PhantomGrid Wraith – Devnet Proof

## Batch Summary

- **Batch ID:** ${batch.batch_id}
- **Devnet Program ID:** ${programId}
- **Intents:** ${batch.num_intents.toLocaleString()}
- **Items Settled:** ${batch.num_items_settled.toLocaleString()}
- **Compression:** ${compressionRatio}x
- **Wallets:** ${batch.num_wallets > 0 ? batch.num_wallets.toLocaleString() : "N/A"}
- **Created At:** ${createdAt}
- **Settled At:** ${settledAt}

## On-Chain Settlement

- **Tx Signature:** \`${batch.tx_signature || "N/A"}\`
- [View on Solscan](https://solscan.io/tx/${batch.tx_signature || ""}?cluster=devnet)

## Notes

- Netting profile: WRAITH (fast O(N) netting + compressed settlement).
- This proof was generated directly from the PhantomGrid Wraith database on devnet.
`;

    // Write to file
    const outputPath = path.join(process.cwd(), "..", "PROOF_DEVNET_10K.md");
    fs.writeFileSync(outputPath, markdown, "utf-8");

    console.log(`✅ Proof written to ${outputPath}`);
    console.log(`   Batch: ${batch.batch_id}`);
    console.log(`   Intents: ${batch.num_intents.toLocaleString()}`);
    console.log(`   Items: ${batch.num_items_settled.toLocaleString()}`);
    console.log(`   Compression: ${compressionRatio}x`);
    if (batch.tx_signature) {
      console.log(`   TX: ${batch.tx_signature}`);
    }

    process.exit(0);
  } catch (error) {
    logger.error("[PROOF] Error generating proof", {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error("❌ Failed to generate proof:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

