/**
 * Enable ZK Privacy Feature in GlobalConfig
 * 
 * This script enables the ZK_LIGHT feature flag in the GlobalConfig,
 * allowing create_zk_listing instructions to be called.
 * 
 * Usage:
 *   npm run enable:zk
 *   OR
 *   npx ts-node src/scripts/enableZkFeature.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PhantomParadox } from "../idl/phantom_paradox";
import { PublicKey, Keypair } from "@solana/web3.js";
import { readFileSync } from "fs";
import { join } from "path";

// Load IDL
const idlPath = join(__dirname, "../../idl/phantom_paradox.json");
const idl = JSON.parse(readFileSync(idlPath, "utf-8"));

// Constants
const FEATURE_ZK_LIGHT = 1n << 1n; // Bit 1

async function main() {
  console.log("🔒 Enabling ZK Privacy Feature...\n");

  // Setup connection
  const connection = new anchor.web3.Connection(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    "confirmed"
  );

  // Load wallet
  const walletPath = process.env.WALLET_PATH || join(__dirname, "../../../deployer_wallet.json");
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(readFileSync(walletPath, "utf-8")))
  );

  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  anchor.setProvider(provider);

  // Load program
  const programId = new PublicKey(idl.metadata.address);
  const program = new Program(idl as any, programId, provider);

  console.log("📋 Configuration:");
  console.log("   Program ID:", programId.toBase58());
  console.log("   Wallet:", wallet.publicKey.toBase58());
  console.log("   Network:", connection.rpcEndpoint);
  console.log("");

  // Derive GlobalConfig PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );

  console.log("🔍 Fetching GlobalConfig...");
  let config;
  try {
    config = await program.account.globalConfig.fetch(configPda);
    console.log("✅ GlobalConfig found");
    console.log("   Current features:", config.features.toString());
  } catch (error) {
    console.error("❌ GlobalConfig not found. Please initialize it first.");
    console.error("   Run: npm run init:config");
    process.exit(1);
  }

  // Check if ZK feature is already enabled
  const currentFeatures = BigInt(config.features.toString());
  const zkEnabled = (currentFeatures & FEATURE_ZK_LIGHT) !== 0n;

  if (zkEnabled) {
    console.log("✅ ZK Privacy feature is already enabled!");
    console.log("   Features:", currentFeatures.toString());
    return;
  }

  // Enable ZK feature
  console.log("🔓 Enabling ZK Privacy feature...");
  const newFeatures = currentFeatures | FEATURE_ZK_LIGHT;

  try {
    const txSig = await program.methods
      .updateConfig({
        newAdmin: null,
        newGovernance: null,
        newServer: null,
        newProtocolFeeBps: null,
        pausedNew: null,
        pausedSettlements: null,
        newFeatures: new anchor.BN(newFeatures.toString()),
        newProtocolTreasury: null,
      })
      .accounts({
        config: configPda,
        governance: wallet.publicKey, // Must be governance or admin
      })
      .signers([walletKeypair])
      .rpc();

    console.log("✅ ZK Privacy feature enabled!");
    console.log("   Transaction:", txSig);
    console.log("   New features:", newFeatures.toString());
    console.log("");
    console.log("🚀 ZK Privacy is now ACTIVE!");
    console.log("   You can now call create_zk_listing instructions.");
  } catch (error) {
    console.error("❌ Failed to enable ZK feature:");
    console.error(error);
    
    // Try alternative method if updateConfig doesn't support features
    console.log("\n⚠️  Trying alternative method...");
    console.log("   You may need to use update_config instruction directly");
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log("\n✅ Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });

