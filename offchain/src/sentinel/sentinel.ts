import dotenv from "dotenv";
dotenv.config();
import { query } from "../shared/db";

const INTERVAL_MS = 5 * 60 * 1000; // 5min

const tick = async () => {
  console.log("[Sentinel] Scanning for anomalies…");

  // Example: suspicious win-streak
  const { rows: streaks } = await query(
    `
      SELECT winner AS pubkey, COUNT(*) AS wins
      FROM games_settled
      WHERE settled_at > NOW() - INTERVAL '24 hours'
      GROUP BY winner
      HAVING COUNT(*) >= 10
    `
  ).catch(() => ({ rows: [] }));

  for (const row of streaks) {
    await query(
      `
        INSERT INTO risk_flags (pubkey, reason, created_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (pubkey, reason) DO NOTHING
      `,
      [row.pubkey, "high_win_streak_24h"]
    ).catch(() => {
      // table might not exist yet
    });
    console.log("[Sentinel] Flagged suspicious winner", row.pubkey);
  }

  // Example: high-frequency bids
  const { rows: spam } = await query(
    `
      SELECT bidder, COUNT(*) AS bid_count
      FROM bids
      WHERE created_at > NOW() - INTERVAL '10 minutes'
      GROUP BY bidder
      HAVING COUNT(*) > 100
    `
  ).catch(() => ({ rows: [] }));

  for (const row of spam) {
    await query(
      `
        INSERT INTO risk_flags (pubkey, reason, created_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (pubkey, reason) DO NOTHING
      `,
      [row.bidder, "bid_spam_10m"]
    ).catch(() => {
      // table might not exist yet
    });
    console.log("[Sentinel] Flagged spam bidder", row.bidder);
  }
};

const main = async () => {
  await tick();
  setInterval(tick, INTERVAL_MS);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

