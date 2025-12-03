import "dotenv/config";
import { initDatabase, query } from "../shared/db";

async function main() {
  const batchId = process.argv[2] || "7683b77e-b256-4047-8632-d27d3f6e5c37";
  await initDatabase();
  await query(
    `UPDATE netting_batches SET settled = false, tx_signature = NULL WHERE batch_id = $1`,
    [batchId]
  );
  console.log(`✅ Batch ${batchId} unmarked`);
}

main().catch(console.error);

