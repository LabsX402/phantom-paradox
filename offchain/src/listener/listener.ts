import { connection } from "../shared/solana";
import { query } from "../shared/db";
import { TreeManager } from "../shared/merkle";
import { PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";
dotenv.config();

import { parseEventsFromLogs, isEvent } from "../shared/events";

const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || "DyN2xSo3E43nf7xwyCpa14a8pKA2RNxvpMFeStC1veeF"
);

// Simple log subscription indexer; you could also poll getSignaturesForAddress
const main = async () => {
  console.log("[Listener] Starting log subscription…");

  // Run migrations (lazy)
  await query(`
    CREATE TABLE IF NOT EXISTS merkle_leaves (
        tree TEXT NOT NULL,
        leaf_index INTEGER NOT NULL,
        leaf_hash TEXT NOT NULL,
        data JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (tree, leaf_index)
    );
    CREATE INDEX IF NOT EXISTS idx_merkle_leaves_tree ON merkle_leaves(tree);
  `);

  connection.onLogs(
    PROGRAM_ID,
    async (logs, ctx) => {
      const events = parseEventsFromLogs(logs);
      if (!events.length) return;

      console.log(
        `[Listener] Slot ${ctx.slot}, sig=${logs.signature}, events=${events
          .map((e) => e.name)
          .join(",")}`
      );

      for (const evt of events) {
        if (isEvent(evt, "ListingCreated")) {
          const d = evt.data;
          await query(
            `
              INSERT INTO listings (id, pda, game_id, seller, price, status, quantity_remaining, created_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7, NOW())
              ON CONFLICT (id) DO NOTHING
            `,
            [
              d.listingId.toString(),
              d.listing.toString(),
              d.game.toString(),
              d.seller.toString(),
              d.startPrice.toString(),
              "Active",
              d.quantityTotal.toNumber()
            ]
          );
        }

        if (isEvent(evt, "ListingCancelled")) {
          const d = evt.data;
          await query(
            `UPDATE listings SET status = 'Cancelled' WHERE pda = $1`,
            [d.listing.toString()]
          );
        }

        if (isEvent(evt, "FixedSaleExecuted")) {
          const d = evt.data;
          await query(
            `
              UPDATE listings
              SET status = 'Settled'
              WHERE pda = $1
            `,
            [d.listing.toString()]
          );
          
          // Update stats table
          await query(
            `
              INSERT INTO stats (
                event_type,
                listing_id,
                buyer,
                amount,
                game_id,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, NOW())
              ON CONFLICT (event_type, listing_id) 
              DO UPDATE SET 
                amount = EXCLUDED.amount,
                updated_at = NOW()
            `,
            [
              "fixed_sale",
              d.listing.toString(),
              d.buyer.toString(),
              d.amount.toString(),
              d.game?.toString() || null
            ]
          ).catch(err => {
            console.warn("Failed to update stats for FixedSaleExecuted", err);
          });
        }

        if (isEvent(evt, "AuctionSettled")) {
          const d = evt.data;
          await query(
            `
              UPDATE listings
              SET status = 'Settled'
              WHERE pda = $1
            `,
            [d.listing.toString()]
          );
          
          // Record winner in stats table
          await query(
            `
              INSERT INTO stats (
                event_type,
                listing_id,
                winner,
                amount,
                game_id,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, NOW())
            `,
            [
              "auction_settled",
              d.listing.toString(),
              d.winner.toString(),
              d.clearingPrice.toString(),
              d.game?.toString() || null
            ]
          ).catch(err => {
            console.warn("Failed to record winner in stats for AuctionSettled", err);
          });
        }

        if (isEvent(evt, "PartialFill")) {
          const d = evt.data;
          await query(
            `
              UPDATE listings
              SET quantity_remaining = quantity_remaining - $2
              WHERE pda = $1
            `,
            [d.listing.toString(), d.quantityFilled.toNumber()]
          );
        }

        if (isEvent(evt, "KycUpdated")) {
          const d = evt.data;
          await query(
            `
              INSERT INTO users (pubkey, kyc_status)
              VALUES ($1,$2)
              ON CONFLICT (pubkey)
              DO UPDATE SET kyc_status = EXCLUDED.kyc_status
            `,
            [d.player.toString(), d.verified ? "verified" : "unverified"]
          );
        }

        if (isEvent(evt, "GameCreated") || isEvent(evt, "GameUpdated")) {
          const d = evt.data;
          await query(
            `
              INSERT INTO games (id, game_pda, name, metadata)
              VALUES ($1,$2,$3,$4)
              ON CONFLICT (id)
              DO UPDATE SET game_pda = EXCLUDED.game_pda,
                            name = EXCLUDED.name,
                            metadata = EXCLUDED.metadata
            `,
            [
              d.gameId ? d.gameId.toString() : "unknown",
              d.game.toString(),
              "Game " + (d.gameId ? d.gameId.toString() : "unknown"),
              JSON.stringify(d)
            ]
          );
        }

        if (isEvent(evt, "CompressedListingCreated")) {
          const d = evt.data;
          console.log(`[Listener] Indexing compressed listing leaf ${d.leafIndex} for tree ${d.tree}`);
          
          // 1. Store in standard listings table for querying (with special flag)
          // We use negative IDs or special prefix for compressed listings to avoid collision if needed,
          // or just rely on the fact they come from a different source. 
          // Ideally, we have a separate 'compressed_listings' table, but for 'routes.ts' compatibility,
          // we might map them to 'listings' with a flag.
          // Let's assume we create a 'merkle_leaves' table for the tree, and 'listings' for the UI.
          
          // Append to Tree Manager
          // Note: listingHash is number[] from Anchor event, convert to hex
          const hashBuffer = Buffer.from(d.listingHash);
          const hashHex = hashBuffer.toString('hex');
          
          await TreeManager.appendLeaf(
            d.tree.toString(), 
            d.leafIndex, 
            hashHex, 
            {
                game: d.game.toString(),
                seller: d.seller.toString()
            }
          );
        }
      }
    },
    "confirmed"
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

