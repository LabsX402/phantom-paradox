import "dotenv/config";
import { initDatabase, query } from "../shared/db";

async function main() {
  const batchId = process.argv[2] || "7683b77e-b256-4047-8632-d27d3f6e5c37";
  const txSig = process.argv[3] || "5JjwQtZcdiMmydDS3CUZ4LAoAqbWvPQHchkJ8TxNKMYCP4G2bwV6bopM3yMMArJfjSGSKmDfVGu9df6vgUdksBVG";
  
  await initDatabase();
  await query(
    `UPDATE netting_batches SET settled = true, tx_signature = $1 WHERE batch_id = $2`,
    [txSig, batchId]
  );
  console.log(`✅ Batch ${batchId} updated with TX: ${txSig}`);
}

main().catch(console.error);

