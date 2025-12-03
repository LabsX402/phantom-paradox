import "dotenv/config";
import { initDatabase, query } from "../shared/db";

async function main() {
  await initDatabase();

  // Session pubkey can be overridden via CLI argument:
  //   npx ts-node src/scripts/checkDb.ts <session_pubkey>
  const sessionPubkey = process.argv[2] ?? "5dUXr8ZXe4KZTJzCr6qCRGYi7Zk8DCt3QgMdPSHKHdaw";

  const intents = await query(
    "SELECT COUNT(*) AS count FROM trade_intents WHERE session_pubkey = $1",
    [sessionPubkey]
  );
  console.log(`Intents in DB for session ${sessionPubkey}:`, Number(intents.rows[0]?.count ?? 0));

  const batches = await query(
    "SELECT COUNT(*) AS count FROM netting_batches",
    []
  );
  console.log("Total batches in DB:", Number(batches.rows[0]?.count ?? 0));

  const recent = await query(
    "SELECT batch_id, num_intents, settled, created_at FROM netting_batches ORDER BY created_at DESC LIMIT 5",
    []
  );

  console.log("Recent batches:");
  if (recent.rows.length === 0) {
    console.log("  (no batches yet)");
  } else {
    for (const row of recent.rows) {
      console.log(
        `  - batch_id=${row.batch_id}, num_intents=${row.num_intents}, settled=${row.settled}, created_at=${row.created_at}`
      );
    }
  }
}

main().catch((e) => {
  console.error("checkDb.ts error:", e);
  process.exit(1);
});

