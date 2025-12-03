import "dotenv/config";
import { initDatabase } from "../shared/db";
import { runNettingBatch } from "../netting/engine";

async function main() {
  await initDatabase();
  
  try {
    const result = await runNettingBatch({
      // For proof runs we don't really care about the window
      batchWindowSeconds: 3600,
      minIntentsPerBatch: 1000,
      maxIntentsPerBatch: 5000,
    });

    console.log("BATCH RESULT:", {
      batchId: result.batchId,
      numIntents: result.numIntents,
      numItemsSettled: result.numItemsSettled,
    });
  } catch (e: any) {
    console.error("runSingleBatch.ts error:", e?.message ?? e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("runSingleBatch.ts fatal error:", e);
  process.exit(1);
});

