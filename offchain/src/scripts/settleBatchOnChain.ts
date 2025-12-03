import "dotenv/config";
import { initDatabase, query } from "../shared/db";
import { toSettlementPayload } from "../netting/graph";
import { NettingResult } from "../netting/types";
import { Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { readFileSync } from "fs";
import { join } from "path";
import bs58 from "bs58";

/**
 * Load keypair from environment variable
 * Supports:
 * - Path to JSON file
 * - Base58 encoded secret key
 * - Array of numbers (JSON array)
 */
function loadKeypair(pathOrSecret: string): Keypair {
  try {
    // Try as file path first
    if (pathOrSecret.endsWith(".json")) {
      const keyData = JSON.parse(readFileSync(pathOrSecret, "utf-8"));
      if (Array.isArray(keyData)) {
        return Keypair.fromSecretKey(Uint8Array.from(keyData));
      }
      if (keyData.secretKey) {
        return Keypair.fromSecretKey(Uint8Array.from(keyData.secretKey));
      }
    }

    // Try as base58 encoded secret
    try {
      const decoded = bs58.decode(pathOrSecret);
      if (decoded.length === 64) {
        return Keypair.fromSecretKey(decoded);
      }
    } catch {
      // Not base58, continue
    }

    // Try as JSON array
    try {
      const parsed = JSON.parse(pathOrSecret);
      if (Array.isArray(parsed)) {
        return Keypair.fromSecretKey(Uint8Array.from(parsed));
      }
    } catch {
      // Not JSON, continue
    }

    throw new Error("Could not parse keypair from provided value");
  } catch (error) {
    throw new Error(`Failed to load keypair: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Find the most recent batch with >= 1000 intents and no tx_signature
 */
async function findBatchIdFromDb(): Promise<string | null> {
  const res = await query(
    "SELECT batch_id FROM netting_batches WHERE num_intents >= 1000 AND tx_signature IS NULL ORDER BY created_at DESC LIMIT 1",
    []
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].batch_id as string;
}

/**
 * Hash a string to a number (for converting UUID batch IDs to numbers)
 */
function hashStringToNumber(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

async function main() {
  console.log("STEP 1: Initializing database...");
  await initDatabase();
  console.log("✅ STEP 1 complete: Database initialized");

  console.log("STEP 2: Resolving batch_id...");
  // Get batch_id from CLI or find one automatically
  let batchId = process.argv[2];
  if (!batchId) {
    console.log("  No batch_id provided, searching for suitable batch...");
    batchId = await findBatchIdFromDb() || undefined;
  }

  if (!batchId) {
    console.error("❌ No suitable batch_id provided or found in DB.");
    console.error("   Provide a batch_id: npx ts-node src/scripts/settleBatchOnChain.ts <batch_id>");
    console.error("   Or ensure there's a batch with num_intents >= 1000 and tx_signature IS NULL");
    process.exit(1);
  }
  console.log(`✅ STEP 2 complete: Batch ID = ${batchId}`);

  console.log("=".repeat(80));
  console.log("SETTLING BATCH ON-CHAIN");
  console.log("=".repeat(80));
  console.log(`Batch ID: ${batchId}`);
  console.log();

  console.log("STEP 3: Loading batch from DB...");
  // Load batch metadata from DB
  const batchRes = await query(
    "SELECT batch_id, num_intents, num_items_settled, num_wallets, intent_ids FROM netting_batches WHERE batch_id = $1",
    [batchId]
  );

  if (batchRes.rows.length === 0) {
    console.error(`❌ Batch not found in DB: ${batchId}`);
    process.exit(1);
  }

  const batchRow = batchRes.rows[0];
  console.log("✅ STEP 3 complete: Loaded batch from DB:", {
    batchId: batchRow.batch_id,
    numIntents: batchRow.num_intents,
    numItemsSettled: batchRow.num_items_settled,
    numWallets: batchRow.num_wallets,
  });
  console.log();

  console.log("STEP 4: Loading result details from DB...");
  // Load result details from separate tables
  const finalOwners = new Map<string, string>();
  const netCashDeltas = new Map<string, bigint>();

  const ownersResult = await query(
    `SELECT item_id, final_owner FROM settled_items WHERE batch_id = $1`,
    [batchId]
  );
  for (const ownerRow of ownersResult.rows) {
    finalOwners.set(ownerRow.item_id, ownerRow.final_owner);
  }

  const deltasResult = await query(
    `SELECT owner_pubkey, delta_lamports FROM net_cash_deltas WHERE batch_id = $1`,
    [batchId]
  );
  for (const deltaRow of deltasResult.rows) {
    netCashDeltas.set(deltaRow.owner_pubkey, BigInt(deltaRow.delta_lamports));
  }

  // Parse intent_ids (handle both JSON string and already parsed)
  let intentIds: string[] = [];
  try {
    if (typeof batchRow.intent_ids === "string") {
      intentIds = JSON.parse(batchRow.intent_ids);
    } else if (Array.isArray(batchRow.intent_ids)) {
      intentIds = batchRow.intent_ids;
    }
  } catch (e) {
    console.warn("⚠️  Could not parse intent_ids, using empty array");
  }

  // Reconstruct NettingResult
  const nettingResult: NettingResult = {
    finalOwners,
    netCashDeltas,
    consumedIntentIds: intentIds,
    batchId,
    nettedAt: 0, // Will be set if available
    numIntents: batchRow.num_intents,
    numItemsSettled: batchRow.num_items_settled,
    numWallets: batchRow.num_wallets,
  };
  console.log(`✅ STEP 4 complete: Reconstructed NettingResult (${finalOwners.size} owners, ${netCashDeltas.size} deltas)`);

  console.log("STEP 5: Building settlement payload...");
  // Generate settlement payload
  const settlementPayload = toSettlementPayload(nettingResult);
  console.log("✅ STEP 5 complete: Settlement payload built:", {
    items: settlementPayload.settledItems.length,
    deltas: settlementPayload.netDeltas.length,
  });
  console.log();

  console.log("STEP 6: Setting up Solana connection...");
  // ---- SOLANA / ANCHOR SETUP ----
  const rpcUrl = process.env.RPC_ENDPOINT || process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    throw new Error("❌ RPC_ENDPOINT / SOLANA_RPC_URL not set in .env");
  }

  const programIdStr = process.env.PHANTOMGRID_PROGRAM_ID || process.env.PROGRAM_ID;
  if (!programIdStr) {
    throw new Error("❌ PHANTOMGRID_PROGRAM_ID not set in .env");
  }

  const walletSource = process.env.SERVER_AUTHORITY_SECRET_KEY || process.env.WALLET_KEYPAIR;
  if (!walletSource) {
    throw new Error("❌ SERVER_AUTHORITY_SECRET_KEY / WALLET_KEYPAIR not set in .env");
  }

  console.log(`   RPC: ${rpcUrl}`);
  console.log(`   Program ID: ${programIdStr}`);
  const connection = new Connection(rpcUrl, "confirmed");
  console.log("✅ STEP 6 complete: Solana connection created");

  console.log("STEP 7: Loading keypair from:", walletSource);
  const keypair = loadKeypair(walletSource);
  console.log("STEP 7a: Keypair pubkey:", keypair.publicKey.toBase58());
  const programId = new PublicKey(programIdStr);
  console.log(`✅ STEP 7 complete: Keypair loaded`);

  console.log("STEP 8: Loading IDL and creating Anchor Program...");
  // Load IDL and create program
  const idlPath = join(__dirname, "..", "..", "idl", "phantom_paradox.json");
  const idl = JSON.parse(readFileSync(idlPath, "utf-8"));
  
  // Create provider with the actual wallet (not dummy)
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  
  // Program constructor: (idl, provider) - programId comes from IDL's "address" field
  const program = new anchor.Program(idl as any, provider);
  console.log("STEP 8a: Program ID:", program.programId.toBase58());
  console.log("✅ STEP 8 complete: Anchor Program created");
  console.log();

  console.log("STEP 9: Preparing transaction data...");
  // ---- SEND SETTLEMENT TRANSACTION ----
  // Convert batch ID to number
  const batchIdNum = hashStringToNumber(batchId);

  console.log("STEP 10: Getting/computing batch hash...");
  // Get batch hash from DB or compute it
  // batch_hash must be exactly [u8; 32] = 32 bytes
  let batchHashArray: number[];
  try {
    const hashRes = await query(
      "SELECT batch_hash FROM netting_batches WHERE batch_id = $1",
      [batchId]
    );
    if (hashRes.rows[0]?.batch_hash) {
      // If stored as hex string, convert to array
      const hash = hashRes.rows[0].batch_hash;
      if (typeof hash === "string" && hash.startsWith("0x")) {
        batchHashArray = Array.from(Buffer.from(hash.slice(2), "hex"));
      } else if (Buffer.isBuffer(hash)) {
        batchHashArray = Array.from(hash);
      } else if (Array.isArray(hash)) {
        batchHashArray = hash;
      } else {
        throw new Error("Unknown batch_hash format");
      }
      // Ensure exactly 32 bytes
      if (batchHashArray.length !== 32) {
        throw new Error(`Batch hash must be exactly 32 bytes, got ${batchHashArray.length}`);
      }
      console.log("✅ STEP 10 complete: Batch hash loaded from DB (32 bytes)");
    } else {
      // Compute batch hash from settlement payload (matching engine.ts logic)
      const { createHash } = await import("crypto");
      const hashInput = JSON.stringify({
        finalOwners: Object.fromEntries(nettingResult.finalOwners),
        netCashDeltas: Object.fromEntries(
          Array.from(nettingResult.netCashDeltas.entries()).map(([k, v]) => [k, v.toString()])
        ),
        numIntents: nettingResult.numIntents,
        numItemsSettled: nettingResult.numItemsSettled,
      });
      const hash = createHash("sha256").update(hashInput).digest();
      batchHashArray = Array.from(hash);
      if (batchHashArray.length !== 32) {
        throw new Error(`Computed hash must be exactly 32 bytes, got ${batchHashArray.length}`);
      }
      console.log("✅ STEP 10 complete: Batch hash computed from payload (32 bytes)");
    }
  } catch (e) {
    // If batch_hash column doesn't exist, compute it (matching engine.ts logic)
    const { createHash } = await import("crypto");
    const hashInput = JSON.stringify({
      finalOwners: Object.fromEntries(nettingResult.finalOwners),
      netCashDeltas: Object.fromEntries(
        Array.from(nettingResult.netCashDeltas.entries()).map(([k, v]) => [k, v.toString()])
      ),
      numIntents: nettingResult.numIntents,
      numItemsSettled: nettingResult.numItemsSettled,
    });
    const hash = createHash("sha256").update(hashInput).digest();
    batchHashArray = Array.from(hash);
    if (batchHashArray.length !== 32) {
      throw new Error(`Computed hash must be exactly 32 bytes, got ${batchHashArray.length}`);
    }
    console.log("✅ STEP 10 complete: Batch hash computed (column doesn't exist, 32 bytes)");
  }

  console.log("STEP 11: Converting settled items...");
  // Convert settled items - filter out invalid public keys
  const validItems: typeof settlementPayload.settledItems = [];
  const invalidItems: typeof settlementPayload.settledItems = [];
  
  for (const item of settlementPayload.settledItems) {
    // Validate public key (Solana public keys are base58, typically 32-44 chars)
    // Test values like "w2" or "wallet2" are not valid
    if (item.finalOwner.length < 32 || item.finalOwner.length > 44) {
      invalidItems.push(item);
      continue;
    }
    
    // Try to validate it's a real public key
    try {
      new PublicKey(item.finalOwner);
      validItems.push(item);
    } catch {
      invalidItems.push(item);
    }
  }
  
  if (invalidItems.length > 0) {
    console.log(`⚠️  Filtered out ${invalidItems.length} items with invalid public keys:`);
    invalidItems.slice(0, 5).forEach(item => {
      console.log(`  - itemId: ${item.itemId}, finalOwner: ${item.finalOwner} (length: ${item.finalOwner.length})`);
    });
  }
  
  const items = validItems.map((item, idx) => {
    try {
      // Try to parse itemId as number (handle "item-0" format)
      let itemIdNum = 0;
      if (typeof item.itemId === "string") {
        // Extract number from "item-0" or use as-is if it's already a number
        const match = item.itemId.match(/\d+/);
        if (match) {
          itemIdNum = parseInt(match[0], 10);
        } else {
          // Fallback: hash the string to a number
          itemIdNum = hashStringToNumber(item.itemId);
        }
      } else {
        itemIdNum = parseInt(String(item.itemId)) || 0;
      }
      
      return {
        itemId: new BN(itemIdNum),
        finalOwner: new PublicKey(item.finalOwner),
      };
    } catch (e) {
      console.error(`Error processing item ${idx}:`, {
        itemId: item.itemId,
        finalOwner: item.finalOwner,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  });
  console.log(`✅ STEP 11 complete: Converted ${items.length} settled items (filtered ${invalidItems.length} invalid)`);

  console.log("STEP 12: Converting cash deltas...");
  // Convert cash deltas (only non-zero) - filter out invalid public keys
  const validDeltas: typeof settlementPayload.netDeltas = [];
  const invalidDeltas: typeof settlementPayload.netDeltas = [];
  
  for (const delta of settlementPayload.netDeltas) {
    if (delta.deltaLamports === 0n) continue; // Skip zero deltas
    
    // Validate public key
    if (delta.ownerPubkey.length < 32 || delta.ownerPubkey.length > 44) {
      invalidDeltas.push(delta);
      continue;
    }
    
    // Try to validate it's a real public key
    try {
      new PublicKey(delta.ownerPubkey);
      validDeltas.push(delta);
    } catch {
      invalidDeltas.push(delta);
    }
  }
  
  if (invalidDeltas.length > 0) {
    console.log(`⚠️  Filtered out ${invalidDeltas.length} deltas with invalid public keys:`);
    invalidDeltas.slice(0, 5).forEach(delta => {
      console.log(`  - ownerPubkey: ${delta.ownerPubkey} (length: ${delta.ownerPubkey.length})`);
    });
  }
  
  // IMPORTANT: delta_lamports is i64 (signed) in IDL, not u64!
  // Convert bigint to signed i64 BN
  const cashDeltas = validDeltas.map(delta => {
    const deltaValue = delta.deltaLamports;
    // Convert bigint to BN, handling sign correctly
    // BN.fromNumber() doesn't handle bigint, so convert to string first
    const deltaStr = deltaValue.toString();
    const deltaBN = new BN(deltaStr, 10);
    // If negative, BN will handle it correctly
    return {
      owner: new PublicKey(delta.ownerPubkey),
      deltaLamports: deltaBN, // BN handles signed integers correctly
    };
  });
  console.log(`✅ STEP 12 complete: Converted ${cashDeltas.length} cash deltas (filtered ${invalidDeltas.length} invalid)`);

  console.log("STEP 12a: Preparing royalty distribution and π-fee...");
  // Extract royalty distribution from netting result (if available)
  const royaltyDistribution: Array<[PublicKey, BN]> = [];
  if (nettingResult.royaltyDistribution && nettingResult.royaltyDistribution.size > 0) {
    for (const [agentId, royaltyAmount] of nettingResult.royaltyDistribution.entries()) {
      if (royaltyAmount > 0n) {
        try {
          const agentPubkey = new PublicKey(agentId);
          royaltyDistribution.push([agentPubkey, new BN(royaltyAmount.toString())]);
        } catch (e) {
          console.warn(`  ⚠️  Skipped invalid agent ID: ${agentId}`);
        }
      }
    }
  }
  
  // Extract π-Standard protocol fee
  const piFee = nettingResult.piFeeLamports ? Number(nettingResult.piFeeLamports) : 0;
  console.log(`✅ STEP 12a complete: ${royaltyDistribution.length} agent royalties, π-fee: ${piFee} lamports`);

  console.log("STEP 13: Computing GlobalConfig PDA...");
  // Get GlobalConfig PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
  console.log(`✅ STEP 13 complete: Config PDA = ${configPda.toBase58()}`);

  console.log("STEP 14: Transaction summary:");
  console.log({
    batchId,
    batchIdNum,
    batchHashLength: batchHashArray.length,
    numItems: items.length,
    numDeltas: cashDeltas.length,
    numRoyalties: royaltyDistribution.length,
    piFee,
    configPda: configPda.toBase58(),
    authority: keypair.publicKey.toBase58(),
  });
  console.log();

  console.log("STEP 15: Sending settleNetBatch transaction...");
  console.log("  (This may take 10-30 seconds...)");
  console.log("  Debug: batchHashArray length:", batchHashArray.length, "(must be 32)");
  console.log("  Debug: items count:", items.length);
  console.log("  Debug: cashDeltas count:", cashDeltas.length);
  
  // Convert batchHashArray to Buffer (Anchor might expect Buffer/Uint8Array)
  const batchHashBuffer = Buffer.from(batchHashArray);
  if (batchHashBuffer.length !== 32) {
    throw new Error(`Batch hash must be exactly 32 bytes, got ${batchHashBuffer.length}`);
  }
  
  let txSig: string;
  try {
    // Try with Buffer first
    txSig = await program.methods
      .settleNetBatch(
        new BN(batchIdNum),
        Array.from(batchHashBuffer), // Convert back to array (Anchor expects number[])
        items,
        cashDeltas,
        royaltyDistribution, // Agent royalties
        new BN(piFee) // π-Standard protocol fee
      )
      .accounts({
        config: configPda,
        authority: keypair.publicKey,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .signers([keypair])
      .rpc();
  } catch (e: any) {
    console.error("STEP 15 ERROR: rpc() failed:", e?.message || e);
    console.error("  Error details:", {
      code: e?.code,
      logs: e?.logs,
      err: e?.err,
    });
    throw e;
  }
  
  console.log("✅ STEP 15 complete: Transaction sent!");
  console.log(`   TX Signature: ${txSig}`);
  console.log();

  console.log("STEP 16: Updating database with tx signature...");
  // Update DB
  await query(
    "UPDATE netting_batches SET settled = TRUE, tx_signature = $2, settled_at = NOW() WHERE batch_id = $1",
    [batchId, txSig]
  );
  console.log("✅ STEP 16 complete: Database updated");

  console.log();
  console.log("=".repeat(80));
  console.log("🎉 SETTLEMENT COMPLETE!");
  console.log("=".repeat(80));
  console.log(`Batch ID: ${batchId}`);
  console.log(`TX Signature: ${txSig}`);
  
  // Determine cluster from RPC URL
  const cluster = rpcUrl.includes("devnet") ? "devnet" : rpcUrl.includes("mainnet") ? "mainnet" : "devnet";
  console.log(`View on Solscan: https://solscan.io/tx/${txSig}?cluster=${cluster}`);
  console.log("=".repeat(80));
  console.log("✅ ALL STEPS COMPLETE!");
}

main().catch((e) => {
  console.error("❌ settleBatchOnChain.ts error:", e);
  process.exit(1);
});

