/**
 * Serverless Event Listener Handler
 * WebSocket handler for Solana program logs
 */

import { connection } from "../shared/solana";
import { query } from "./db-serverless";
import { parseEventsFromLogs, isEvent } from "../shared/events";
import { PublicKey } from "@solana/web3.js";
import { initDatabase } from "./db-serverless";
import { logger } from "../shared/logger";

const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || process.env.PHANTOMGRID_PROGRAM_ID || "8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x"
);

let dbInitialized = false;
let subscriptionActive = false;

async function ensureInitialized() {
  if (dbInitialized) return;
  await initDatabase();
  
  // Run migrations
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
    
    CREATE TABLE IF NOT EXISTS stats (
        id SERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        listing_id TEXT,
        buyer TEXT,
        winner TEXT,
        amount TEXT,
        game_id TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  
  dbInitialized = true;
}

/**
 * Process events from logs
 */
async function processEvents(logs: any, ctx: any) {
  const events = parseEventsFromLogs(logs);
  if (!events.length) return;

  logger.info(`[Serverless Listener] Slot ${ctx.slot}, sig=${logs.signature}`, {
    events: events.map((e) => e.name).join(","),
  });

  for (const evt of events) {
    try {
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
          `UPDATE listings SET status = 'Settled' WHERE pda = $1`,
          [d.listing.toString()]
        );
        
        // Update stats table
        await query(
          `
            INSERT INTO stats (event_type, listing_id, buyer, amount, game_id, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (event_type, listing_id) 
            DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
          `,
          [
            "fixed_sale",
            d.listing.toString(),
            d.buyer.toString(),
            d.amount.toString(),
            d.game_id?.toString() || null
          ]
        ).catch(err => {
          logger.warn("[Serverless Listener] Failed to update stats", { error: err });
        });
      }

      if (isEvent(evt, "AuctionSettled")) {
        const d = evt.data;
        await query(
          `UPDATE listings SET status = 'Settled' WHERE pda = $1`,
          [d.listing.toString()]
        );
        
        // Record winner in stats table
        await query(
          `
            INSERT INTO stats (event_type, listing_id, winner, amount, game_id, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
          `,
          [
            "auction_settled",
            d.listing.toString(),
            d.winner.toString(),
            d.clearing_price.toString(),
            d.game_id?.toString() || null
          ]
        ).catch(err => {
          logger.warn("[Serverless Listener] Failed to record winner in stats", { error: err });
        });
      }

      if (isEvent(evt, "PartialFill")) {
        const d = evt.data;
        await query(
          `UPDATE listings SET quantity_remaining = quantity_remaining - $1 WHERE pda = $2`,
          [d.quantityFilled.toNumber(), d.listing.toString()]
        );
      }

      if (isEvent(evt, "NetBatchSettled")) {
        const d = evt.data;
        await query(
          `
            UPDATE netting_batches 
            SET settled = true, tx_signature = $1 
            WHERE batch_id = $2
          `,
          [logs.signature, d.batchId.toString()]
        );
      }
    } catch (error) {
      logger.error("[Serverless Listener] Error processing event", {
        event: evt.name,
        error,
      });
    }
  }
}

/**
 * AWS Lambda handler for WebSocket events
 */
export const handler = async (event: any) => {
  try {
    await ensureInitialized();

    // For WebSocket API Gateway
    if (event.requestContext?.routeKey === "$connect") {
      // Initialize subscription
      if (!subscriptionActive) {
        connection.onLogs(PROGRAM_ID, processEvents);
        subscriptionActive = true;
        logger.info("[Serverless Listener] WebSocket connected, subscription active");
      }
      
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Connected" }),
      };
    }

    if (event.requestContext?.routeKey === "$disconnect") {
      subscriptionActive = false;
      logger.info("[Serverless Listener] WebSocket disconnected");
      
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Disconnected" }),
      };
    }

    // For direct invocation (polling mode)
    if (event.action === "poll") {
      // Poll for new transactions
      const signatures = await connection.getSignaturesForAddress(PROGRAM_ID, {
        limit: 10,
      });
      
      for (const sig of signatures) {
        try {
          const tx = await connection.getTransaction(sig.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          
          if (tx?.meta?.logMessages) {
            await processEvents(
              { signature: sig.signature, logs: tx.meta.logMessages },
              { slot: sig.slot }
            );
          }
        } catch (error) {
          logger.warn("[Serverless Listener] Error processing transaction", {
            signature: sig.signature,
            error,
          });
        }
      }
      
      return {
        statusCode: 200,
        body: JSON.stringify({ processed: signatures.length }),
      };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid event" }),
    };
  } catch (error) {
    logger.error("[Serverless Listener] Handler error", { error });
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

// Export for direct invocation
export { handler as eventListenerHandler };

