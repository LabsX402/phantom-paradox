import dotenv from "dotenv";
dotenv.config();
import { query } from "../shared/db";

const INTERVAL_MS = 60 * 60 * 1000; // hourly

const tick = async () => {
  console.log("[Analyst] Aggregating metrics…");

  // Example: daily volume per game
  await query(`
    INSERT INTO game_daily_volume (game_id, day, volume_sol)
    SELECT
      l.game_id,
      DATE(t.block_time) AS day,
      SUM(l.price::numeric) as volume_sol
    FROM listings l
    JOIN tx_meta t ON t.listing_id = l.id
    WHERE l.status = 'Settled'
      AND t.block_time > NOW() - INTERVAL '2 days'
    GROUP BY l.game_id, DATE(t.block_time)
    ON CONFLICT (game_id, day)
    DO UPDATE SET volume_sol = EXCLUDED.volume_sol
  `).catch(() => {
    // table might not exist yet
  });

  // Example: user KPIs
  await query(`
    INSERT INTO user_kpis (pubkey, total_volume, games_played)
    SELECT
      bidder as pubkey,
      SUM(amount::numeric) as total_volume,
      COUNT(DISTINCT listing_id) as games_played
    FROM bids
    GROUP BY bidder
    ON CONFLICT (pubkey)
    DO UPDATE SET total_volume = EXCLUDED.total_volume,
                  games_played = EXCLUDED.games_played
  `).catch(() => {
    // table might not exist yet
  });

  console.log("[Analyst] Done.");
};

const main = async () => {
  await tick();
  setInterval(tick, INTERVAL_MS);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

