import { Router } from "express";
import { query } from "../shared/db";
import { redisClient } from "../shared/redis";
import { getProgram } from "../shared/solana";
import { PublicKey, Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { TreeManager } from "../shared/merkle";
import { submitIntent, runNettingBatch, getBatch, getSettlementPayload, getPendingIntentCount } from "../netting/engine";
import { registerSessionKeyPolicy, getSessionKeyPolicy } from "../netting/session";
import { TradeIntent, SessionKeyPolicy } from "../netting/types";
import { log as logger } from "../shared/logger";
import { v4 as uuidv4 } from "uuid";
import { getPlayerLedger } from "../shared/ledger";
import { deriveSettlementAccounts } from "../shared/accounts";
import { BN } from "@coral-xyz/anchor";
import { validate, commonRules, asyncHandler } from "./middleware";

const router = Router();

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "phantomgrid-api",
  });
});

// GET /listings
router.get("/listings", async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM listings WHERE status = 'Active' ORDER BY created_at DESC LIMIT 100`
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal_error" });
  }
});

// GET /proof/:tree/:leafIndex
// Returns Merkle proof for a compressed listing
router.get("/proof/:tree/:leafIndex", async (req, res) => {
  const { tree, leafIndex } = req.params;
  try {
    const proofData = await TreeManager.getProof(tree, parseInt(leafIndex));
    if (!proofData) {
      return res.status(404).json({ error: "leaf_not_found" });
    }
    res.json(proofData);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "proof_generation_error" });
  }
});

// GET /user/nonce
router.get("/user/nonce", async (req, res) => {
  const nonce = `nonce_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  // you could store in Redis keyed by IP or wallet later
  res.json({ nonce });
});

// POST /bid
router.post("/bid", 
  validate([
    commonRules.pubkey("bidder", true),
    commonRules.numericString("amount", true),
    { field: "listingId", required: true, type: "number" },
  ]),
  asyncHandler(async (req, res) => {
    const { listingId, bidder, amount } = req.body;

  try {
    // Get listing to find game_id
    const listingResult = await query(
      `SELECT game_id FROM listings WHERE id = $1`,
      [listingId]
    );

    if (!listingResult.rows.length) {
      return res.status(404).json({ error: "listing_not_found" });
    }

    const gameId = listingResult.rows[0].game_id;
    const bidderPubkey = new PublicKey(bidder);

    // Check PlayerLedger balance
    const ledger = await getPlayerLedger(bidderPubkey, gameId);
    if (!ledger) {
      return res.status(400).json({ 
        error: "ledger_not_found",
        message: "Player ledger not found. Please deposit credits first."
      });
    }

    const totalRequired = BigInt(amount);
    const availableBalance = ledger.available;

    if (availableBalance < totalRequired) {
      return res.status(400).json({ 
        error: "insufficient_credits",
        available: availableBalance.toString(),
        required: totalRequired.toString(),
        shortfall: (totalRequired - availableBalance).toString()
      });
    }

    const result = await query(
      `
        INSERT INTO bids (listing_id, bidder, amount, created_at)
        VALUES ($1,$2,$3,NOW())
        RETURNING id
      `,
      [listingId, bidder, amount]
    );

    // update listing highest bid (simple example)
    await query(
      `UPDATE listings SET highest_bid = $2 WHERE id = $1 AND ($2::numeric > COALESCE(highest_bid, 0))`,
      [listingId, amount]
    );

    res.json({ bidId: result.rows[0].id });
  })
);

// POST /auction/settle/request
router.post("/auction/settle/request",
  validate([
    { field: "listingId", required: true, type: "number" },
  ]),
  asyncHandler(async (req, res) => {
    const { listingId } = req.body;

  try {
    // Check listing in DB
    const { rows } = await query(
      `SELECT * FROM listings WHERE id = $1 AND status = 'Active'`,
      [listingId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "listing_not_found" });
    }
    const listing = rows[0];

    // Check end_time passed
    if (listing.end_time && new Date(listing.end_time) > new Date()) {
      return res.status(400).json({ error: "auction_not_ended" });
    }

    // Get highest bid
    const bids = await query(
      `
        SELECT * FROM bids
        WHERE listing_id = $1
        ORDER BY amount::numeric DESC, created_at ASC
        LIMIT 1
      `,
      [listingId]
    );

    if (!bids.rows.length) {
      return res.status(400).json({ error: "no_bids" });
    }

    const bestBid = bids.rows[0];

    // Construct finalize_auction_settlement instruction/tx
    const program = getProgram();

    // Derive all needed PDAs from listing + game config
    const sellerPubkey = new PublicKey(listing.seller);
    const bidderPubkey = new PublicKey(bestBid.bidder);
    
    const accounts = await deriveSettlementAccounts(
      listing.id,
      listing.game_id,
      sellerPubkey,
      bidderPubkey
    );

    const ix = await program.methods
      .finalizeAuctionSettlement(
        /* quantity */ 1,
        /* clearingPrice */ bestBid.amount,
        /* minExpectedPrice */ bestBid.amount,
        /* maxQuantity */ 1
      )
      .accounts({
        listing: accounts.listing,
        game: accounts.game,
        sellerLedger: accounts.sellerLedger,
        buyerLedger: accounts.buyerLedger,
        winnerSigner: bidderPubkey,
        config: accounts.config,
        currencyMint: accounts.currencyMint,
        gameVault: accounts.gameVault,
        sellerTokenAccount: accounts.sellerTokenAccount,
        buyerTokenAccount: accounts.buyerTokenAccount,
      })
      .instruction();

    // Create a transaction with the instruction to serialize it
    const tx = new Transaction().add(ix);
    const serializedIx = tx.serialize({ verifySignatures: false });

    // Here you'd pass this to Signer worker via message queue / HTTP
    // For now, just return to caller
    res.json({
      listingId,
      bidId: bestBid.id,
      unsignedInstruction: serializedIx.toString("base64")
    });
  })
);

// ======================================================================
// TEMPORAL NETTING ENGINE ROUTES
// ======================================================================

/**
 * POST /session-keys/create
 * Create a session key policy
 * 
 * Body: {
 *   ownerPubkey: string,
 *   maxVolumeLamports: string (bigint as string),
 *   expiresInSeconds: number,
 *   allowedActions: ("TRADE" | "BID" | "BUY_NOW")[]
 * }
 * 
 * Returns: {
 *   sessionPubkey: string,
 *   policy: SessionKeyPolicy,
 *   messageToSign: string (base64) // Transaction or message for on-chain approval
 * }
 */
router.post("/session-keys/create",
  validate([
    commonRules.pubkey("ownerPubkey", true),
    commonRules.numericString("maxVolumeLamports", true),
    { field: "expiresInSeconds", required: true, type: "number", min: 1, max: 86400 * 365 }, // Max 1 year
    { field: "allowedActions", required: true, type: "array" },
  ]),
  asyncHandler(async (req, res) => {
    const { ownerPubkey, maxVolumeLamports, expiresInSeconds, allowedActions } = req.body;
    
    // Generate session keypair
    const sessionKeypair = Keypair.generate();
    const sessionPubkey = sessionKeypair.publicKey.toBase58();
    
    // Create policy
    const now = Math.floor(Date.now() / 1000);
    const policy: SessionKeyPolicy = {
      ownerPubkey,
      sessionPubkey,
      maxVolumeLamports: BigInt(maxVolumeLamports),
      expiresAt: now + expiresInSeconds,
      allowedActions,
      createdAt: now,
    };
    
    // Register policy
    await registerSessionKeyPolicy(policy);
    
    // Create on-chain session key registration transaction
    let messageToSign: string;
    let txSignature: string | null = null;
    
    try {
      const program = getProgram();
      const ownerPubkeyObj = new PublicKey(ownerPubkey);
      const sessionPubkeyObj = new PublicKey(sessionPubkey);
      
      // Derive session key PDA
      const [sessionKeyPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("session_key"),
          sessionPubkeyObj.toBuffer(),
        ],
        program.programId
      );
      
      const maxVolumeLamportsBN = new BN(maxVolumeLamports.toString());
      const expiresAtBN = new BN(policy.expiresAt);
      
      // Create transaction for on-chain registration
      const tx = await program.methods
        .registerSessionKey(
          maxVolumeLamportsBN,
          expiresAtBN,
          allowedActions
        )
        .accounts({
          owner: ownerPubkeyObj,
          sessionKey: sessionKeyPda,
          payer: ownerPubkeyObj,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
      
      // Serialize transaction for client to sign
      const serializedTx = tx.serialize({ requireAllSignatures: false });
      messageToSign = serializedTx.toString("base64");
      
      logger.info("Session key registration transaction created", {
        ownerPubkey,
        sessionPubkey,
        sessionKeyPda: sessionKeyPda.toString(),
      });
    } catch (error) {
      logger.error("Failed to create on-chain session key transaction, using fallback", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Fallback: return JSON message for signing
      messageToSign = Buffer.from(JSON.stringify({
        type: "session_key_approval",
        ownerPubkey,
        sessionPubkey,
        maxVolumeLamports,
        expiresAt: policy.expiresAt,
      })).toString("base64");
    }
    
    logger.info("Session key created", {
      ownerPubkey,
      sessionPubkey,
      maxVolume: maxVolumeLamports,
      expiresAt: new Date(policy.expiresAt * 1000).toISOString(),
    });
    
    res.json({
      sessionPubkey,
      policy: {
        ...policy,
        maxVolumeLamports: policy.maxVolumeLamports.toString(),
        expiresAt: policy.expiresAt,
      },
      messageToSign,
    });
  })
);

/**
 * POST /intents/submit
 * Submit a trade intent
 * 
 * Body: TradeIntent
 * 
 * Returns: {
 *   status: "accepted" | "rejected",
 *   reason?: string
 * }
 */
router.post("/intents/submit",
  validate([
    { field: "id", required: true, type: "string" },
    commonRules.pubkey("sessionPubkey", true),
    commonRules.pubkey("ownerPubkey", true),
    { field: "itemId", required: true, type: "string" },
    commonRules.pubkey("from", true),
    commonRules.pubkey("to", true),
    commonRules.numericString("amountLamports", true),
    { field: "signature", required: true, type: "string" },
  ]),
  asyncHandler(async (req, res) => {
    const intent: TradeIntent = req.body;
    
    // Ensure createdAt is set
    if (!intent.createdAt) {
      intent.createdAt = Math.floor(Date.now() / 1000);
    }
    
    // Submit intent
    const result = await submitIntent(intent);
    
    if (result.accepted) {
      res.json({ status: "accepted" });
    } else {
      res.status(400).json({ 
        status: "rejected",
        reason: result.reason 
      });
    }
  })
);

/**
 * POST /netting/run
 * Run netting batch (manual trigger, later will be cron/worker)
 * 
 * Body (optional): {
 *   batchWindowSeconds?: number,
 *   maxIntentsPerBatch?: number,
 *   minIntentsPerBatch?: number
 * }
 * 
 * Returns: {
 *   batchId: string,
 *   numIntents: number,
 *   numItemsSettled: number,
 *   numWallets: number,
 *   netCashDeltas: { [ownerPubkey: string]: string } // bigint as string
 * }
 */
router.post("/netting/run", async (req, res) => {
  try {
    const config = req.body || {};
    
    // Run netting batch
    const result = await runNettingBatch(config);
    
    // Convert bigints to strings for JSON
    const netCashDeltas: { [key: string]: string } = {};
    for (const [owner, delta] of result.netCashDeltas.entries()) {
      if (delta !== 0n) {
        netCashDeltas[owner] = delta.toString();
      }
    }
    
    logger.info("Netting batch run complete", {
      batchId: result.batchId,
      numIntents: result.numIntents,
      numItemsSettled: result.numItemsSettled,
      numWallets: result.numWallets,
    });
    
    res.json({
      batchId: result.batchId,
      numIntents: result.numIntents,
      numItemsSettled: result.numItemsSettled,
      numWallets: result.numWallets,
      netCashDeltas,
      finalOwners: Object.fromEntries(result.finalOwners),
    });
  } catch (e) {
    logger.error("Error running netting batch", {
      error: e instanceof Error ? e.message : String(e),
    });
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /netting/batch/:batchId
 * Get netting batch details
 */
router.get("/netting/batch/:batchId", async (req, res) => {
  try {
    const { batchId } = req.params;
    const batch = getBatch(batchId);
    
    if (!batch) {
      return res.status(404).json({ error: "batch_not_found" });
    }
    
    res.json({
      batchId: batch.batchId,
      createdAt: batch.createdAt,
      nettedAt: batch.nettedAt,
      settled: batch.settled,
      txSignature: batch.txSignature,
      numIntents: batch.result?.numIntents || 0,
      numItemsSettled: batch.result?.numItemsSettled || 0,
      numWallets: batch.result?.numWallets || 0,
    });
  } catch (e) {
    logger.error("Error getting batch", {
      error: e instanceof Error ? e.message : String(e),
    });
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /netting/pending
 * Get pending intent count
 */
router.get("/netting/pending", async (req, res) => {
  try {
    const count = getPendingIntentCount();
    res.json({ pendingIntents: count });
  } catch (e) {
    logger.error("Error getting pending intents", {
      error: e instanceof Error ? e.message : String(e),
    });
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /netting/settlement/:batchId
 * Get settlement payload for a batch (ready for on-chain settlement)
 */
router.get("/netting/settlement/:batchId", async (req, res) => {
  try {
    const { batchId } = req.params;
    const payload = getSettlementPayload(batchId);
    
    if (!payload) {
      return res.status(404).json({ error: "batch_not_found_or_not_settled" });
    }
    
    // Convert bigints to strings
    const netDeltas = payload.netDeltas.map(d => ({
      ownerPubkey: d.ownerPubkey,
      deltaLamports: d.deltaLamports.toString(),
    }));
    
    // Convert batch hash to base64 for JSON (for on-chain settlement)
    const batchHashBase64 = payload.batchHash.toString("base64");
    
    res.json({
      batchId,
      batchHash: batchHashBase64, // For on-chain settle_net_batch instruction
      settledItems: payload.settledItems,
      netDeltas,
    });
  } catch (e) {
    logger.error("Error getting settlement payload", {
      error: e instanceof Error ? e.message : String(e),
    });
    res.status(500).json({ error: "internal_error" });
  }
});

// ======================================================================
// SHADOW INDEXER READ API (for UI queries)
// ======================================================================

/**
 * GET /items/by-owner/:ownerPubkey
 * Returns all items owned by that pubkey from Postgres (shadow indexer)
 * 
 * This endpoint queries the Postgres "items" table that is updated by
 * the state root indexer. With compressed settlement, ownership is not
 * directly queryable from Solana RPC, so the UI must use this API.
 */
router.get("/items/by-owner/:ownerPubkey", async (req, res) => {
  try {
    const owner = req.params.ownerPubkey;
    
    // Validate pubkey format (basic check)
    if (!owner || owner.length < 32) {
      return res.status(400).json({ error: "invalid_pubkey" });
    }
    
    const rows = await query(
      "SELECT item_id, updated_at FROM items WHERE owner_pubkey = $1 ORDER BY item_id",
      [owner]
    );
    
    res.json({
      owner,
      items: rows.rows.map(r => ({
        itemId: r.item_id,
        updatedAt: r.updated_at,
      })),
      count: rows.rows.length,
    });
  } catch (e) {
    logger.error("[API] /items/by-owner failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /batches/recent
 * Returns recent netting_batches with num_intents, num_items, settled, tx_signature
 * 
 * Useful for UI to display recent batch activity and settlement status.
 */
router.get("/batches/recent", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const limitClamped = Math.min(Math.max(limit, 1), 100); // Clamp between 1 and 100
    
    const rows = await query(
      `
        SELECT 
          batch_id, 
          num_intents, 
          num_items_settled, 
          settled, 
          tx_signature, 
          created_at,
          netted_at
        FROM netting_batches
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limitClamped]
    );
    
    res.json({
      batches: rows.rows.map(r => ({
        batchId: r.batch_id,
        numIntents: r.num_intents,
        numItemsSettled: r.num_items_settled,
        settled: r.settled,
        txSignature: r.tx_signature,
        createdAt: r.created_at,
        nettedAt: r.netted_at,
      })),
      count: rows.rows.length,
    });
  } catch (e) {
    logger.error("[API] /batches/recent failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;

