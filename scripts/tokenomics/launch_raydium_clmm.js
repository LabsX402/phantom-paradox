/**
 * 🚀 RAYDIUM CLMM POOL LAUNCH - DEVNET
 * 
 * Pivoting from Meteora (Token-2022 not supported on devnet)
 * to Raydium CLMM which supports Token-2022!
 */

const { Raydium } = require('@raydium-io/raydium-sdk-v2');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const fs = require('fs');

// CONFIGURATION
const DEVNET_RPC = "https://api.devnet.solana.com";
const PDOX_MINT = new PublicKey("4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const USDC_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

// RAYDIUM DEVNET ADDRESSES
const DEVNET_CLMM_PROGRAM = new PublicKey("devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH");
const DEVNET_CONFIG_ID = new PublicKey("CD4aJtX11cqTCAc83nxSPkkh5JW2yjD6uwHeovjqQ1qu");

async function main() {
  console.log("🚀 RAYDIUM CLMM POOL LAUNCH\n");
  console.log("=".repeat(60));
  
  const connection = new Connection(DEVNET_RPC, "confirmed");
  
  // Load wallet
  const walletData = JSON.parse(fs.readFileSync("../../deployer_wallet.json", "utf8"));
  const owner = Keypair.fromSecretKey(Uint8Array.from(walletData));
  
  console.log(`Wallet: ${owner.publicKey.toBase58()}`);
  
  const balance = await connection.getBalance(owner.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);
  
  console.log("\n📋 POOL PARAMETERS:");
  console.log(`  Token 1 (PDOX): ${PDOX_MINT.toBase58()}`);
  console.log(`  Token 2 (SOL):  ${WSOL.toBase58()}`);
  console.log("  Initial Price: 0.00000005 (1 SOL = 20M PDOX)");
  console.log("  Tick Spacing: 64 (standard)");
  
  console.log("\n🔧 Initializing Raydium SDK...");
  
  try {
    const raydium = await Raydium.load({
      owner,
      connection,
      cluster: 'devnet',
      disableFeatureCheck: true,
      disableLoadToken: true,
    });
    
    console.log("✅ Raydium SDK loaded!");
    
    console.log("\n🔥 Creating CLMM Pool...\n");
    
    // Create pool
    const { execute, extInfo } = await raydium.clmm.createPool({
      programId: DEVNET_CLMM_PROGRAM,
      mint1: { address: PDOX_MINT, decimals: 9, programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") },
      mint2: { address: WSOL, decimals: 9 },
      ammConfig: {
        id: DEVNET_CONFIG_ID,
        index: 0,
        protocolFeeRate: 120000,
        tradeFeeRate: 2500,  // 0.25%
        tickSpacing: 64,
        fundOwner: owner.publicKey.toBase58(),
        fundFeeRate: 0,
        description: '',
      },
      initialPrice: 0.00000005, // 1 SOL = 20M PDOX
      startTime: { poolOpenTime: 0 },
    });
    
    console.log("📤 Sending transaction...");
    
    const { txId } = await execute();
    
    console.log("\n" + "=".repeat(60));
    console.log("✅ POOL CREATED SUCCESSFULLY!");
    console.log("=".repeat(60));
    console.log(`\nTransaction: ${txId}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${txId}?cluster=devnet`);
    
    if (extInfo) {
      console.log(`\nPool Info:`, JSON.stringify(extInfo, null, 2));
    }
    
    // Save result
    fs.writeFileSync("RAYDIUM_POOL_CREATED.json", JSON.stringify({
      status: "SUCCESS",
      txId,
      poolInfo: extInfo,
      pdoxMint: PDOX_MINT.toBase58(),
      quoteMint: WSOL.toBase58(),
      network: "devnet",
      timestamp: new Date().toISOString()
    }, null, 2));
    
    console.log("\n✅ Pool info saved to RAYDIUM_POOL_CREATED.json");
    
  } catch (error) {
    console.log("\n❌ Error:", error.message);
    
    if (error.logs) {
      console.log("\nProgram Logs:");
      error.logs.forEach(log => console.log("  ", log));
    }
    
    // Try alternative approach
    console.log("\n🔄 Trying alternative SDK methods...");
    
    // Check available methods
    try {
      const raydium = await Raydium.load({
        owner,
        connection,
        cluster: 'devnet',
        disableFeatureCheck: true,
      });
      
      console.log("\nAvailable CLMM methods:");
      if (raydium.clmm) {
        console.log(Object.keys(raydium.clmm).filter(k => typeof raydium.clmm[k] === 'function').join(', '));
      }
    } catch (e) {
      console.log("SDK error:", e.message);
    }
    
    // Save error
    fs.writeFileSync("RAYDIUM_POOL_ERROR.json", JSON.stringify({
      status: "FAILED",
      error: error.message,
      logs: error.logs || [],
      timestamp: new Date().toISOString()
    }, null, 2));
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

