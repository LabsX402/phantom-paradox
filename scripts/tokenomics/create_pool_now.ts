/**
 * DIRECT POOL CREATION - Meteora DLMM
 * 5 SOL + 100M PDOX (10% of supply)
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import DLMM from "@meteora-ag/dlmm";
import BN from "bn.js";
import * as fs from "fs";

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
  const pdoxAccount = await getAccount(connection, pdoxAta, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log(`PDOX: ${Number(pdoxAccount.amount) / 1e9}`);
  
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
    const pdoxPool = pools.find((p: any) => {
      const mintX = p.tokenXMint?.toBase58() || p.lbPair?.tokenXMint?.toBase58();
      const mintY = p.tokenYMint?.toBase58() || p.lbPair?.tokenYMint?.toBase58();
      return mintX === PDOX_MINT.toBase58() || mintY === PDOX_MINT.toBase58();
    });
    
    if (pdoxPool) {
      console.log("\n✅ FOUND EXISTING PDOX POOL!");
      console.log(`Pool: ${pdoxPool.publicKey?.toBase58() || pdoxPool.lbPair?.publicKey?.toBase58()}`);
      
      fs.writeFileSync("PDOX_POOL_LIVE.json", JSON.stringify({
        status: "EXISTING_POOL",
        pool: pdoxPool.publicKey?.toBase58() || "unknown",
        network: "devnet",
        foundAt: new Date().toISOString()
      }, null, 2));
      
      return;
    }
    
    console.log("No existing PDOX pool found.");
    
  } catch (e: any) {
    console.log(`Pool search error: ${e.message}`);
  }
  
  console.log("\n⚠️ METEORA DLMM POOL CREATION:");
  console.log("");
  console.log("Token-2022 pools on devnet require manual creation via:");
  console.log("  1. https://app.meteora.ag/dlmm (select devnet)");
  console.log("  2. Or use Raydium/Orca which may have better devnet support");
  console.log("");
  console.log("📝 YOUR POOL CONFIG:");
  console.log(`  Token X: ${PDOX_MINT.toBase58()} (PDOX)`);
  console.log(`  Token Y: ${WSOL.toBase58()} (wSOL)`);
  console.log("  Bin Step: 25-100");
  console.log("  Initial SOL: 5");
  console.log("  Initial PDOX: 100,000,000");
  console.log("");
  
  // Save config for reference
  const config = {
    status: "MANUAL_CREATION_NEEDED",
    pdoxMint: PDOX_MINT.toBase58(),
    wsolMint: WSOL.toBase58(),
    initialSol: 5,
    initialPdox: 100_000_000,
    pricePerSol: "20M PDOX",
    network: "devnet",
    deployer: payer.publicKey.toBase58(),
    meteora: "https://app.meteora.ag/dlmm",
    raydium: "https://raydium.io/liquidity/create-pool/",
    createdAt: new Date().toISOString()
  };
  
  fs.writeFileSync("PDOX_LP_CONFIG.json", JSON.stringify(config, null, 2));
  console.log("✅ Config saved to PDOX_LP_CONFIG.json");
}

main().catch(console.error);

