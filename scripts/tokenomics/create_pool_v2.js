/**
 * CREATE RAYDIUM CLMM POOL - PDOX V2
 * 10 SOL + 10M PDOX
 */

const { Raydium } = require('@raydium-io/raydium-sdk-v2');
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');

// V2 TOKEN CONFIG
const PDOX_V2_MINT = new PublicKey("5673DfyfMiP2vZTAwEr7t6pwZkQk1TTyLP7R8Lw8G41B");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const DEVNET_RPC = "https://api.devnet.solana.com";

// Raydium Devnet
const DEVNET_CLMM_PROGRAM = new PublicKey("devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH");
const DEVNET_CONFIG_ID = new PublicKey("CD4aJtX11cqTCAc83nxSPkkh5JW2yjD6uwHeovjqQ1qu");

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  🚀 RAYDIUM CLMM POOL - PDOX V2");
  console.log("=".repeat(60) + "\n");
  
  const connection = new Connection(DEVNET_RPC, "confirmed");
  
  // Load wallet
  const walletData = JSON.parse(fs.readFileSync("../../deployer_wallet.json", "utf8"));
  const owner = Keypair.fromSecretKey(Uint8Array.from(walletData));
  
  console.log(`Wallet: ${owner.publicKey.toBase58()}`);
  
  const balance = await connection.getBalance(owner.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);
  
  console.log("📋 POOL PARAMETERS:");
  console.log(`  Token A (SOL):  ${WSOL.toBase58()}`);
  console.log(`  Token B (PDOX): ${PDOX_V2_MINT.toBase58()}`);
  console.log(`  Price: 1 SOL = 1,000,000 PDOX`);
  console.log(`  Fee: 0.25%\n`);
  
  try {
    console.log("🔧 Loading Raydium SDK...");
    
    const raydium = await Raydium.load({
      owner,
      connection,
      cluster: 'devnet',
      disableFeatureCheck: true,
      disableLoadToken: true,
    });
    
    console.log("✅ SDK loaded!\n");
    console.log("🔥 Creating CLMM Pool...\n");
    
    const { execute, extInfo } = await raydium.clmm.createPool({
      programId: DEVNET_CLMM_PROGRAM,
      mint1: { address: PDOX_V2_MINT, decimals: 9, programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") },
      mint2: { address: WSOL, decimals: 9 },
      ammConfig: {
        id: DEVNET_CONFIG_ID,
        index: 0,
        protocolFeeRate: 120000,
        tradeFeeRate: 2500,
        tickSpacing: 64,
        fundOwner: owner.publicKey.toBase58(),
        fundFeeRate: 0,
        description: '',
      },
      initialPrice: 0.000001, // 1 SOL = 1,000,000 PDOX
      startTime: { poolOpenTime: 0 },
    });
    
    console.log("📤 Sending transaction...\n");
    
    const { txId } = await execute();
    
    console.log("=".repeat(60));
    console.log("✅ POOL CREATED SUCCESSFULLY!");
    console.log("=".repeat(60));
    console.log(`\nTransaction: ${txId}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${txId}?cluster=devnet\n`);
    
    if (extInfo?.address) {
      console.log("📊 POOL INFO:");
      console.log(`  Pool ID: ${extInfo.address.poolId || extInfo.address.id}`);
      console.log(`  SOL Vault: ${extInfo.address.mintAVault || extInfo.address.vault?.A}`);
      console.log(`  PDOX Vault: ${extInfo.address.mintBVault || extInfo.address.vault?.B}`);
      
      // Save pool info
      fs.writeFileSync("POOL_V2_INFO.json", JSON.stringify({
        status: "SUCCESS",
        txId,
        poolId: extInfo.address.poolId || extInfo.address.id,
        pdoxMint: PDOX_V2_MINT.toBase58(),
        program: "7j4qvD77zadbvrKYmahMQbFS5f8tEseW9kj62LYuWmer",
        poolInfo: extInfo,
        createdAt: new Date().toISOString()
      }, null, 2));
      
      console.log("\n✅ Pool info saved to POOL_V2_INFO.json");
    }
    
  } catch (error) {
    console.log("\n❌ Error:", error.message);
    if (error.logs) {
      console.log("\nLogs:");
      error.logs.slice(0, 10).forEach(l => console.log("  ", l));
    }
  }
  
  const finalBalance = await connection.getBalance(owner.publicKey);
  console.log(`\n💰 Final balance: ${finalBalance / LAMPORTS_PER_SOL} SOL`);
}

main().catch(console.error);

