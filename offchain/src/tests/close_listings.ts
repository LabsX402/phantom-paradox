/**
 * Close all settled/cancelled listing accounts to reclaim rent
 * 
 * This script finds all listing accounts owned by the PhantomGrid Gaming program,
 * filters for those that are settled or cancelled with quantity_remaining == 0,
 * and closes them to reclaim the rent-exempt SOL.
 * 
 * USAGE:
 *   cd offchain
 *   npx ts-node src/tests/close_listings.ts
 */

import dotenv from "dotenv";
dotenv.config();

import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import idl from "../../idl/phantom_paradox.json";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");
const PROGRAM_ID = new PublicKey("DyN2xSo3E43nf7xwyCpa14a8pKA2RNxvpMFeStC1veeF");

const COMPANY_WALLET_PATH = path.join(
  __dirname,
  "../../../Nodezero_engine/company_devnet_test.json"
);

// Game ID used in stress test (default is 1)
const GAME_ID = 1;

async function main() {
  console.log("🔍 Finding and closing listing accounts to reclaim rent...\n");

  // Load company wallet
  if (!fs.existsSync(COMPANY_WALLET_PATH)) {
    throw new Error(`Company wallet not found at ${COMPANY_WALLET_PATH}`);
  }
  const companyKeypairBytes = JSON.parse(
    fs.readFileSync(COMPANY_WALLET_PATH, "utf8")
  );
  const companyKeypair = Keypair.fromSecretKey(
    Uint8Array.from(companyKeypairBytes)
  );

  const initialBalance = await connection.getBalance(companyKeypair.publicKey);
  console.log(`💰 Initial balance: ${initialBalance / 1e9} SOL\n`);

  // Setup Anchor provider and program
  const wallet = new anchor.Wallet(companyKeypair);
  const provider = new anchor.AnchorProvider(
    connection,
    wallet,
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const programIdl = idl as anchor.Idl;
  const program = new anchor.Program(programIdl, provider);

  // Derive game PDA
  const [gamePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("game"), new anchor.BN(GAME_ID).toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  // Derive config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  console.log(`🎮 Game PDA: ${gamePda.toBase58()}`);
  console.log(`⚙️  Config PDA: ${configPda.toBase58()}\n`);

  // Get all listing accounts owned by the program
  // We'll filter by game PDA after decoding
  console.log("📋 Finding all listing accounts...");
  const allAccounts = await connection.getProgramAccounts(PROGRAM_ID);

  console.log(`   Found ${allAccounts.length} accounts for game ${GAME_ID}\n`);

  // Parse listing accounts and filter for closable ones
  const closableListings: { pda: PublicKey; listingId: anchor.BN }[] = [];
  let skippedCount = 0;

  let decodedCount = 0;
  let gameMatchCount = 0;
  let statusBreakdown: Record<string, number> = {};
  const activeListings: { pda: PublicKey; listingId: anchor.BN; listing: any }[] = [];

  for (const accountInfo of allAccounts) {
    try {
      const accountData = accountInfo.account.data;
      const listing = program.coder.accounts.decode("listing", accountData);
      decodedCount++;

      // Verify this is actually a listing for our game
      if (!listing.game.equals(gamePda)) {
        skippedCount++;
        continue;
      }
      gameMatchCount++;

      // Check if listing is settled or cancelled
      // Status is an enum: { pending: {} } | { active: {} } | { partiallyFilled: {} } | { settled: {} } | { cancelled: {} }
      const status = listing.status;
      const quantityRemaining = listing.quantity_remaining?.toNumber() ?? listing.quantityRemaining?.toNumber() ?? 0;

      const statusKey = Object.keys(status)[0] || "unknown";
      statusBreakdown[statusKey] = (statusBreakdown[statusKey] || 0) + 1;

      const isSettled = status.settled !== undefined;
      const isCancelled = status.cancelled !== undefined;
      const isActive = status.active !== undefined;
      const isPending = status.pending !== undefined;
      const isPartiallyFilled = status.partiallyFilled !== undefined;

      const listingId = listing.listing_id ?? listing.listingId;
      
      if ((isSettled || isCancelled) && quantityRemaining === 0) {
        closableListings.push({ pda: accountInfo.pubkey, listingId });
      } else if (isActive || isPending || isPartiallyFilled) {
        // Store active listings to cancel them first
        activeListings.push({ pda: accountInfo.pubkey, listingId, listing });
        skippedCount++;
      } else {
        skippedCount++;
      }
    } catch (error: any) {
      // Skip accounts that can't be decoded as listings
      skippedCount++;
    }
  }

  console.log(`   Decoded ${decodedCount} listings, ${gameMatchCount} match game ${GAME_ID}`);
  console.log(`   Status breakdown: ${JSON.stringify(statusBreakdown)}`);

  // Cancel active listings first (if we have permission as game owner/admin)
  if (activeListings.length > 0) {
    console.log(`\n🛑 Cancelling ${activeListings.length} active/pending listings first...`);
    const CANCEL_BATCH_SIZE = 5;
    let cancelledCount = 0;
    let cancelFailedCount = 0;

    for (let i = 0; i < activeListings.length; i += CANCEL_BATCH_SIZE) {
      const batch = activeListings.slice(i, i + CANCEL_BATCH_SIZE);
      const batchNum = Math.floor(i / CANCEL_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(activeListings.length / CANCEL_BATCH_SIZE);

      console.log(`   Cancel batch ${batchNum}/${totalBatches}: Processing ${batch.length} listings...`);

      for (const { pda, listingId, listing } of batch) {
        try {
          // Derive required accounts for cancel
          const itemMint = listing.item_mint ?? listing.itemMint;
          const seller = listing.seller;
          
          const [sellerLedgerPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("ledger"), gamePda.toBuffer(), seller.toBuffer()],
            program.programId
          );

          const ESCROW_SEED = Buffer.from("escrow");
          const [escrowItemAta] = PublicKey.findProgramAddressSync(
            [ESCROW_SEED, pda.toBuffer()],
            program.programId
          );

          const sellerItemAta = await getAssociatedTokenAddress(
            new PublicKey(itemMint),
            seller
          );

          // Cancel listing
          const txSig = await program.methods
            .cancelListing()
            .accounts({
              config: configPda,
              game: gamePda,
              listing: pda,
              sellerLedger: sellerLedgerPda,
              itemMint: new PublicKey(itemMint),
              escrowItemAta: escrowItemAta,
              sellerItemAta: sellerItemAta,
              caller: companyKeypair.publicKey,
              tokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
              systemProgram: SystemProgram.programId,
            })
            .rpc();

          cancelledCount++;
          console.log(`      ✅ Cancelled listing ${listingId.toString()} - ${txSig.substring(0, 8)}...`);
          
          // Add to closable list
          closableListings.push({ pda, listingId });
        } catch (error: any) {
          cancelFailedCount++;
          console.log(`      ❌ Failed to cancel listing ${listingId.toString()}: ${error.message}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      if (i + CANCEL_BATCH_SIZE < activeListings.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    console.log(`   ✅ Cancelled ${cancelledCount} listings, ${cancelFailedCount} failed\n`);
  }

  console.log(`✅ Found ${closableListings.length} closable listings`);
  console.log(`⏭️  Skipped ${skippedCount} accounts (not closable or invalid)\n`);

  if (closableListings.length === 0) {
    console.log("✨ No closable listings found. Nothing to do!");
    return;
  }

  // Close listings in batches
  const BATCH_SIZE = 10; // Close 10 at a time to avoid rate limits
  let closedCount = 0;
  let failedCount = 0;
  let totalRentReclaimed = 0;

  console.log(`🗑️  Closing ${closableListings.length} listings in batches of ${BATCH_SIZE}...\n`);

  for (let i = 0; i < closableListings.length; i += BATCH_SIZE) {
    const batch = closableListings.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(closableListings.length / BATCH_SIZE);

    console.log(`   Batch ${batchNum}/${totalBatches}: Closing ${batch.length} listings...`);

    for (const { pda, listingId } of batch) {
      try {
        // Get account info to estimate rent
        const accountInfo = await connection.getAccountInfo(pda);
        const estimatedRent = accountInfo?.lamports ?? 0;

        // Close listing
        const txSig = await program.methods
          .closeListing()
          .accounts({
            config: configPda,
            game: gamePda,
            listing: pda,
            recipient: companyKeypair.publicKey,
            caller: companyKeypair.publicKey,
          })
          .rpc();

        closedCount++;
        totalRentReclaimed += estimatedRent;
        console.log(`      ✅ Closed listing ${listingId.toString()} (${pda.toBase58().substring(0, 8)}...) - ${txSig.substring(0, 8)}...`);
      } catch (error: any) {
        failedCount++;
        console.log(`      ❌ Failed to close listing ${listingId.toString()}: ${error.message}`);
      }

      // Small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Longer delay between batches
    if (i + BATCH_SIZE < closableListings.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Final balance
  const finalBalance = await connection.getBalance(companyKeypair.publicKey);
  const actualRentReclaimed = finalBalance - initialBalance;

  console.log("\n📊 Summary:");
  console.log(`   - Closable listings found: ${closableListings.length}`);
  console.log(`   - Successfully closed: ${closedCount}`);
  console.log(`   - Failed: ${failedCount}`);
  console.log(`   - Estimated rent reclaimed: ${totalRentReclaimed / 1e9} SOL`);
  console.log(`   - Actual balance change: ${actualRentReclaimed / 1e9} SOL`);
  console.log(`   - Final balance: ${finalBalance / 1e9} SOL`);
  console.log(`\n💡 Note:`);
  console.log(`   - Only settled/cancelled listings with quantity_remaining == 0 can be closed`);
  console.log(`   - Active listings cannot be closed (must be settled/cancelled first)`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

