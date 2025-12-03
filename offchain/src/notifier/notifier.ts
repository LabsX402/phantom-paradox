import dotenv from "dotenv";
dotenv.config();
import { query } from "../shared/db";
import { logger } from "../shared/logger";

// This is a polling-based notifier. In real life, hook into DB triggers or an event bus.
const POLL_INTERVAL_MS = 30_000;

export interface NotificationPayload {
  userId: string;
  type: "intent_skipped" | "batch_settled" | "batch_failed" | "listing_created" | "auction_settled" | "partial_fill";
  message: string;
  data?: any;
}

/**
 * Send a notification to a user
 */
export async function sendNotification(payload: NotificationPayload): Promise<void> {
  try {
    // 1. Store notification in database
    await query(
      `INSERT INTO notifications (user_id, type, message, data, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT DO NOTHING`,
      [payload.userId, payload.type, payload.message, JSON.stringify(payload.data || {})]
    ).catch(err => {
      // Table might not exist yet, that's okay
      logger.warn("Failed to store notification in DB", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    
    // 2. Get user preferences
    const prefs = await query(
      `SELECT webhook_url, email, push_token, webhook_enabled, email_enabled, push_enabled 
       FROM user_preferences WHERE user_id = $1`,
      [payload.userId]
    ).catch(() => ({ rows: [] }));
    
    const userPrefs = prefs.rows[0];
    
    // 3. Send webhook if configured
    if (userPrefs?.webhook_url && userPrefs?.webhook_enabled !== false) {
      try {
        const response = await fetch(userPrefs.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: payload.type,
            message: payload.message,
            data: payload.data,
            timestamp: new Date().toISOString(),
          }),
        });
        
        if (!response.ok) {
          logger.warn("Webhook notification failed", {
            userId: payload.userId,
            status: response.status,
          });
        } else {
          logger.info("Webhook notification sent", {
            userId: payload.userId,
            type: payload.type,
          });
        }
      } catch (error) {
        logger.warn("Webhook notification error", {
          userId: payload.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    
    // 4. Send email if configured (TODO: integrate SendGrid/Mailgun)
    if (userPrefs?.email && userPrefs?.email_enabled !== false) {
      await sendEmail(
        userPrefs.email,
        `PhantomGrid: ${payload.type.replace(/_/g, " ").toUpperCase()}`,
        payload.message
      );
    }
    
    // 5. Send push notification if configured (TODO: integrate FCM/APNS)
    if (userPrefs?.push_token && userPrefs?.push_enabled !== false) {
      // TODO: Implement push notification
      logger.info("Push notification queued", { userId: payload.userId });
    }
    
    logger.info("Notification processed", {
      userId: payload.userId,
      type: payload.type,
    });
  } catch (error) {
    logger.error("Failed to send notification", {
      error: error instanceof Error ? error.message : String(error),
      payload,
    });
  }
}

/**
 * Notify user that their intent was skipped
 */
export async function notifyIntentSkipped(
  userId: string,
  intentId: string,
  reason: string
): Promise<void> {
  await sendNotification({
    userId,
    type: "intent_skipped",
    message: `Your trade intent ${intentId} was skipped: ${reason}`,
    data: { intentId, reason },
  });
}

/**
 * Notify user that a batch was settled
 */
export async function notifyBatchSettled(
  userId: string,
  batchId: string,
  items: number,
  cashDelta: string
): Promise<void> {
  await sendNotification({
    userId,
    type: "batch_settled",
    message: `Batch ${batchId} settled: ${items} items, ${cashDelta} lamports`,
    data: { batchId, items, cashDelta },
  });
}

/**
 * Notify user that a batch failed
 */
export async function notifyBatchFailed(
  userId: string,
  batchId: string,
  reason: string
): Promise<void> {
  await sendNotification({
    userId,
    type: "batch_failed",
    message: `Batch ${batchId} failed: ${reason}`,
    data: { batchId, reason },
  });
}

const sendEmail = async (to: string, subject: string, body: string) => {
  // TODO: integrate SendGrid / Mailgun / etc
  logger.info(`[Notifier] Email → ${to}: ${subject} | ${body}`);
};

const loop = async () => {
  console.log("[Notifier] Starting polling loop…");

  // Simple pattern: use a 'notifications' table produced by Listener/Housekeeper
  // or query listings with status changes since last check.
  let lastCheck = new Date(0);

  setInterval(async () => {
    try {
      const { rows } = await query(
        `
          SELECT * FROM notification_queue
          WHERE created_at > $1
          ORDER BY created_at ASC
        `,
        [lastCheck]
      );

      for (const row of rows) {
        // row.type: 'ListingCreated' | 'AuctionSettled' | 'PartialFill'
        // row.payload: JSON with seller, buyer, etc
        const payload = row.payload as any;
        switch (row.type) {
          case "ListingCreated":
            // notify followers later
            break;
          case "AuctionSettled":
            await sendEmail(
              payload.sellerEmail,
              "Your item sold",
              `Congrats, your listing ${payload.listingId} sold for ${payload.price} SOL.`
            );
            await sendEmail(
              payload.winnerEmail,
              "You won the auction",
              `You won listing ${payload.listingId} for ${payload.price} SOL.`
            );
            break;
          case "PartialFill":
            await sendEmail(
              payload.sellerEmail,
              "Partial fill",
              `${payload.filled} items sold, ${payload.remaining} remaining on listing ${payload.listingId}.`
            );
            break;
        }
        lastCheck = new Date(row.created_at);
      }
    } catch (e) {
      console.error(e);
    }
  }, POLL_INTERVAL_MS);
};

loop().catch((e) => {
  console.error(e);
  process.exit(1);
});

