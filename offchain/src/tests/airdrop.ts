import dotenv from "dotenv";
dotenv.config();

import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Solana connection - try multiple endpoints
const RPC_URLS = [
  process.env.RPC_URL,
  "https://api.devnet.solana.com",
  "https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY", // Fallback if needed
].filter(Boolean) as string[];

const RPC_URL = RPC_URLS[0] ?? "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

// Company wallet path
const COMPANY_WALLET_PATH = path.join(
  __dirname,
  "../../../Nodezero_engine/company_devnet_test.json"
);

async function ensureCompanyWallet(): Promise<Keypair> {
  if (!fs.existsSync(COMPANY_WALLET_PATH)) {
    throw new Error(`Company wallet not found at ${COMPANY_WALLET_PATH}`);
  }
  const keypairBytes = JSON.parse(fs.readFileSync(COMPANY_WALLET_PATH, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(keypairBytes));
}

async function requestAirdrop(keypair: Keypair, amountSOL: number, retries = 3): Promise<void> {
  const publicKey = keypair.publicKey;
  const amountLamports = amountSOL * LAMPORTS_PER_SOL;

  console.log(`💰 Requesting ${amountSOL} SOL airdrop to ${publicKey.toBase58()}...`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`   Retry attempt ${attempt}/${retries}...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); // Exponential backoff
      }

      const signature = await connection.requestAirdrop(publicKey, amountLamports);
      console.log(`   Transaction signature: ${signature}`);

      // Wait for confirmation
      console.log(`   Waiting for confirmation...`);
      await connection.confirmTransaction(signature, "confirmed");

      const balance = await connection.getBalance(publicKey);
      console.log(`   ✅ Airdrop confirmed! New balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);
      return;
    } catch (error: any) {
      if (attempt === retries) {
        console.error(`   ❌ Airdrop failed after ${retries} attempts: ${error.message}`);
        throw error;
      }
      console.log(`   ⚠️  Attempt ${attempt} failed: ${error.message}`);
    }
  }
}

async function requestAirdropInChunks(keypair: Keypair, totalSOL: number): Promise<void> {
  // Devnet often has limits, so request in smaller chunks
  const chunkSize = 2; // Request 2 SOL at a time
  const chunks = Math.ceil(totalSOL / chunkSize);
  
  console.log(`📦 Requesting ${totalSOL} SOL in ${chunks} chunks of ${chunkSize} SOL each...\n`);

  for (let i = 0; i < chunks; i++) {
    const remaining = totalSOL - (i * chunkSize);
    const chunkAmount = Math.min(chunkSize, remaining);
    
    if (chunkAmount <= 0) break;

    console.log(`\n📦 Chunk ${i + 1}/${chunks}: Requesting ${chunkAmount} SOL...`);
    await requestAirdrop(keypair, chunkAmount);
    
    // Small delay between chunks
    if (i < chunks - 1) {
      console.log(`   Waiting 3 seconds before next chunk...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

async function main() {
  console.log("🚀 Requesting SOL Airdrop on Devnet\n");

  // Check connection
  console.log(`🔗 Using RPC: ${RPC_URL}\n`);
  try {
    const version = await connection.getVersion();
    console.log("✅ Connected to devnet");
    console.log(`   Solana version: ${version["solana-core"]}\n`);
  } catch (e: any) {
    console.error(`❌ Cannot connect to devnet: ${e.message}`);
    console.log("\n💡 Tip: Try using a different RPC endpoint or check your internet connection");
    throw new Error("❌ Cannot connect to devnet");
  }

  // Load company wallet
  const companyKeypair = await ensureCompanyWallet();
  console.log(`🏢 Company wallet: ${companyKeypair.publicKey.toBase58()}\n`);

  // Check current balance
  const initialBalance = await connection.getBalance(companyKeypair.publicKey);
  console.log(`💰 Current balance: ${initialBalance / LAMPORTS_PER_SOL} SOL\n`);

  // Request 5 SOL airdrop (in chunks to avoid rate limits)
  await requestAirdropInChunks(companyKeypair, 5);

  // Show final balance
  const finalBalance = await connection.getBalance(companyKeypair.publicKey);
  console.log(`📊 Final balance: ${finalBalance / LAMPORTS_PER_SOL} SOL`);
  console.log(`   Received: ${(finalBalance - initialBalance) / LAMPORTS_PER_SOL} SOL`);
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

