import dotenv from "dotenv";
dotenv.config();

import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import idl from "../../idl/phantom_paradox.json";

const RPC_URL = process.env.SOLANA_RPC_URL || process.env.RPC_URL || clusterApiUrl("devnet");
const PROGRAM_ID = new PublicKey(
  process.env.PHANTOMGRID_PROGRAM_ID || process.env.PROGRAM_ID || "8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x"
);

export const connection = new Connection(RPC_URL, {
  commitment: "confirmed"
});

export const getProvider = (conn?: Connection) => {
  const connectionToUse = conn || connection;
  const wallet = new anchor.Wallet(anchor.web3.Keypair.generate()); // read-only
  return new anchor.AnchorProvider(connectionToUse, wallet, {
    preflightCommitment: "processed"
  });
};

export const getProgram = (conn?: Connection): anchor.Program => {
  const provider = getProvider(conn);
  // Use local IDL - programId comes from IDL's "address" field
  // @ts-ignore IDL typing
  return new anchor.Program(idl as any, provider);
};

export const eventCoder = () => {
  // @ts-ignore
  return new anchor.BorshEventCoder(idl as anchor.Idl);
};

