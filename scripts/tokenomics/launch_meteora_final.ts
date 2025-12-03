/**
 * METEORA DEVNET POOL LAUNCH - FINAL VERSION
 * 
 * Using correct parameters for Token-2022 with 3% transfer fee:
 * - Bin Step: 100 (1%) - Required for high-fee tokens
 * - Base Fee: 100 (1%)
 * - Cluster: devnet
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";
import { Wallet } from "@project-serum/anchor";
import BN from "bn.js";
import * as fs from "fs";

// CONFIGURATION
const DEVNET_RPC = "https://api.devnet.solana.com";
const USDC_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const PDOX_MINT = new PublicKey("4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");

async function main() {
  console.log("🚀 METEORA DEVNET POOL LAUNCH\n");
  console.log("=".repeat(60));
  
  const connection = new Connection(DEVNET_RPC, "confirmed");
  
  // Load wallet
  const walletData = JSON.parse(fs.readFileSync("../../deployer_wallet.json", "utf8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(walletData));
  const wallet = new Wallet(keypair);
  
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);
  
  console.log("\n📋 POOL PARAMETERS:");
  console.log(`  Token X (PDOX): ${PDOX_MINT.toBase58()}`);
  console.log(`  Token Y (wSOL): ${WSOL.toBase58()}`);
  console.log("  Bin Step: 100 bps (1%) - Safe for 3% transfer fee");
  console.log("  Base Fee: 100 bps (1%)");
  console.log("  Active Bin ID: 100000 (initial price point)");
  console.log("  Cluster: devnet");
  
  console.log("\n🔥 CREATING POOL...\n");
  
  try {
    // Create the pool using DLMM.create
    // @ts-ignore - SDK type issues
    const poolKey = await DLMM.create(
      connection,
      wallet.payer,
      PDOX_MINT,      // Token X (your token)
      WSOL,           // Token Y (SOL)
      new BN(100),    // Bin Step: 100 bps (1%) - CRUCIAL for 3% fee token
      new BN(100),    // Base Fee: 100 bps (1%)
      new BN(100000), // Active Bin ID (initial price)
      { cluster: "devnet" } // Force devnet
    );
    
    console.log("✅ SUCCESS! Pool Created!");
    console.log(`Pool Address: ${poolKey.toString()}`);
    console.log(`\nView on Solscan: https://solscan.io/account/${poolKey.toString()}?cluster=devnet`);
    
    // Save result
    const result = {
      status: "SUCCESS",
      poolAddress: poolKey.toString(),
      tokenX: PDOX_MINT.toBase58(),
      tokenY: WSOL.toBase58(),
      binStep: 100,
      baseFee: 100,
      network: "devnet",
      createdAt: new Date().toISOString(),
      solscan: `https://solscan.io/account/${poolKey.toString()}?cluster=devnet`
    };
    
    fs.writeFileSync("PDOX_POOL_CREATED.json", JSON.stringify(result, null, 2));
    console.log("\n✅ Result saved to PDOX_POOL_CREATED.json");
    
  } catch (error: any) {
    console.log("❌ Pool creation failed:");
    console.log(error.message || error);
    
    if (error.message?.includes("Config Unavailable")) {
      console.log("\n⚠️ CONFIG UNAVAILABLE ERROR");
      console.log("This means the BinStep/Fee combo isn't available on devnet.");
      console.log("Try these safe presets:");
      console.log("  - Bin Step: 10 / Fee: 5 (stable)");
      console.log("  - Bin Step: 100 / Fee: 100 (volatile) ← Current");
    }
    
    // Save error
    fs.writeFileSync("PDOX_POOL_ERROR.json", JSON.stringify({
      status: "FAILED",
      error: error.message || String(error),
      params: { binStep: 100, baseFee: 100, activeId: 100000 },
      timestamp: new Date().toISOString()
    }, null, 2));
  }
}

main().catch(console.error);

