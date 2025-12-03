/**
 * DIRECT POOL CREATION - Meteora DLMM (JavaScript)
 * 5 SOL + 100M PDOX (10% of supply)
 */

const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount } = require("@solana/spl-token");
const DLMM = require("@meteora-ag/dlmm").default;
const fs = require("fs");

const RPC = "https://api.devnet.solana.com";
const PDOX_MINT = new PublicKey("4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");

async function main() {
  console.log("🚀 METEORA POOL CREATION\n");
  
  const connection = new Connection(RPC, "confirmed");
  
  // Load wallet
  const walletData = JSON.parse(fs.readFileSync("../../deployer_wallet.json", "utf8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(walletData));
  
  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`SOL: ${balance / LAMPORTS_PER_SOL}`);
  
  // Check PDOX
  const pdoxAta = getAssociatedTokenAddressSync(PDOX_MINT, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  try {
    const pdoxAccount = await getAccount(connection, pdoxAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    console.log(`PDOX: ${Number(pdoxAccount.amount) / 1e9}`);
  } catch (e) {
    console.log("PDOX: Error fetching balance");
  }
  
  console.log("\n📋 POOL PARAMS:");
  console.log("  SOL: 5");
  console.log("  PDOX: 100,000,000 (10% of supply)");
  console.log("  Price: 1 SOL = 20M PDOX");
  
  console.log("\n🔍 Checking for existing PDOX pools...");
  
  try {
    // Get all pools and check for PDOX
    const pools = await DLMM.getLbPairs(connection);
    console.log(`Found ${pools.length} DLMM pools total`);
    
    // Find PDOX pool
    const pdoxPool = pools.find((p) => {
      try {
        const mintX = p.tokenXMint?.toBase58?.() || "";
        const mintY = p.tokenYMint?.toBase58?.() || "";
        return mintX === PDOX_MINT.toBase58() || mintY === PDOX_MINT.toBase58();
      } catch {
        return false;
      }
    });
    
    if (pdoxPool) {
      console.log("\n✅ FOUND EXISTING PDOX POOL!");
      console.log(`Pool: ${pdoxPool.publicKey?.toBase58?.() || "unknown"}`);
      
      fs.writeFileSync("PDOX_POOL_LIVE.json", JSON.stringify({
        status: "EXISTING_POOL",
        pool: pdoxPool.publicKey?.toBase58?.() || "unknown",
        network: "devnet",
        foundAt: new Date().toISOString()
      }, null, 2));
      
      return;
    }
    
    console.log("No existing PDOX pool found on Meteora.");
    
  } catch (e) {
    console.log(`Pool search: ${e.message}`);
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("⚠️  METEORA DLMM POOL CREATION STATUS");
  console.log("=".repeat(60));
  console.log("");
  console.log("Token-2022 tokens (like PDOX with 3% transfer fee) need");
  console.log("special pool creation. Options:");
  console.log("");
  console.log("1. METEORA UI: https://app.meteora.ag/dlmm");
  console.log("   - Select 'Devnet' network");
  console.log("   - Create custom pool");
  console.log("");
  console.log("2. RAYDIUM: https://raydium.io/liquidity/create-pool/");
  console.log("   - May have better Token-2022 support");
  console.log("");
  console.log("📝 YOUR CONFIG:");
  console.log(`   Token X (PDOX): ${PDOX_MINT.toBase58()}`);
  console.log(`   Token Y (wSOL): ${WSOL.toBase58()}`);
  console.log("   Bin Step: 25");
  console.log("   Initial SOL: 5");
  console.log("   Initial PDOX: 100,000,000");
  console.log("   Price: 1 SOL = 20M PDOX");
  console.log("");
  
  // Save config for reference
  const config = {
    status: "READY_FOR_MANUAL_POOL_CREATION",
    pdoxMint: PDOX_MINT.toBase58(),
    wsolMint: WSOL.toBase58(),
    initialSol: 5,
    initialPdox: 100_000_000,
    pricePerSol: "20M PDOX",
    binStep: 25,
    network: "devnet",
    deployer: payer.publicKey.toBase58(),
    balance: balance / LAMPORTS_PER_SOL,
    urls: {
      meteora: "https://app.meteora.ag/dlmm",
      raydium: "https://raydium.io/liquidity/create-pool/"
    },
    createdAt: new Date().toISOString()
  };
  
  fs.writeFileSync("PDOX_LP_CONFIG.json", JSON.stringify(config, null, 2));
  console.log("✅ Config saved to PDOX_LP_CONFIG.json");
  console.log("");
  console.log("=".repeat(60));
}

main().catch(console.error);

