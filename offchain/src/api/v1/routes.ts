/**
 * Black Box API v1 - Public REST endpoints for games and SDKs
 * 
 * This API exposes ONLY what games need:
 * - Inventories
 * - Markets
 * - History
 * - Audit proofs
 * 
 * It does NOT expose:
 * - Internal netting logic
 * - Dependency graphs
 * - Conflict resolution details
 * - Risk scores
 */

import { Router } from "express";
import { query, isDatabaseConnected } from "../../shared/db";
import { logger } from "../../shared/logger";
import { isRedisConnected } from "../../shared/redis";
import { ExtendedRequest } from "../middleware/types";
import { submitIntent, getSettlementPayload } from "../../netting/engine";
import { TradeIntent, SessionKeyPolicy } from "../../netting/types";
import { registerSessionKeyPolicy } from "../../netting/session";
import { requireApiKey, rateLimit, logRequest, requireGameId } from "../middleware";
import { getProgram } from "../../shared/solana";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

const router = Router();

// Apply middleware to all routes
router.use(logRequest);
router.use(rateLimit);
// Note: requireApiKey can be applied selectively per route if needed
// For now, we'll make it optional (check in each handler)

// ======================================================================
// HEALTH CHECK ENDPOINT
// ======================================================================

/**
 * GET /v1/health
 * Health check endpoint - reports status of DB, Redis, and environment
 * Does not require authentication and should not crash if services are down
 */
router.get("/health", async (req, res) => {
  try {
    // Check database status (non-blocking)
    let dbStatus = "down";
    try {
      if (isDatabaseConnected()) {
        await query("SELECT 1");
        dbStatus = "up";
      }
    } catch (error) {
      dbStatus = "down";
    }

    // Check Redis status (non-blocking)
    const redisStatus = isRedisConnected() ? "up" : "down";

    res.json({
      status: "ok",
      db: dbStatus,
      redis: redisStatus,
      env: process.env.NODE_ENV || "development",
    });
  } catch (error) {
    // Even if health check fails, return a response
    res.status(500).json({
      status: "error",
      db: "unknown",
      redis: "unknown",
      env: process.env.NODE_ENV || "development",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// ======================================================================
// INVENTORY ENDPOINTS
// ======================================================================

/**
 * GET /v1/games/:gameId/inventory/:wallet
 * Get a player's inventory for a specific game
 */
router.get("/games/:gameId/inventory/:wallet", requireGameId, async (req, res) => {
  try {
    const { gameId, wallet } = req.params;
    const gameIdNum = (req as ExtendedRequest).gameId; // From middleware

    const result = await query(
      `SELECT 
        io.item_id,
        io.owner_wallet,
        io.updated_at,
        b.batch_id as last_batch_id
       FROM item_ownership io
       LEFT JOIN batches b ON io.batch_id = b.batch_id
       WHERE io.game_id = $1 AND io.owner_wallet = $2
       ORDER BY io.updated_at DESC`,
      [gameId, wallet]
    );

    res.json({
      gameId: parseInt(gameId),
      wallet,
      items: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    logger.error("Error fetching inventory", { error, params: req.params });
    res.status(500).json({ error: "internal_error" });
  }
});

// ======================================================================
// MARKET ENDPOINTS
// ======================================================================

/**
 * GET /v1/games/:gameId/market
 * Get active market listings for a game
 * 
 * Query params:
 * - limit: number of results (default: 100)
 * - offset: pagination offset (default: 0)
 * - sort: 'price_asc' | 'price_desc' | 'newest' (default: 'newest')
 */
router.get("/games/:gameId/market", async (req, res) => {
  try {
    const { gameId } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const sort = req.query.sort as string || "newest";

    let orderBy = "l.created_at DESC";
    if (sort === "price_asc") orderBy = "l.start_price ASC";
    if (sort === "price_desc") orderBy = "l.start_price DESC";

    // Query from listings table (existing system)
    // Note: Compressed auction system integration is handled via netting engine
    // This endpoint returns both standard and compressed listings
    const result = await query(
      `SELECT 
        l.id as listing_id,
        l.seller,
        l.start_price,
        l.buy_now_price,
        l.kind,
        l.quantity_total,
        l.quantity_sold,
        l.status,
        l.created_at,
        l.activated_at
       FROM listings l
       WHERE l.game_id = $1 AND l.status = 'Active'
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [gameId, limit, offset]
    );

    res.json({
      gameId: parseInt(gameId),
      listings: result.rows,
      count: result.rows.length,
      limit,
      offset,
    });
  } catch (error) {
    logger.error("Error fetching market", { error, params: req.params });
    res.status(500).json({ error: "internal_error" });
  }
});

// ======================================================================
// HISTORY ENDPOINTS
// ======================================================================

/**
 * GET /v1/games/:gameId/items/:itemId/history
 * Get ownership history for a specific item
 */
router.get("/games/:gameId/items/:itemId/history", async (req, res) => {
  try {
    const { gameId, itemId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const result = await query(
      `SELECT 
        ih.id,
        ih.item_id,
        ih.game_id,
        ih.from_wallet,
        ih.to_wallet,
        ih.batch_id,
        b.settled_at,
        ih.created_at
       FROM item_history ih
       LEFT JOIN batches b ON ih.batch_id = b.batch_id
       WHERE ih.item_id = $1 AND ih.game_id = $2
       ORDER BY ih.created_at DESC
       LIMIT $3`,
      [itemId, gameId, limit]
    );

    res.json({
      itemId: parseInt(itemId),
      gameId: parseInt(gameId),
      history: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    logger.error("Error fetching item history", {
      error,
      params: req.params,
    });
    res.status(500).json({ error: "internal_error" });
  }
});

// ======================================================================
// BATCH ENDPOINTS (AUDIT)
// ======================================================================

/**
 * GET /v1/batches/:batchId
 * Get batch summary and audit hash
 */
router.get("/batches/:batchId", async (req, res) => {
  try {
    const { batchId } = req.params;

    // Query netting_batches table
    const batchResult = await query(
      `SELECT 
        batch_id,
        created_at,
        netted_at,
        settled,
        tx_signature,
        num_intents,
        num_items_settled,
        num_wallets
       FROM netting_batches
       WHERE batch_id = $1`,
      [batchId]
    );

    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: "batch_not_found" });
    }

    const batch = batchResult.rows[0];

    // Get settled items for this batch
    const itemsResult = await query(
      `SELECT item_id, final_owner
       FROM settled_items
       WHERE batch_id = $1`,
      [batchId]
    );

    // Get cash deltas for this batch
    const deltasResult = await query(
      `SELECT owner_pubkey, delta_lamports
       FROM net_cash_deltas
       WHERE batch_id = $1`,
      [batchId]
    );

    // Build final owners map
    const finalOwners: Record<string, string> = {};
    itemsResult.rows.forEach((row: any) => {
      finalOwners[row.item_id] = row.final_owner;
    });

    // Build cash deltas map
    const netCashDeltas: Record<string, string> = {};
    deltasResult.rows.forEach((row: any) => {
      netCashDeltas[row.owner_pubkey] = row.delta_lamports;
    });

    res.json({
      batchId: batch.batch_id,
      batch_id: batch.batch_id,
      createdAt: batch.created_at,
      created_at: batch.created_at,
      nettedAt: batch.netted_at,
      netted_at: batch.netted_at,
      settled: batch.settled,
      txSignature: batch.tx_signature,
      tx_signature: batch.tx_signature,
      numIntents: batch.num_intents,
      num_intents: batch.num_intents,
      numItemsSettled: batch.num_items_settled,
      num_items_settled: batch.num_items_settled,
      numWallets: batch.num_wallets,
      num_wallets: batch.num_wallets,
      items: itemsResult.rows.map((row: any) => ({
        itemId: row.item_id,
        finalOwner: row.final_owner,
      })),
      finalOwners,
      cashDeltas: deltasResult.rows.map((row: any) => ({
        ownerPubkey: row.owner_pubkey,
        deltaLamports: row.delta_lamports,
      })),
      netCashDeltas,
      settledAt: batch.settled ? batch.netted_at : null,
      settled_at: batch.settled ? batch.netted_at : null,
    });
  } catch (error) {
    logger.error("Error fetching batch", { error, params: req.params });
    res.status(500).json({ error: "internal_error" });
  }
});

// ======================================================================
// SESSION KEY ENDPOINTS
// ======================================================================

/**
 * POST /v1/session/open
 * Register a player session and session key with constraints
 */
router.post("/session/open", async (req, res) => {
  try {
    const {
      ownerWallet,
      sessionKey,
      maxVolumeSol,
      durationMinutes,
      allowedActions,
    } = req.body;

    if (!ownerWallet || !sessionKey || !maxVolumeSol || !durationMinutes) {
      return res.status(400).json({ error: "missing_fields" });
    }

    // Create session key policy
    const policy: SessionKeyPolicy = {
      ownerPubkey: ownerWallet,
      sessionPubkey: sessionKey,
      maxVolumeLamports: BigInt(Math.floor(maxVolumeSol * 1e9)),
      expiresAt: Math.floor(Date.now() / 1000) + durationMinutes * 60,
      allowedActions: allowedActions || ["TRADE", "BID", "BUY_NOW"],
    };

    // Register the session key policy in the netting engine
    registerSessionKeyPolicy(policy);

    // Call on-chain register_session_key instruction
    try {
      const program = getProgram();
      const ownerPubkeyObj = new PublicKey(ownerWallet);
      const sessionPubkeyObj = new PublicKey(sessionKey);
      
      // Derive engine PDA
      const [enginePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("net_engine")],
        program.programId
      );
      
      // Derive session key PDA: ["session_key", owner, session]
      const [sessionKeyPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("session_key"),
          ownerPubkeyObj.toBuffer(),
          sessionPubkeyObj.toBuffer(),
        ],
        program.programId
      );
      
      const maxVolumeLamportsBN = new BN(policy.maxVolumeLamports.toString());
      const expiresAtBN = new BN(policy.expiresAt);
      
      // Create transaction for on-chain registration
      const tx = await program.methods
        .registerSessionKey(
          maxVolumeLamportsBN,
          expiresAtBN
        )
        .accounts({
          engine: enginePda,
          sessionKey: sessionKeyPda,
          owner: ownerPubkeyObj,
          session: sessionPubkeyObj,
          payer: ownerPubkeyObj,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
      
      // Serialize transaction for client to sign
      const serializedTx = tx.serialize({ requireAllSignatures: false });
      
      logger.info("Session key registration transaction created (v1)", {
        ownerPubkey: ownerWallet,
        sessionPubkey: sessionKey,
        sessionKeyPda: sessionKeyPda.toString(),
      });
      
      res.json({
        sessionKey: policy.sessionPubkey,
        expiresAt: policy.expiresAt,
        maxVolumeSol: Number(policy.maxVolumeLamports) / 1e9,
        registrationTx: serializedTx.toString("base64"),
      });
    } catch (error) {
      logger.error("Failed to create on-chain session key transaction (v1), using off-chain only", {
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Fallback: return without on-chain registration
      res.json({
        sessionKey: policy.sessionPubkey,
        expiresAt: policy.expiresAt,
        maxVolumeSol: Number(policy.maxVolumeLamports) / 1e9,
        note: "Off-chain registration only (on-chain registration failed)",
      });
    }
      sessionKey: policy.sessionPubkey,
      expiresAt: policy.expiresAt,
      maxVolumeSol: Number(policy.maxVolumeLamports) / 1e9,
    });
  } catch (error) {
    logger.error("Error opening session", { error, body: req.body });
    res.status(500).json({ error: "internal_error" });
  }
});

// ======================================================================
// INTENT SUBMISSION ENDPOINTS
// ======================================================================

/**
 * POST /v1/intents/trade
 * Accept a signed trade intent, validate it, and enqueue for netting
 */
router.post("/intents/trade", async (req, res) => {
  try {
    const body = req.body;

    // Validate required fields
    if (
      !body.id ||
      !body.sessionPubkey ||
      !body.ownerPubkey ||
      !body.itemId ||
      !body.from ||
      !body.to ||
      !body.amountLamports ||
      !body.signature
    ) {
      return res.status(400).json({ error: "missing_fields" });
    }

    // Convert amountLamports to bigint if it's a string
    const amountLamports = typeof body.amountLamports === "string" 
      ? BigInt(body.amountLamports)
      : BigInt(body.amountLamports);

    // Ensure createdAt is set
    const createdAt = body.createdAt || Math.floor(Date.now() / 1000);

    // Build TradeIntent object
    const intent: TradeIntent = {
      id: body.id,
      sessionPubkey: body.sessionPubkey,
      ownerPubkey: body.ownerPubkey,
      itemId: body.itemId,
      from: body.from,
      to: body.to,
      amountLamports,
      nonce: body.nonce || 0,
      signature: body.signature,
      createdAt,
      gameId: body.gameId,
      listingId: body.listingId,
      intentType: body.intentType,
    };

    // Submit to netting engine
    const result = await submitIntent(intent);
    
    if (!result.accepted) {
      logger.warn("Intent rejected by netting engine", {
        intentId: intent.id,
        reason: result.reason,
      });
      return res.status(400).json({
        status: "rejected",
        reason: result.reason,
      });
    }

    res.json({
      status: "accepted",
      intentId: intent.id,
    });
  } catch (error: any) {
    logger.error("Error submitting intent", {
      error: error?.message,
      code: error?.code,
      constraint: error?.constraint,
      detail: error?.detail,
      body: req.body,
    });

    // If it's a database error, return 500 with details
    if (error?.code && error.code.startsWith("23")) {
      // PostgreSQL constraint violation
      return res.status(500).json({
        status: "rejected",
        error: "database_error",
        reason: error.message,
        constraint: error.constraint,
      });
    }

    if (error.message?.includes("rejected") || error.message?.includes("invalid")) {
      return res.status(400).json({
        status: "rejected",
        reason: error.message,
      });
    }

    res.status(500).json({
      status: "rejected",
      error: "internal_error",
      reason: error.message || String(error),
    });
  }
});

// ======================================================================
// HEALTH CHECK
// ======================================================================

router.get("/health", async (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

export default router;

