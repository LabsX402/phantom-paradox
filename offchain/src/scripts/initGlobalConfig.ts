/**
 * Initialize GlobalConfig on-chain (one-time setup)
 */

import "dotenv/config";
import { Connection, PublicKey, Keypair, clusterApiUrl } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { readFileSync } from "fs";
import { join } from "path";
import idl from "../../idl/phantom_paradox.json";

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL || process.env.RPC_URL || clusterApiUrl("devnet");
  const programIdStr = process.env.PHANTOMGRID_PROGRAM_ID || "8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x";
  const walletPath = process.env.SERVER_AUTHORITY_SECRET_KEY || "C:/Users/saulius/source/repos/zeronode_engine/deployer_wallet.json";
  
  const connection = new Connection(rpcUrl, "confirmed");
  const programId = new PublicKey(programIdStr);
  
  // Load keypair
  const keypairData = JSON.parse(readFileSync(walletPath, "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  
  console.log("Admin pubkey:", keypair.publicKey.toBase58());
  
  // Create provider
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  
  // Create program
  const program = new anchor.Program(idl as any, provider);
  
  // Derive GlobalConfig PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
  
  console.log("Config PDA:", configPda.toBase58());
  
  // Check if already initialized (try to fetch account data directly)
  try {
    const accountInfo = await connection.getAccountInfo(configPda);
    if (accountInfo && accountInfo.data.length > 0) {
      console.log("✅ GlobalConfig already initialized!");
      console.log("Account exists at:", configPda.toBase58());
      return;
    }
  } catch (e) {
    // Continue
  }
  console.log("GlobalConfig not initialized, proceeding...");
  
  // Initialize
  console.log("Initializing GlobalConfig...");
  const governance = keypair.publicKey; // Use same key for governance
  const serverAuthority = keypair.publicKey; // Use same key for server authority
  const protocolFeeBps = 100; // 1%
  
  const txSig = await program.methods
    .initConfig(governance, serverAuthority, protocolFeeBps)
    .accounts({
      config: configPda,
      admin: keypair.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([keypair])
    .rpc();
  
  console.log("✅ GlobalConfig initialized!");
  console.log("TX Signature:", txSig);
  console.log("View on Solscan:", `https://solscan.io/tx/${txSig}?cluster=devnet`);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

