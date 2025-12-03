/**
 * Test script for buy_compressed_listing
 * 
 * This script demonstrates:
 * 1. Creating a compressed listing
 * 2. Generating Merkle proof
 * 3. Buying the compressed listing
 * 
 * Run with: ts-node src/tests/test_compressed_listing.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { 
  generateBuyProof, 
  CompressedListingData,
  hashCompressedListing,
} from "./compression_proofs";
import { SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, SPL_NOOP_PROGRAM_ID } from "@solana/spl-account-compression";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

// Load IDL
const idlPath = path.join(__dirname, "../../idl/phantom_paradox.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

// Program ID
const PROGRAM_ID = new PublicKey("DyN2xSo3E43nf7xwyCpa14a8pKA2RNxvpMFeStC1veeF");

async function main() {
  // Setup
  const connection = new Connection(
    process.env.RPC_URL || "https://api.devnet.solana.com",
    "confirmed"
  );

  // Load keypairs (adjust paths as needed)
  const payer = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(process.env.WALLET_PATH || "", "utf-8")))
  );
  const seller = Keypair.generate();
  const buyer = Keypair.generate();

  // Initialize program
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(payer),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = new Program(idl, PROGRAM_ID, provider);

  console.log("🔧 Setting up test environment...");

  // 1. Airdrop SOL to test accounts
  console.log("💰 Airdropping SOL...");
  await connection.requestAirdrop(seller.publicKey, 2 * LAMPORTS_PER_SOL);
  await connection.requestAirdrop(buyer.publicKey, 2 * LAMPORTS_PER_SOL);
  await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for airdrop

  // 2. Setup game and tree (assuming already initialized)
  // In a real test, you'd initialize these first
  const gameId = 1;
  const [gamePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("game"), Buffer.from(new anchor.BN(gameId).toArray("le", 8))],
    PROGRAM_ID
  );

  // Merkle tree address (would be created via init_game_tree)
  const merkleTree = new PublicKey(/* your tree address */);

  // 3. Create a test listing
  const listingData: CompressedListingData = {
    game_id: gameId,
    listing_id: 1,
    seller: seller.publicKey,
    kind: 0, // Fixed price
    currency_mint: new PublicKey(/* USDC or SOL mint */),
    item_mint: new PublicKey(/* NFT mint */),
    quantity: 1,
    price: 1_000_000, // 1 USDC (6 decimals)
    end_time: Math.floor(Date.now() / 1000) + 86400, // 24 hours
    creator: seller.publicKey,
    royalty_bps: 500, // 5%
    bump: 0,
  };

  console.log("📝 Listing data:", listingData);

  // 4. Hash the listing to verify
  const listingHash = hashCompressedListing(listingData);
  console.log("🔐 Listing hash:", listingHash.toString("hex"));

  // 5. Generate Merkle proof
  console.log("🌳 Generating Merkle proof...");
  const leafIndex = 0; // Would be tracked from create_compressed_listing event
  
  // IMPORTANT: You must maintain an off-chain index of all leaves
  // This should come from your indexer that tracks CompressedListingCreated events
  // For this example, we'll assume the listing was just created and we have the hash
  const allLeaves: Buffer[] = [];
  const listingHash = hashCompressedListing(listingData);
  allLeaves[leafIndex] = listingHash;
  
  // In production, you'd fetch all leaves from your indexer/database
  // const allLeaves = await fetchAllLeavesFromIndexer(merkleTree);
  
  const proofData = await generateBuyProof(
    connection,
    merkleTree,
    listingData,
    leafIndex,
    allLeaves
  );

  console.log("✅ Proof generated:");
  console.log("  Root:", proofData.root.toString("hex"));
  console.log("  Data Hash:", proofData.dataHash.toString("hex"));
  console.log("  Proof length:", proofData.proof.length);
  console.log("  Leaf index:", proofData.index);

  // 6. Call buy_compressed_listing
  console.log("🛒 Buying compressed listing...");

  // Get token accounts (simplified - you'd need to create these)
  const currencyMint = listingData.currency_mint;
  const itemMint = listingData.item_mint;

  const buyerTokenAccount = await getAssociatedTokenAddress(
    currencyMint,
    buyer.publicKey
  );
  const sellerTokenAccount = await getAssociatedTokenAddress(
    currencyMint,
    listingData.seller
  );
  const buyerItemAccount = await getAssociatedTokenAddress(
    itemMint,
    buyer.publicKey
  );
  const sellerItemAccount = await getAssociatedTokenAddress(
    itemMint,
    listingData.seller
  );

  // Get config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );

  // Get protocol treasury and game owner wallets (from config/game)
  // These would be fetched from on-chain accounts
  const protocolTreasury = new PublicKey(/* from config */);
  const gameOwnerWallet = new PublicKey(/* from game */);

  const protocolTreasuryTokenAccount = await getAssociatedTokenAddress(
    currencyMint,
    protocolTreasury
  );
  const gameOwnerTokenAccount = await getAssociatedTokenAddress(
    currencyMint,
    gameOwnerWallet
  );
  const creatorTokenAccount = await getAssociatedTokenAddress(
    currencyMint,
    listingData.creator
  );

  try {
    const tx = await program.methods
      .buyCompressedListing(
        Array.from(proofData.root),
        Array.from(proofData.dataHash),
        Array.from(proofData.creatorHash),
        new anchor.BN(proofData.nonce),
        proofData.index,
        proofData.proof.map((p) => Array.from(p)),
        new anchor.BN(listingData.listing_id),
        listingData.kind,
        new anchor.BN(listingData.quantity),
        new anchor.BN(listingData.price),
        new anchor.BN(listingData.end_time),
        listingData.creator,
        listingData.royalty_bps
      )
      .accounts({
        config: configPda,
        game: gamePda,
        buyer: buyer.publicKey,
        seller: listingData.seller,
        itemMint: itemMint,
        currencyMint: currencyMint,
        buyerTokenAccount: buyerTokenAccount,
        sellerTokenAccount: sellerTokenAccount,
        buyerItemAccount: buyerItemAccount,
        sellerItemAccount: sellerItemAccount,
        protocolTreasury: protocolTreasury,
        protocolTreasuryTokenAccount: protocolTreasuryTokenAccount,
        gameOwnerWallet: gameOwnerWallet,
        gameOwnerTokenAccount: gameOwnerTokenAccount,
        creatorTokenAccount: creatorTokenAccount,
        merkleTree: merkleTree,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    console.log("✅ Transaction successful:", tx);
    console.log("🔗 Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);
  } catch (error) {
    console.error("❌ Transaction failed:", error);
    throw error;
  }
}

main()
  .then(() => {
    console.log("✅ Test completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });

