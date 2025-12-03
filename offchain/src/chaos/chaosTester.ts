import dotenv from "dotenv";
dotenv.config();

import { getProgram, connection } from "../shared/solana";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

const ROUNDS = 100;

const airdropIfNeeded = async (kp: Keypair) => {
  const bal = await connection.getBalance(kp.publicKey);
  if (bal < 0.1 * LAMPORTS_PER_SOL) {
    const sig = await connection.requestAirdrop(
      kp.publicKey,
      0.5 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");
  }
};

const main = async () => {
  console.log("[ChaosTester] Starting devnet simulation…");

  const program = getProgram();

  for (let i = 0; i < ROUNDS; i++) {
    const player = Keypair.generate();
    await airdropIfNeeded(player);

    const provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(player),
      { preflightCommitment: "processed" }
    );
    // @ts-ignore
    program.provider = provider;

    try {
      // TODO: call your real game instructions:
      // e.g. program.methods.joinGame(...).accounts(...).rpc();
      console.log(`[ChaosTester] Round ${i + 1}/${ROUNDS}: simulate game…`);
    } catch (e) {
      console.error("[ChaosTester] Error in round", i, e);
    }
  }

  console.log("[ChaosTester] Done.");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

