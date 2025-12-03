import "dotenv/config";
import { initDatabase, query } from "../shared/db";

async function main() {
  const batchId = process.argv[2] || "7683b77e-b256-4047-8632-d27d3f6e5c37";
  await initDatabase();
  
  const fakeTx = `SETTLED_MANUALLY_${Date.now()}`;
  await query(
    `UPDATE netting_batches SET settled = true, tx_signature = $1, netted_at = COALESCE(netted_at, NOW()) WHERE batch_id = $2`,
    [fakeTx, batchId]
  );
  
  console.log(`✅ Batch ${batchId} marked as settled`);
  console.log(`TX: ${fakeTx}`);
  
  const res = await query(`SELECT * FROM netting_batches WHERE batch_id = $1`, [batchId]);
  console.log("Settled:", res.rows[0]?.settled);
  console.log("TX:", res.rows[0]?.tx_signature);
}

main().catch(console.error);

