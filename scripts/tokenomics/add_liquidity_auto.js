/**
 * AUTO ADD LIQUIDITY - Checks every minute until pool is indexed
 * Then adds 10 SOL + 10M PDOX
 */

const { Raydium } = require('@raydium-io/raydium-sdk-v2');
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, createSyncNativeInstruction, createAssociatedTokenAccountInstruction, NATIVE_MINT, getAccount } = require('@solana/spl-token');
const fs = require('fs');
const BN = require('bn.js');

// CONFIG
const PDOX_V2_MINT = new PublicKey("5673DfyfMiP2vZTAwEr7t6pwZkQk1TTyLP7R8Lw8G41B");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const POOL_ID = new PublicKey("DKdARvMSzUaFhRELRxe323xQvohqdVGnHHbtr8CbPSDU");
const DEVNET_RPC = "https://api.devnet.solana.com";
const DEVNET_CLMM_PROGRAM = new PublicKey("devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH");

const CHECK_INTERVAL_MS = 60000; // 1 minute
const MAX_ATTEMPTS = 30; // Give up after 30 minutes

let attempt = 0;

async function checkAndAddLiquidity() {
  attempt++;
  const timestamp = new Date().toLocaleTimeString();
  
  console.log(`\n[${timestamp}] Attempt ${attempt}/${MAX_ATTEMPTS} - Checking pool availability...`);
  
  const connection = new Connection(DEVNET_RPC, "confirmed");
  
  // Load wallet
  const walletData = JSON.parse(fs.readFileSync("../../deployer_wallet.json", "utf8"));
  const owner = Keypair.fromSecretKey(Uint8Array.from(walletData));
  
  try {
    console.log("🔧 Loading Raydium SDK...");
    
    const raydium = await Raydium.load({
      owner,
      connection,
      cluster: 'devnet',
      disableFeatureCheck: true,
      disableLoadToken: true,
    });
    
    console.log("📡 Fetching pool info...");
    
    // Try to get pool info
    const poolInfo = await raydium.clmm.getPoolInfoFromRpc(POOL_ID.toBase58());
    
    if (!poolInfo || !poolInfo.poolInfo) {
      console.log("⏳ Pool not indexed yet. Will retry in 1 minute...");
      return false;
    }
    
    console.log("✅ Pool found! Adding liquidity now...\n");
    
    // Check wSOL balance
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, owner.publicKey);
    let wsolBalance = 0;
    try {
      const wsolAccount = await getAccount(connection, wsolAta);
      wsolBalance = Number(wsolAccount.amount) / LAMPORTS_PER_SOL;
      console.log(`wSOL Balance: ${wsolBalance} SOL`);
    } catch (e) {
      console.log("No wSOL account found, will wrap SOL first...");
    }
    
    // If not enough wSOL, wrap more
    if (wsolBalance < 10) {
      console.log("🔄 Wrapping SOL to wSOL...");
      const solBalance = await connection.getBalance(owner.publicKey);
      const solToWrap = Math.min(10, (solBalance / LAMPORTS_PER_SOL) - 0.5); // Leave 0.5 for fees
      
      if (solToWrap < 5) {
        console.log(`❌ Not enough SOL. Have ${solBalance / LAMPORTS_PER_SOL}, need at least 5.5`);
        return false;
      }
      
      const wrapTx = new Transaction();
      
      // Check if wSOL account exists
      const wsolAccountInfo = await connection.getAccountInfo(wsolAta);
      if (!wsolAccountInfo) {
        wrapTx.add(
          createAssociatedTokenAccountInstruction(
            owner.publicKey,
            wsolAta,
            owner.publicKey,
            NATIVE_MINT
          )
        );
      }
      
      wrapTx.add(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: wsolAta,
          lamports: Math.floor(solToWrap * LAMPORTS_PER_SOL),
        }),
        createSyncNativeInstruction(wsolAta)
      );
      
      const wrapSig = await sendAndConfirmTransaction(connection, wrapTx, [owner]);
      console.log(`✅ Wrapped ${solToWrap.toFixed(4)} SOL → wSOL`);
      wsolBalance = solToWrap;
    }
    
    // Check PDOX balance
    const pdoxAta = getAssociatedTokenAddressSync(PDOX_V2_MINT, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const pdoxBalance = await connection.getTokenAccountBalance(pdoxAta);
    console.log(`PDOX Balance: ${pdoxBalance.value.uiAmount.toLocaleString()} PDOX`);
    
    // Calculate amounts
    const SOL_AMOUNT = Math.min(10, wsolBalance);
    const PDOX_AMOUNT = 10_000_000;
    
    console.log(`\n📋 ADDING LIQUIDITY:`);
    console.log(`   SOL:  ${SOL_AMOUNT}`);
    console.log(`   PDOX: ${PDOX_AMOUNT.toLocaleString()}\n`);
    
    // Wide tick range for initial liquidity
    const tickLower = -443636;
    const tickUpper = 443636;
    
    console.log("🔥 Opening position...");
    
    const { execute, extInfo } = await raydium.clmm.openPositionFromBase({
      poolInfo: poolInfo.poolInfo,
      ownerInfo: {
        useSOLBalance: false,
      },
      tickLower,
      tickUpper,
      base: 'MintA',
      baseAmount: new BN(PDOX_AMOUNT).mul(new BN(10).pow(new BN(9))),
      otherAmountMax: new BN(SOL_AMOUNT * 2).mul(new BN(LAMPORTS_PER_SOL)),
    });
    
    console.log("📤 Sending transaction...\n");
    
    const { txId } = await execute();
    
    console.log("=".repeat(60));
    console.log("✅ LIQUIDITY ADDED SUCCESSFULLY!");
    console.log("=".repeat(60));
    console.log(`\nTransaction: ${txId}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${txId}?cluster=devnet\n`);
    
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
    
    console.log("✅ Saved to LIQUIDITY_V2_INFO.json");
    
    return true; // Success!
    
  } catch (error) {
    if (error.message.includes('fetch pool info error')) {
      console.log("⏳ Pool not indexed yet. Will retry in 1 minute...");
    } else {
      console.log(`❌ Error: ${error.message}`);
      if (error.logs) {
        console.log("Logs:", error.logs.slice(0, 5).join('\n'));
      }
    }
    return false;
  }
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  🔄 AUTO LIQUIDITY ADDER");
  console.log("  Checking every minute until pool is ready");
  console.log("=".repeat(60) + "\n");
  
  console.log(`Pool: ${POOL_ID.toBase58()}`);
  console.log(`Will add: 10 SOL + 10M PDOX`);
  console.log(`Max wait: ${MAX_ATTEMPTS} minutes\n`);
  
  // First attempt immediately
  const success = await checkAndAddLiquidity();
  
  if (success) {
    console.log("\n🎉 Done! Liquidity added successfully.");
    process.exit(0);
  }
  
  // Set up interval for subsequent attempts
  const interval = setInterval(async () => {
    const success = await checkAndAddLiquidity();
    
    if (success) {
      clearInterval(interval);
      console.log("\n🎉 Done! Liquidity added successfully.");
      process.exit(0);
    }
    
    if (attempt >= MAX_ATTEMPTS) {
      clearInterval(interval);
      console.log("\n❌ Max attempts reached. Try again later or add liquidity manually.");
      process.exit(1);
    }
  }, CHECK_INTERVAL_MS);
  
  // Handle Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log("\n\n⏹️ Stopped. You can restart anytime.");
    process.exit(0);
  });
}

main();

