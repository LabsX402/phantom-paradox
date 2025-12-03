/**
 * ======================================================================
 * AUCTION REST API ROUTES
 * ======================================================================
 * 
 * REST endpoints for Unity/C# SDK integration.
 * 
 * Endpoints:
 * - POST /api/auctions/batch-commit
 * - POST /api/auctions/settle
 * - POST /api/auctions/admin/seize
 * - GET /api/auctions/:auctionId/proof
 * 
 * Data Flow:
 * 1. Unity calls REST endpoint
 * 2. Backend handles compression, proofs, Jito, ALTs
 * 3. Backend returns transaction signature or error
 * 
 * Failure Modes:
 * - Invalid request data
 * - Transaction failures
 * - Missing proofs
 * - Authentication failures
 */

import { Router, Request, Response } from "express";
import { PublicKey, Keypair } from "@solana/web3.js";
import { createAuctionSdk, AuctionSdkConfig } from "../sdk/auctionSdk";
import { Connection, Wallet } from "@coral-xyz/anchor";
import { buildAuctionTree, AuctionInput } from "../compression/treeBuilder";

const router = Router();

// Initialize SDK (in production, load from env/config)
let auctionSdk: any; // Placeholder - would be PhantomGridAuctionSdk

/**
 * POST /api/auctions/batch-commit
 * 
 * Request body:
 * {
 *   "game": "string (base58)",
 *   "auctions": [
 *     {
 *       "auctionId": "number",
 *       "seller": "string (base58)",
 *       "assetMint": "string (base58)",
 *       "startPrice": "number",
 *       "buyNowPrice": "number",
 *       "reservePrice": "number",
 *       "startTs": "number",
 *       "endTs": "number",
 *       "kind": "number (0=Fixed, 1=English, 2=Dutch)",
 *       "quantity": "number",
 *       "creator": "string (base58)",
 *       "royaltyBps": "number"
 *     }
 *   ],
 *   "serverAuthKey": "string (base58 private key)"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "batchId": "number",
 *   "root": "string (base58)",
 *   "auctionCount": "number",
 *   "transactionSignature": "string (base58)",
 *   "proofs": {
 *     "auctionId": {
 *       "proof": ["string (base58)"],
 *       "leaf": "string (base58)",
 *       "leafIndex": "number"
 *     }
 *   }
 * }
 */
router.post("/batch-commit", async (req: Request, res: Response) => {
  try {
    const { game, auctions, serverAuthKey } = req.body;

    if (!game || !auctions || !Array.isArray(auctions) || auctions.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid request: game and auctions array required",
      });
    }

    if (auctions.length > 10_000) {
      return res.status(400).json({
        success: false,
        error: "Batch size exceeds maximum (10,000 auctions)",
      });
    }

    // Parse server authority keypair
    const serverKeypair = Keypair.fromSecretKey(
      Buffer.from(serverAuthKey, "base64")
    );

    // Convert auctions to AuctionInput format
    const auctionInputs: AuctionInput[] = auctions.map((a: any) => ({
      auctionId: BigInt(a.auctionId),
      seller: new PublicKey(a.seller),
      assetMint: new PublicKey(a.assetMint),
      startPrice: BigInt(a.startPrice),
      buyNowPrice: BigInt(a.buyNowPrice),
      reservePrice: BigInt(a.reservePrice),
      startTs: BigInt(a.startTs),
      endTs: BigInt(a.endTs),
      kind: a.kind,
      quantity: BigInt(a.quantity),
      creator: new PublicKey(a.creator),
      royaltyBps: a.royaltyBps,
    }));

    // Commit batch
    const result = await auctionSdk.batchCommitAuctions(
      new PublicKey(game),
      auctionInputs,
      serverKeypair
    );

    // Convert proofs to JSON-serializable format
    const proofsObj: any = {};
    for (const [auctionId, proof] of result.proofs.entries()) {
      proofsObj[auctionId.toString()] = {
        proof: proof.proof,
        leaf: proof.leaf,
        leafIndex: proof.leafIndex,
      };
    }

    res.json({
      success: true,
      batchId: result.batchId,
      root: result.root,
      auctionCount: result.auctionCount,
      transactionSignature: result.transactionSignature,
      proofs: proofsObj,
    });
  } catch (error: any) {
    console.error("Batch commit error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

/**
 * POST /api/auctions/settle
 * 
 * Request body:
 * {
 *   "game": "string (base58)",
 *   "auctionId": "number",
 *   "batchId": "number",
 *   "winner": "string (base58)",
 *   "settlementPrice": "number",
 *   "winnerKey": "string (base58 private key)"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "auctionId": "number",
 *   "transactionSignature": "string (base58)",
 *   "price": "number",
 *   "winner": "string (base58)"
 * }
 */
router.post("/settle", async (req: Request, res: Response) => {
  try {
    const { game, auctionId, batchId, winner, settlementPrice, winnerKey } = req.body;

    if (!game || !auctionId || !batchId || !winner || !settlementPrice) {
      return res.status(400).json({
        success: false,
        error: "Invalid request: missing required fields",
      });
    }

    // Parse winner keypair
    const winnerKeypair = Keypair.fromSecretKey(
      Buffer.from(winnerKey, "base64")
    );

    // Settle auction
    const result = await auctionSdk.settleAuction(
      new PublicKey(game),
      BigInt(auctionId),
      BigInt(batchId),
      new PublicKey(winner),
      BigInt(settlementPrice)
    );

    res.json({
      success: true,
      auctionId: result.auctionId.toString(),
      transactionSignature: result.transactionSignature,
      price: result.price.toString(),
      winner: result.winner,
    });
  } catch (error: any) {
    console.error("Settle error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

/**
 * POST /api/auctions/admin/seize
 * 
 * Request body:
 * {
 *   "game": "string (base58)",
 *   "auctionId": "number",
 *   "batchId": "number",
 *   "adminKey": "string (base58 private key)",
 *   "complianceVault": "string (base58)",
 *   "reasonCode": "number (0=UNSPECIFIED, 1=FRAUD, 2=TOS_VIOLATION, etc.)"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "auctionId": "number",
 *   "transactionSignature": "string (base58)",
 *   "destination": "string (base58)",
 *   "reasonCode": "number"
 * }
 */
router.post("/admin/seize", async (req: Request, res: Response) => {
  try {
    const { game, auctionId, batchId, adminKey, complianceVault, reasonCode } = req.body;

    if (!game || !auctionId || !batchId || !adminKey || !complianceVault) {
      return res.status(400).json({
        success: false,
        error: "Invalid request: missing required fields",
      });
    }

    // Verify admin authority (in production, check against config)
    const adminKeypair = Keypair.fromSecretKey(
      Buffer.from(adminKey, "base64")
    );

    // Seize listing
    const result = await auctionSdk.adminSeizeListing(
      new PublicKey(game),
      BigInt(auctionId),
      BigInt(batchId),
      adminKeypair,
      new PublicKey(complianceVault),
      reasonCode || 0
    );

    res.json({
      success: true,
      auctionId: result.auctionId.toString(),
      transactionSignature: result.transactionSignature,
      destination: result.destination,
      reasonCode: result.reasonCode,
    });
  } catch (error: any) {
    console.error("Seize error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

/**
 * GET /api/auctions/:auctionId/proof
 * 
 * Query params:
 * - batchId: number (required)
 * 
 * Response:
 * {
 *   "success": true,
 *   "auctionId": "number",
 *   "batchId": "number",
 *   "proof": {
 *     "proof": ["string (base58)"],
 *     "leaf": "string (base58)",
 *     "leafIndex": "number"
 *   },
 *   "leafData": {
 *     "seller": "string (base58)",
 *     "assetMint": "string (base58)",
 *     ...
 *   }
 * }
 */
router.get("/:auctionId/proof", async (req: Request, res: Response) => {
  try {
    const { auctionId } = req.params;
    const { batchId } = req.query;

    if (!batchId) {
      return res.status(400).json({
        success: false,
        error: "batchId query parameter required",
      });
    }

    // Fetch proof from indexer/DB
    // In production, implement actual fetching logic
    const proof = await auctionSdk.fetchAuctionData(
      BigInt(auctionId),
      BigInt(batchId as string)
    );

    if (!proof.proof || !proof.leafData) {
      return res.status(404).json({
        success: false,
        error: "Proof or leaf data not found",
      });
    }

    res.json({
      success: true,
      auctionId,
      batchId: batchId.toString(),
      proof: {
        proof: proof.proof.proof.map((p: Buffer) => p.toString("base58")),
        leaf: proof.proof.leaf.toString("base58"),
        leafIndex: proof.proof.leafIndex,
      },
      leafData: proof.leafData,
    });
  } catch (error: any) {
    console.error("Get proof error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

export default router;

