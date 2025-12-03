import dotenv from "dotenv";
dotenv.config();
import { query } from "../shared/db";
import fetch from "node-fetch";

const INTERVAL_MS = 10 * 60 * 1000; // 10min

const API_BASE = process.env.API_BASE || "http://localhost:4000/api";

const tick = async () => {
  console.log("[Housekeeper] Tick…");

  // 1) Expire listings
  await query(
    `
      UPDATE listings
      SET status = 'Expired'
      WHERE status = 'Active'
        AND end_time IS NOT NULL
        AND end_time < NOW()
    `
  );

  // 2) Auto trigger auction settlement
  const { rows: auctions } = await query(
    `
      SELECT id FROM listings
      WHERE status = 'Active'
        AND type = 'Auction'
        AND end_time IS NOT NULL
        AND end_time < NOW()
      LIMIT 50
    `
  );

  for (const a of auctions) {
    try {
      const response = await fetch(`${API_BASE}/auction/settle/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: a.id })
      });
      if (response.ok) {
        console.log("[Housekeeper] Triggered settlement for", a.id);
      } else {
        console.error("[Housekeeper] Failed to trigger settlement", a.id, response.statusText);
      }
    } catch (e) {
      console.error("[Housekeeper] Failed to trigger settlement", a.id, e);
    }
  }

  // 3) Fee monitoring (example, on-chain call to Config)
  // TODO: use getProgram() and read config, compare fee counters > threshold, send alert
};

const main = async () => {
  await tick();
  setInterval(tick, INTERVAL_MS);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

