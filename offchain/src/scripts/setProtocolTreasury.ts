/**
 * Set Protocol Treasury Wallet
 * 
 * Updates the protocol_treasury address in GlobalConfig to receive all protocol fees.
 * This is where dev fees go.
 * 
 * Usage:
 *   npx ts-node offchain/src/scripts/setProtocolTreasury.ts
 */

import "dotenv/config";
import { Connection, PublicKey, Keypair, clusterApiUrl } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { readFileSync } from "fs";
import { join } from "path";
import idl from "../../idl/phantom_paradox.json";

// Your fee wallet address
const PROTOCOL_TREASURY_ADDRESS = "88fuKBXZhZFUMwydHrVM1syqKNBV8gFCkh2mtBfyrD2s";

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL || process.env.RPC_URL || clusterApiUrl("devnet");
  const programIdStr = process.env.PHANTOMGRID_PROGRAM_ID || "8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x";
  const walletPath = process.env.SERVER_AUTHORITY_SECRET_KEY || "deployer_wallet.json";
  
  const connection = new Connection(rpcUrl, "confirmed");
  const programId = new PublicKey(programIdStr);
  
  // Load keypair (must be admin or governance)
  const keypairData = JSON.parse(readFileSync(walletPath, "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  
  console.log("🔐 Using wallet:", keypair.publicKey.toBase58());
  
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
  
  console.log("📋 Config PDA:", configPda.toBase58());
  
  // Check if config exists
  try {
    const configAccount = await program.account.globalConfig.fetch(configPda);
    console.log("✅ GlobalConfig found!");
    console.log("   Current protocol_treasury:", configAccount.protocolTreasury.toBase58());
    console.log("   Current admin:", configAccount.admin.toBase58());
    console.log("   Current governance:", configAccount.governance.toBase58());
    
    // Check authorization
    const isAdmin = configAccount.admin.equals(keypair.publicKey);
    const isGovernance = configAccount.governance.equals(keypair.publicKey);
    
    if (!isAdmin && !isGovernance) {
      console.error("❌ ERROR: You are not authorized to update the treasury!");
      console.error("   You must be either admin or governance wallet.");
      console.error("   Your wallet:", keypair.publicKey.toBase58());
      console.error("   Admin:", configAccount.admin.toBase58());
      console.error("   Governance:", configAccount.governance.toBase58());
      process.exit(1);
    }
    
    console.log("✅ Authorization check passed!");
    
    // Check if already set
    const newTreasury = new PublicKey(PROTOCOL_TREASURY_ADDRESS);
    if (configAccount.protocolTreasury.equals(newTreasury)) {
      console.log("✅ Protocol treasury is already set to:", PROTOCOL_TREASURY_ADDRESS);
      return;
    }
    
  } catch (error: any) {
    console.error("❌ ERROR: GlobalConfig not found or not initialized!");
    console.error("   Error:", error.message);
    console.error("   Please initialize GlobalConfig first using initGlobalConfig.ts");
    process.exit(1);
  }
  
  // Update protocol treasury
  console.log("");
  console.log("💰 Setting protocol treasury to:", PROTOCOL_TREASURY_ADDRESS);
  console.log("   (This is where all protocol fees will go)");
  
  const newTreasury = new PublicKey(PROTOCOL_TREASURY_ADDRESS);
  
  try {
    const txSig = await program.methods
      .updateConfig({
        newAdmin: null,
        newGovernance: null,
        newServer: null,
        newProtocolFeeBps: null,
        pausedNew: null,
        pausedSettlements: null,
        newFeatures: null,
        newProtocolTreasury: newTreasury, // Set the new treasury address
      })
      .accounts({
        config: configPda,
        governance: keypair.publicKey, // Must be admin or governance
        admin: keypair.publicKey, // For context
      })
      .signers([keypair])
      .rpc();
    
    console.log("");
    console.log("✅ Protocol treasury updated successfully!");
    console.log("📝 Transaction Signature:", txSig);
    console.log("🔗 View on Solscan:", `https://solscan.io/tx/${txSig}?cluster=devnet`);
    console.log("");
    console.log("💰 All protocol fees will now go to:", PROTOCOL_TREASURY_ADDRESS);
    console.log("   (Dev fees, protocol fees, π-fees from netting)");
    
  } catch (error: any) {
    console.error("❌ ERROR: Failed to update protocol treasury!");
    console.error("   Error:", error.message);
    if (error.logs) {
      console.error("   Logs:", error.logs);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

