/**
 * METEORA POOL LAUNCH - CORRECT SDK SIGNATURE
 */

const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const DLMM = require("@meteora-ag/dlmm");
const BN = require("bn.js");
const fs = require("fs");

const DEVNET_RPC = "https://api.devnet.solana.com";
const PDOX_MINT = new PublicKey("4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");

async function main() {
  console.log("🚀 METEORA POOL LAUNCH v2\n");
  
  const connection = new Connection(DEVNET_RPC, "confirmed");
  
  const walletData = JSON.parse(fs.readFileSync("../../deployer_wallet.json", "utf8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(walletData));
  
  console.log(`Wallet: ${keypair.publicKey.toBase58()}`);
  
  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL\n`);
  
  const DLMMClass = DLMM.default || DLMM;
  
  // Parameters for Token-2022 with 3% fee
  const binStep = new BN(100);      // 100 bps = 1%
  const baseFactor = new BN(10000); // Base factor (10000 = standard)
  const presetParameter = new BN(0); // Preset param index
  const activeId = new BN(0);        // Active bin ID
  
  console.log("📋 Parameters:");
  console.log("  Bin Step:", binStep.toString(), "(1%)");
  console.log("  Base Factor:", baseFactor.toString());
  console.log("  Active ID:", activeId.toString());
  
  console.log("\n🔥 Creating pool...\n");
  
  try {
    // createLbPair(connection, funder, tokenX, tokenY, binStep, baseFactor, presetParameter, activeId, opt)
    const result = await DLMMClass.createLbPair(
      connection,
      keypair.publicKey,  // funder
      PDOX_MINT,          // tokenX
      WSOL,               // tokenY  
      binStep,            // binStep
      baseFactor,         // baseFactor
      presetParameter,    // presetParameter
      activeId,           // activeId
      { cluster: "devnet" }
    );
    
    console.log("✅ SUCCESS!");
    console.log("Result:", result);
    
    // Save result
    fs.writeFileSync("POOL_CREATED.json", JSON.stringify({
      status: "SUCCESS",
      result: result?.toString?.() || result,
      timestamp: new Date().toISOString()
    }, null, 2));
    
  } catch (error) {
    console.log("❌ Error:", error.message);
    
    if (error.logs) {
      console.log("\nLogs:");
      error.logs.forEach(l => console.log("  ", l));
    }
    
    // Save error for debugging
    fs.writeFileSync("POOL_ERROR.json", JSON.stringify({
      error: error.message,
      logs: error.logs || [],
      timestamp: new Date().toISOString()
    }, null, 2));
  }
}

main().catch(console.error);

