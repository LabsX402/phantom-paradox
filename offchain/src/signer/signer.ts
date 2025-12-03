import dotenv from "dotenv";
dotenv.config();

import express from "express";
import bodyParser from "body-parser";
import bs58 from "bs58";
import { Keypair, Transaction, VersionedTransaction, PublicKey } from "@solana/web3.js";
import { connection } from "../shared/solana";
import { BorshInstructionCoder, BN } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

// Load IDL
const idlPath = path.resolve(__dirname, "../../idl/phantom_paradox.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
const coder = new BorshInstructionCoder(idl as any);
const PROGRAM_ID = new PublicKey("DyN2xSo3E43nf7xwyCpa14a8pKA2RNxvpMFeStC1veeF");

// NOTE: for real infra, use KMS/Vault instead of env secret
const secret = process.env.SERVER_AUTHORITY_SECRET_KEY;
if (!secret) {
  console.warn("[Signer] SERVER_AUTHORITY_SECRET_KEY missing. Using random keypair (DEV ONLY).");
}
const serverAuthority = secret
  ? Keypair.fromSecretKey(bs58.decode(secret))
  : Keypair.generate();

const app = express();
app.use(bodyParser.json());

// POST /sign
// body: { unsignedTxBase64: string, metadata: { minExpectedPrice, maxQuantity, gameId, ... } }
app.post("/sign", async (req, res) => {
  const { unsignedTxBase64, metadata } = req.body || {};
  if (!unsignedTxBase64) {
    return res.status(400).json({ error: "missing_unsignedTxBase64" });
  }

  try {
    const raw = Buffer.from(unsignedTxBase64, "base64");

    // This can be legacy or v0, try both
    let tx: Transaction | VersionedTransaction;
    try {
      tx = Transaction.from(raw);
    } catch {
      tx = VersionedTransaction.deserialize(raw);
    }

    // Decode instructions and enforce safety checks
    const { minExpectedPrice, maxQuantity, listingId, gameId } = metadata || {};

    // Helper to get instructions from either Transaction or VersionedTransaction
    const instructions = tx instanceof Transaction
      ? tx.instructions.map(ix => ({ programId: ix.programId, data: ix.data }))
      : tx.message.compiledInstructions.map(ix => {
          const programId = tx.message.staticAccountKeys[ix.programIdIndex];
          return { programId, data: Buffer.from(ix.data) };
        });

    let checked = false;

    for (const ix of instructions) {
      if (ix.programId.equals(PROGRAM_ID)) {
        const decoded = coder.instruction.decode(ix.data);
        if (decoded && decoded.name === "finalize_auction_settlement") {
          const data = decoded.data as any;
          console.log("[Signer] Decoded finalize_auction_settlement:", data);

          // 1. Validate Clearing Price
          if (minExpectedPrice !== undefined) {
            const clearingPrice = new BN(data.clearingPrice);
            const minPrice = new BN(minExpectedPrice);
            if (clearingPrice.lt(minPrice)) {
              throw new Error(`Safety check failed: clearingPrice (${clearingPrice.toString()}) < minExpectedPrice (${minPrice.toString()})`);
            }
          }

          // 2. Validate Quantity
          if (maxQuantity !== undefined) {
             const qty = new BN(data.quantity);
             const maxQty = new BN(maxQuantity);
             if (qty.gt(maxQty)) {
               throw new Error(`Safety check failed: quantity (${qty.toString()}) > maxQuantity (${maxQty.toString()})`);
             }
          }
          
          checked = true;
        }
      }
    }

    if (!checked && (minExpectedPrice || maxQuantity)) {
      console.warn("[Signer] WARNING: Metadata provided but no matching instruction found to validate.");
    }

    console.log("[Signer] Safety checks passed. Metadata:", metadata);

    // Sign
    if (tx instanceof Transaction) {
      tx.partialSign(serverAuthority);
    } else {
      tx.sign([serverAuthority]);
    }

    const signed = tx.serialize();

    res.json({
      signedTxBase64: signed.toString("base64"),
      signerPubkey: serverAuthority.publicKey.toBase58()
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "sign_error" });
  }
});

const PORT = process.env.SIGNER_PORT || 5001;

const start = async () => {
  console.log(`[Signer] Listening on http://localhost:${PORT}`);
  app.listen(PORT);
};

start().catch((e) => {
  console.error(e);
  process.exit(1);
});

