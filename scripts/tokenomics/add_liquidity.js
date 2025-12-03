/**
 * ADD LIQUIDITY TO RAYDIUM CLMM POOL
 * 
 * Adding 5 SOL + corresponding PDOX to the pool
 */

const { Raydium } = require('@raydium-io/raydium-sdk-v2');
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount } = require('@solana/spl-token');
const BN = require('bn.js');
const fs = require('fs');

// CONFIGURATION
const DEVNET_RPC = "https://api.devnet.solana.com";
const POOL_ID = new PublicKey("3kScidMNvzT6m5bXn8VwEP3CrzdA57DngzpDDbSn9Jvc");
const PDOX_MINT = new PublicKey("4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");

// Liquidity amounts
const SOL_AMOUNT = 5; // 5 SOL
const PDOX_AMOUNT = 100_000_000; // 100M PDOX

async function main() {
  console.log("💧 ADDING LIQUIDITY TO RAYDIUM CLMM\n");
  console.log("=".repeat(60));
  
  const connection = new Connection(DEVNET_RPC, "confirmed");
  
  // Load wallet
  const walletData = JSON.parse(fs.readFileSync("../../deployer_wallet.json", "utf8"));
  const owner = Keypair.fromSecretKey(Uint8Array.from(walletData));
  
  console.log(`Wallet: ${owner.publicKey.toBase58()}`);
  
  // Check balances
  const solBalance = await connection.getBalance(owner.publicKey);
  console.log(`SOL Balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);
  
  const pdoxAta = getAssociatedTokenAddressSync(PDOX_MINT, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);
  try {
    const pdoxAccount = await getAccount(connection, pdoxAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    console.log(`PDOX Balance: ${Number(pdoxAccount.amount) / 1e9} PDOX`);
  } catch (e) {
    console.log("PDOX ATA not found or error:", e.message);
  }
  
  console.log(`\n📋 LIQUIDITY TO ADD:`);
  console.log(`  SOL:  ${SOL_AMOUNT}`);
  console.log(`  PDOX: ${PDOX_AMOUNT.toLocaleString()}`);
  console.log(`  Pool: ${POOL_ID.toBase58()}`);
  
  console.log("\n🔧 Initializing Raydium SDK...");
  
  try {
    const raydium = await Raydium.load({
      owner,
      connection,
      cluster: 'devnet',
      disableFeatureCheck: true,
    });
    
    console.log("✅ SDK loaded!");
    
    // Get pool info
    console.log("\n📊 Fetching pool info...");
    
    const poolInfo = await raydium.clmm.getPoolInfoFromRpc(POOL_ID.toBase58());
    console.log("Pool current price:", poolInfo?.currentPrice || "N/A");
    
    // Calculate tick range for liquidity (wide range for now)
    // For CLMM, we need to specify a tick range
    const tickLower = -443636; // Wide range lower
    const tickUpper = 443636;  // Wide range upper
    
    console.log(`\n💧 Adding liquidity with tick range: [${tickLower}, ${tickUpper}]`);
    
    // Open position and add liquidity
    const { execute, extInfo } = await raydium.clmm.openPositionFromBase({
      poolInfo: poolInfo,
      ownerInfo: {
        useSOLBalance: true, // Use native SOL
      },
      tickLower,
      tickUpper,
      base: 'MintA', // Base on SOL amount
      baseAmount: new BN(SOL_AMOUNT * LAMPORTS_PER_SOL),
      otherAmountMax: new BN(PDOX_AMOUNT * 1e9 * 1.1), // 10% slippage
    });
    
    console.log("\n📤 Sending transaction...");
    
    const { txId } = await execute();
    
    console.log("\n" + "=".repeat(60));
    console.log("✅ LIQUIDITY ADDED SUCCESSFULLY!");
    console.log("=".repeat(60));
    console.log(`\nTransaction: ${txId}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${txId}?cluster=devnet`);
    
    if (extInfo) {
      console.log(`\nPosition Info:`, JSON.stringify(extInfo, null, 2));
    }
    
    // Save result
    fs.writeFileSync("LIQUIDITY_ADDED.json", JSON.stringify({
      status: "SUCCESS",
      txId,
      poolId: POOL_ID.toBase58(),
      solAmount: SOL_AMOUNT,
      pdoxAmount: PDOX_AMOUNT,
      tickLower,
      tickUpper,
      positionInfo: extInfo,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    console.log("\n✅ Result saved to LIQUIDITY_ADDED.json");
    
  } catch (error) {
    console.log("\n❌ Error:", error.message);
    
    if (error.logs) {
      console.log("\nProgram Logs:");
      error.logs.forEach(log => console.log("  ", log));
    }
    
    // Try simpler approach - just check what's available
    console.log("\n🔄 Checking available methods...");
    
    try {
      const raydium = await Raydium.load({
        owner,
        connection,
        cluster: 'devnet',
        disableFeatureCheck: true,
      });
      
      console.log("\nCLMM methods:", Object.keys(raydium.clmm).filter(k => typeof raydium.clmm[k] === 'function').slice(0, 20).join(', '));
    } catch (e) {
      console.log("SDK error:", e.message);
    }
    
    // Save error
    fs.writeFileSync("LIQUIDITY_ERROR.json", JSON.stringify({
      status: "FAILED", 
      error: error.message,
      logs: error.logs || [],
      timestamp: new Date().toISOString()
    }, null, 2));
  }
  
  // Check final balance
  const finalBalance = await connection.getBalance(owner.publicKey);
  console.log(`\n💰 Final SOL Balance: ${finalBalance / LAMPORTS_PER_SOL} SOL`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

