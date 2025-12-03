/**
 * ADD LIQUIDITY TO RAYDIUM CLMM POOL - PDOX V2
 * 10 SOL + 10M PDOX
 */

const { Raydium } = require('@raydium-io/raydium-sdk-v2');
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, createSyncNativeInstruction, createAssociatedTokenAccountInstruction, NATIVE_MINT } = require('@solana/spl-token');
const fs = require('fs');
const BN = require('bn.js');

// V2 TOKEN CONFIG
const PDOX_V2_MINT = new PublicKey("5673DfyfMiP2vZTAwEr7t6pwZkQk1TTyLP7R8Lw8G41B");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const POOL_ID = new PublicKey("DKdARvMSzUaFhRELRxe323xQvohqdVGnHHbtr8CbPSDU");
const DEVNET_RPC = "https://api.devnet.solana.com";

// Raydium Devnet
const DEVNET_CLMM_PROGRAM = new PublicKey("devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH");

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  💧 ADD LIQUIDITY - PDOX V2 POOL");
  console.log("=".repeat(60) + "\n");
  
  const connection = new Connection(DEVNET_RPC, "confirmed");
  
  // Load wallet
  const walletData = JSON.parse(fs.readFileSync("../../deployer_wallet.json", "utf8"));
  const owner = Keypair.fromSecretKey(Uint8Array.from(walletData));
  
  console.log(`Wallet: ${owner.publicKey.toBase58()}`);
  
  const balance = await connection.getBalance(owner.publicKey);
  console.log(`SOL Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  // Get PDOX balance
  const pdoxAta = getAssociatedTokenAddressSync(PDOX_V2_MINT, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const pdoxBalance = await connection.getTokenAccountBalance(pdoxAta);
  console.log(`PDOX Balance: ${pdoxBalance.value.uiAmount.toLocaleString()} PDOX\n`);
  
  // Liquidity amounts
  const SOL_AMOUNT = 10; // 10 SOL
  const PDOX_AMOUNT = 10_000_000; // 10M PDOX
  
  console.log("📋 LIQUIDITY TO ADD:");
  console.log(`  SOL:  ${SOL_AMOUNT}`);
  console.log(`  PDOX: ${PDOX_AMOUNT.toLocaleString()}\n`);
  
  try {
    console.log("🔧 Loading Raydium SDK...");
    
    const raydium = await Raydium.load({
      owner,
      connection,
      cluster: 'devnet',
      disableFeatureCheck: true,
      disableLoadToken: true,
    });
    
    console.log("✅ SDK loaded!");
    
    // First wrap SOL to wSOL
    console.log("\n🔄 Wrapping SOL to wSOL...");
    
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, owner.publicKey);
    
    // Check if wSOL account exists
    const wsolAccount = await connection.getAccountInfo(wsolAta);
    
    const wrapTx = new Transaction();
    
    if (!wsolAccount) {
      wrapTx.add(
        createAssociatedTokenAccountInstruction(
          owner.publicKey,
          wsolAta,
          owner.publicKey,
          NATIVE_MINT
        )
      );
    }
    
    // Transfer SOL to wSOL ATA and sync
    wrapTx.add(
      SystemProgram.transfer({
        fromPubkey: owner.publicKey,
        toPubkey: wsolAta,
        lamports: SOL_AMOUNT * LAMPORTS_PER_SOL,
      }),
      createSyncNativeInstruction(wsolAta)
    );
    
    const wrapSig = await sendAndConfirmTransaction(connection, wrapTx, [owner]);
    console.log(`✅ Wrapped ${SOL_AMOUNT} SOL -> wSOL`);
    console.log(`   TX: ${wrapSig}\n`);
    
    // Now add liquidity
    console.log("🔥 Opening position and adding liquidity...\n");
    
    // Fetch pool info
    const poolInfo = await raydium.clmm.getPoolInfoFromRpc(POOL_ID.toBase58());
    console.log("Pool current tick:", poolInfo.poolInfo.currentPrice);
    
    // Calculate tick range (wide range for initial liquidity)
    const tickLower = -443636; // Very low price
    const tickUpper = 443636;  // Very high price
    
    const { execute, extInfo } = await raydium.clmm.openPositionFromBase({
      poolInfo: poolInfo.poolInfo,
      ownerInfo: {
        useSOLBalance: false, // We wrapped to wSOL already
      },
      tickLower,
      tickUpper,
      base: 'MintA', // Base on PDOX (MintA)
      baseAmount: new BN(PDOX_AMOUNT).mul(new BN(10).pow(new BN(9))), // 10M PDOX with decimals
      otherAmountMax: new BN(SOL_AMOUNT).mul(new BN(LAMPORTS_PER_SOL)).mul(new BN(2)), // Allow up to 2x slippage
    });
    
    console.log("📤 Sending transaction...\n");
    
    const { txId } = await execute();
    
    console.log("=".repeat(60));
    console.log("✅ LIQUIDITY ADDED SUCCESSFULLY!");
    console.log("=".repeat(60));
    console.log(`\nTransaction: ${txId}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${txId}?cluster=devnet\n`);
    
    if (extInfo?.nftMint) {
      console.log("📊 POSITION INFO:");
      console.log(`  NFT Mint: ${extInfo.nftMint}`);
    }
    
    // Save info
    fs.writeFileSync("../../LIQUIDITY_V2_INFO.json", JSON.stringify({
      status: "SUCCESS",
      txId,
      poolId: POOL_ID.toBase58(),
      solAdded: SOL_AMOUNT,
      pdoxAdded: PDOX_AMOUNT,
      positionInfo: extInfo,
      createdAt: new Date().toISOString()
    }, null, 2));
    
    console.log("✅ Liquidity info saved to LIQUIDITY_V2_INFO.json");
    
  } catch (error) {
    console.log("\n❌ Error:", error.message);
    console.log("\nFull error:", error);
    if (error.logs) {
      console.log("\nLogs:");
      error.logs.forEach(l => console.log("  ", l));
    }
  }
  
  const finalBalance = await connection.getBalance(owner.publicKey);
  console.log(`\n💰 Final balance: ${finalBalance / LAMPORTS_PER_SOL} SOL`);
}

main().catch(console.error);
