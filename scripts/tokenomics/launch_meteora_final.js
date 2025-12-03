/**
 * METEORA DEVNET POOL LAUNCH - FINAL VERSION (JavaScript)
 * 
 * Using correct parameters for Token-2022 with 3% transfer fee:
 * - Bin Step: 100 (1%) - Required for high-fee tokens
 * - Base Fee: 100 (1%)
 */

const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const DLMM = require("@meteora-ag/dlmm");
const { Wallet } = require("@project-serum/anchor");
const BN = require("bn.js");
const fs = require("fs");

// CONFIGURATION
const DEVNET_RPC = "https://api.devnet.solana.com";
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
  console.log("  Cluster: devnet");
  
  // Check what methods are available
  console.log("\n🔍 Checking DLMM SDK methods...");
  const dlmmMethods = Object.keys(DLMM.default || DLMM);
  console.log("Available:", dlmmMethods.slice(0, 10).join(", "), "...");
  
  const DLMMClass = DLMM.default || DLMM;
  
  console.log("\n🔥 ATTEMPTING POOL CREATION...\n");
  
  try {
    // Try createLbPair method (newer SDK)
    if (typeof DLMMClass.createLbPair === 'function') {
      console.log("Using createLbPair method...");
      
      const createTx = await DLMMClass.createLbPair(
        connection,
        wallet.publicKey,
        PDOX_MINT,
        WSOL,
        new BN(100), // binStep as BN
        { cluster: "devnet" }
      );
      
      if (createTx) {
        console.log("Transaction created, sending...");
        const sig = await sendAndConfirmTransaction(connection, createTx, [keypair]);
        console.log("✅ Pool created! TX:", sig);
      }
    } 
    // Try create method
    else if (typeof DLMMClass.create === 'function') {
      console.log("Using create method...");
      
      const result = await DLMMClass.create(
        connection,
        keypair,
        PDOX_MINT,
        WSOL,
        new BN(100),  // binStep
        new BN(100),  // baseFee
        new BN(0),    // activeId
        { cluster: "devnet" }
      );
      
      console.log("✅ Result:", result);
    }
    // Try createPermissionlessLbPair
    else if (typeof DLMMClass.createPermissionlessLbPair === 'function') {
      console.log("Using createPermissionlessLbPair...");
      
      const result = await DLMMClass.createPermissionlessLbPair(
        connection,
        new BN(100), // binStep
        PDOX_MINT,
        WSOL,
        new BN(0), // activeId
        keypair,
        { cluster: "devnet" }
      );
      
      console.log("✅ Result:", result);
    }
    else {
      console.log("❌ No suitable create method found in SDK");
      console.log("\nAvailable methods:");
      for (const key of Object.keys(DLMMClass)) {
        if (typeof DLMMClass[key] === 'function') {
          console.log(`  - ${key}`);
        }
      }
    }
    
  } catch (error) {
    console.log("\n❌ Error:", error.message || error);
    
    if (error.logs) {
      console.log("\nProgram logs:");
      error.logs.forEach(log => console.log("  ", log));
    }
    
    // Save error details
    fs.writeFileSync("PDOX_POOL_ERROR.json", JSON.stringify({
      status: "FAILED",
      error: error.message || String(error),
      logs: error.logs || [],
      timestamp: new Date().toISOString()
    }, null, 2));
  }
  
  console.log("\n" + "=".repeat(60));
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

