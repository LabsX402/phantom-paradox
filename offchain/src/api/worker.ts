/**
 * Worker API Routes
 * Handles worker registration and profile management
 */

import { Router } from "express";
import { query } from "../shared/db";
import { getProgram } from "../shared/solana";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { logger } from "../shared/logger";
import { asyncHandler } from "./middleware";
import { ExtendedRequest } from "./middleware/types";

const router = Router();

// Helper to derive worker PDA
function deriveWorkerPda(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("worker"), authority.toBuffer()],
    getProgram().programId
  );
}

/**
 * POST /worker/register
 * Register or update worker profile
 * 
 * Body:
 * - payoutMethod: string (SOL, USDC, PAYPAL, MPESA, UPI, ALIPAY)
 * - payoutAddress: string (PayPal email, UPI ID, phone number, etc.)
 * - bidPriceLamports: number (optional, price in lamports)
 * - bidPriceUsdCents: number (optional, price in USD cents)
 * 
 * Note: In production, this should require wallet signature verification
 */
router.post(
  "/register",
  asyncHandler(async (req: ExtendedRequest, res) => {
    const { payoutMethod, payoutAddress, bidPriceLamports, bidPriceUsdCents } = req.body;

    // Validate payout method
    const validMethods = ["SOL", "USDC", "PAYPAL", "MPESA", "UPI", "ALIPAY"];
    if (!validMethods.includes(payoutMethod)) {
      return res.status(400).json({
        error: "invalid_payout_method",
        message: `Payout method must be one of: ${validMethods.join(", ")}`,
      });
    }

    // Validate payout address
    if (!payoutAddress || payoutAddress.length > 64) {
      return res.status(400).json({
        error: "invalid_payout_address",
        message: "Payout address is required and must be <= 64 characters",
      });
    }

    // Get wallet from request (in production, verify signature)
    // For now, assume it's passed in body or header
    const walletPubkeyStr = req.body.walletPubkey || req.headers["x-wallet-pubkey"];
    if (!walletPubkeyStr) {
      return res.status(401).json({
        error: "unauthorized",
        message: "Wallet public key required",
      });
    }

    let walletPubkey: PublicKey;
    try {
      walletPubkey = new PublicKey(walletPubkeyStr);
    } catch (e) {
      return res.status(400).json({
        error: "invalid_wallet",
        message: "Invalid wallet public key",
      });
    }

    const [workerPda] = deriveWorkerPda(walletPubkey);

    // Convert payout method to u8
    const payoutMethodMap: Record<string, number> = {
      SOL: 0,
      USDC: 1,
      PAYPAL: 2,
      MPESA: 3,
      UPI: 4,
      ALIPAY: 5,
    };

    const payoutMethodU8 = payoutMethodMap[payoutMethod];

    try {
      const program = getProgram();

      // Call on-chain register_worker instruction
      const tx = await program.methods
        .registerWorker(
          payoutMethodU8,
          payoutAddress,
          new BN(bidPriceLamports || 0),
          new BN(bidPriceUsdCents || 0)
        )
        .accounts({
          authority: walletPubkey,
          workerProfile: workerPda,
          systemProgram: PublicKey.default, // Will be replaced by Anchor
        })
        .rpc();

      // Save to database
      await query(
        `INSERT INTO worker_profiles (
          user_pubkey, payout_method, payout_address, 
          bid_price_lamports, bid_price_usd_cents
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_pubkey) 
        DO UPDATE SET 
          payout_method = EXCLUDED.payout_method,
          payout_address = EXCLUDED.payout_address,
          bid_price_lamports = EXCLUDED.bid_price_lamports,
          bid_price_usd_cents = EXCLUDED.bid_price_usd_cents,
          updated_at = NOW()`,
        [
          walletPubkey.toBase58(),
          payoutMethod,
          payoutAddress,
          bidPriceLamports || 0,
          bidPriceUsdCents || 0,
        ]
      );

      logger.info("Worker registered", {
        wallet: walletPubkey.toBase58(),
        payoutMethod,
        tx,
      });

      res.json({
        success: true,
        tx,
        workerPda: workerPda.toBase58(),
      });
    } catch (error: any) {
      logger.error("Worker registration failed", { error, wallet: walletPubkey.toBase58() });
      res.status(500).json({
        error: "registration_failed",
        message: error.message || "Failed to register worker",
      });
    }
  })
);

/**
 * GET /worker/profile/:walletPubkey
 * Get worker profile
 */
router.get(
  "/profile/:walletPubkey",
  asyncHandler(async (req, res) => {
    const { walletPubkey } = req.params;

    try {
      const result = await query(
        `SELECT * FROM worker_profiles WHERE user_pubkey = $1`,
        [walletPubkey]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: "not_found",
          message: "Worker profile not found",
        });
      }

      res.json(result.rows[0]);
    } catch (error: any) {
      logger.error("Failed to get worker profile", { error, walletPubkey });
      res.status(500).json({
        error: "internal_error",
        message: error.message || "Failed to get worker profile",
      });
    }
  })
);

/**
 * GET /worker/rankings
 * Get worker rankings (for job matching)
 */
router.get(
  "/rankings",
  asyncHandler(async (req, res) => {
    try {
      const result = await query(
        `SELECT 
          user_pubkey,
          payout_method,
          bid_price_lamports,
          bid_price_usd_cents,
          total_jobs,
          total_earned,
          avg_response_time,
          success_rate_bps,
          (success_rate_bps::float / 10000) * 
          LN(total_jobs + 1) * 
          (100000.0 / NULLIF(avg_response_time, 0)) as score
        FROM worker_profiles
        ORDER BY score DESC
        LIMIT 100`
      );

      res.json(result.rows);
    } catch (error: any) {
      logger.error("Failed to get worker rankings", { error });
      res.status(500).json({
        error: "internal_error",
        message: error.message || "Failed to get worker rankings",
      });
    }
  })
);

export default router;

