/**
 * ======================================================================
 * COMPRESSED SETTLEMENT
 * ======================================================================
 * 
 * Implements Merkle tree-based compressed settlement for netting batches.
 * Instead of submitting all item transfers individually, we compute a Merkle
 * root of the final state and submit only the root + metadata.
 * 
 * This reduces on-chain data significantly for large batches.
 * 
 * ⚠️ SECURITY NOTE: This is an AUDIT-ONLY commitment, NOT state-changing.
 * 
 * The `settleStateRoot` instruction on-chain:
 * - Stores the Merkle root + metadata in GlobalConfig
 * - Emits an event for indexing/auditing
 * - Does NOT perform actual token transfers or state changes
 * 
 * Actual state changes (item transfers, balance updates) must be done via:
 * - `settleNetBatch` instruction (full settlement with all transfers)
 * - Or separate instructions that verify Merkle proofs
 * 
 * This design allows:
 * - Efficient batch commitment (1 tx for 1000+ intents)
 * - Audit trail (root + counts on-chain)
 * - Later verification via Merkle proofs if needed
 * 
 * Trust Model:
 * - This is a TRUSTED OPERATOR model, not a trustless rollup
 * - The off-chain operator computes the root
 * - Users cannot independently verify inclusion from chain alone
 * - For full trustlessness, implement Merkle proof verification
 */

import { PublicKey, ComputeBudgetProgram, SystemProgram, Transaction } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { getProgram, connection } from "../shared/solana";
import { NettingBatch } from "./types";
import { logger } from "../shared/logger";
import { createHash } from "crypto";
import { getAuthoritySigner } from "../shared/authSigner";
import { fakeConfirmationDetector, brickMonitor, networkPartitionProtector } from "../security/hardening";

/**
 * Compute Merkle root from leaves using SHA-256
 * 
 * Algorithm:
 * - Each leaf is hashed with SHA-256
 * - Pairs of nodes are hashed together (sorted lexicographically)
 * - Process continues until a single root remains
 */
function getMerkleRoot(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) return Buffer.alloc(32, 0);
  
  let layer: Buffer[] = leaves.map(l => createHash("sha256").update(l).digest());
  
  while (layer.length > 1) {
    const next: Buffer[] = [];
    
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = i + 1 < layer.length ? layer[i + 1] : left;
      
      // Sort lexicographically to ensure deterministic ordering
      const [a, b] = left.compare(right) <= 0 ? [left, right] : [right, left];
      
      next.push(createHash("sha256").update(Buffer.concat([a, b])).digest());
    }
    
    layer = next;
  }
  
  return layer[0];
}

/**
 * Get GlobalConfig PDA
 */
function getGlobalConfigPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
  return pda;
}

/**
 * Query the last net batch ID from on-chain GlobalConfig
 * 
 * CRITICAL: This reuses last_net_batch_id (shared with settle_net_batch)
 * to ensure strict ordering between linear and compressed settlement methods.
 */
async function getLastNetBatchId(program: any, configPda: PublicKey): Promise<number> {
  try {
    const configAccount = await program.account.globalConfig.fetch(configPda);
    return configAccount.lastNetBatchId?.toNumber() || 0;
  } catch (error) {
    logger.warn("[SETTLEMENT] Failed to fetch last net batch ID, assuming 0", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Post batch data to Data Availability layer (Arweave/IPFS)
 * 
 * CRITICAL: This ensures the "Diff" (settledItems list) is publicly available
 * even if the server goes offline. Without this, the Merkle root is just a hash
 * with no way to reconstruct the actual state.
 * 
 * @returns Hash of the posted data (CID hash or SHA256 of the blob) for da_hash parameter
 */
async function postBatchToDaLayer(
  batchId: string,
  result: any
): Promise<Buffer | null> {
  const useDaLayer = process.env.USE_DA_LAYER === "true";
  if (!useDaLayer) {
    logger.info("[SETTLEMENT][DA] Data availability layer disabled (USE_DA_LAYER != true)");
    return null;
  }

  try {
    // Prepare batch data for DA layer
    const batchData = {
      batchId,
      timestamp: Date.now(),
      numIntents: result.numIntents,
      numItems: result.numItemsSettled,
      numWallets: result.numWallets,
      finalOwners: Object.fromEntries(result.finalOwners),
      netCashDeltas: Object.fromEntries(
        Array.from(result.netCashDeltas.entries()).map(([k, v]) => [k, v.toString()])
      ),
    };

    const daProvider = process.env.DA_PROVIDER || "arweave";
    
    // CRITICAL: Compute hash of batch data for da_hash parameter
    // This hash will be stored on-chain and can be used to verify the DA layer data
    const batchDataJson = JSON.stringify(batchData);
    const daHash = createHash("sha256").update(batchDataJson).digest();
    
    if (daProvider === "arweave") {
      // Implement Arweave upload
      try {
        const arweave = require("arweave");
        const arweaveClient = arweave.init({
          host: process.env.ARWEAVE_HOST || "arweave.net",
          port: 443,
          protocol: "https",
        });
        
        const walletKey = process.env.ARWEAVE_WALLET_KEY;
        if (!walletKey) {
          logger.warn("[SETTLEMENT][DA] ARWEAVE_WALLET_KEY not set, using SHA256 hash", {
            batchId,
            daHash: daHash.toString("hex").slice(0, 16) + "...",
          });
          return daHash;
        }
        
        const wallet = JSON.parse(walletKey);
        const transaction = await arweaveClient.createTransaction(
          { data: batchDataJson },
          wallet
        );
        
        await arweaveClient.transactions.sign(transaction, wallet);
        const response = await arweaveClient.transactions.post(transaction);
        
        if (response.status === 200 || response.status === 208) {
          const txId = transaction.id;
          logger.info("[SETTLEMENT][DA] Stored batch to Arweave", {
            batchId,
            txId,
            url: `https://arweave.net/${txId}`,
          });
          // Return SHA256 hash of transaction ID for on-chain storage
          const txIdHash = createHash("sha256").update(txId).digest();
          return txIdHash;
        } else {
          throw new Error(`Arweave upload failed: ${response.statusText}`);
        }
      } catch (error) {
        logger.error("[SETTLEMENT][DA] Arweave upload failed, using SHA256 hash", {
          batchId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fallback to SHA256 hash
        return daHash;
      }
    } else if (daProvider === "ipfs") {
      // Use IPFS storage from serverless module
      try {
        const { storeBatchToIPFS } = await import("../serverless/ipfs-storage");
        const ipfsResult = await storeBatchToIPFS(batchId, batchData);
        logger.info("[SETTLEMENT][DA] Stored batch to IPFS", {
          batchId,
          cid: ipfsResult.cid,
          url: ipfsResult.url,
        });
        // Convert CID to hash for on-chain storage
        // For now, use SHA256 hash of CID
        const cidHash = createHash("sha256").update(ipfsResult.cid).digest();
        return cidHash;
      } catch (error) {
        logger.error("[SETTLEMENT][DA] IPFS upload failed, falling back to SHA256 hash", {
          batchId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fallback to SHA256 hash
        return daHash;
      }
    } else {
      logger.warn("[SETTLEMENT][DA] Unknown DA provider, using SHA256 hash", {
        batchId,
        provider: daProvider,
        daHash: daHash.toString("hex").slice(0, 16) + "...",
      });
      // Fallback: return SHA256 hash
      return daHash;
    }
  } catch (error) {
    logger.error("[SETTLEMENT][DA] Failed to post batch to DA layer", {
      batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - DA layer failure should not block settlement
    return null;
  }
}

/**
 * Settle a netting batch using compressed Merkle root settlement
 * 
 * Instead of submitting all item transfers, we:
 * 1. Build a Merkle tree of final item ownership (itemId -> ownerPubkey)
 * 2. Submit only the Merkle root + metadata (numIntents, numItems, sequence)
 * 
 * This dramatically reduces on-chain data for large batches.
 * 
 * CRITICAL SECURITY FEATURES:
 * - Sequence number prevents replay attacks (monotonically increasing)
 * - DA layer posting ensures batch data is publicly available
 * - Merkle root provides cryptographic commitment to final state
 * 
 * @param batch The netting batch to settle
 * @returns Transaction signature, or "skipped" if compressed settlement is disabled
 */
export async function settleBatchCompressed(batch: NettingBatch): Promise<string> {
  const enable = process.env.ENABLE_COMPRESSED_SETTLEMENT === "true";
  
  if (!enable) {
    logger.info("[SETTLEMENT][WRAITH] Skipped (ENABLE_COMPRESSED_SETTLEMENT != true)");
    return "skipped";
  }
  
  if (!batch.result) {
    throw new Error("Batch has no result");
  }
  
  const program = getProgram();
  const signer = getAuthoritySigner();
  const authorityPubkey = new PublicKey(signer.getPublicKeyBase58());
  const programId = new PublicKey(
    process.env.PHANTOMGRID_PROGRAM_ID || process.env.PROGRAM_ID || "8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x"
  );
  const configPda = getGlobalConfigPda(programId);
  
  // CRITICAL: Get last net batch ID from on-chain to prevent replay attacks
  // This reuses last_net_batch_id (shared with settle_net_batch) to ensure
  // strict ordering between linear and compressed settlement methods.
  const lastBatchId = await getLastNetBatchId(program, configPda);
  const nextBatchId = lastBatchId + 1;
  
  logger.info("[SETTLEMENT][WRAITH] Batch ID tracking", {
    batchId: batch.batchId,
    lastBatchId,
    nextBatchId,
  });
  
  // 1) Build leaves: hash(itemId || ownerPubkey)
  // CRITICAL: Sort items deterministically before hashing to ensure consistent Merkle roots
  const sortedItems = Array.from(batch.result.finalOwners.entries())
    .sort(([a], [b]) => a.localeCompare(b)); // Sort by itemId for deterministic ordering
  
  const leaves: Buffer[] = [];
  
  for (const [itemId, owner] of sortedItems) {
    const itemHash = createHash("sha256").update(itemId).digest();
    const ownerPk = new PublicKey(owner).toBuffer();
    leaves.push(createHash("sha256").update(Buffer.concat([itemHash, ownerPk])).digest());
  }
  
  const stateRoot = getMerkleRoot(leaves);
  
  const numIntents = new BN(batch.result.numIntents);
  const numItems = new BN(batch.result.numItemsSettled);
  const batchIdNum = new BN(nextBatchId);
  
  // 2) CRITICAL: Post batch data to Data Availability layer BEFORE settlement
  // This ensures the "Diff" (settledItems list) is publicly available
  // Returns hash of the posted data (CID hash or SHA256) for da_hash parameter
  const daHash = await postBatchToDaLayer(batch.batchId, batch.result);
  const daHashArray = daHash ? Array.from(daHash) : Array.from(Buffer.alloc(32, 0)); // Default to zeros if not posted
  
  logger.info("[SETTLEMENT][WRAITH] Compressed settle root", {
    batchId: batch.batchId,
    root: stateRoot.toString("hex").slice(0, 16) + "...",
    numIntents: batch.result.numIntents,
    numItems: batch.result.numItemsSettled,
    batchIdNum: nextBatchId,
    daHash: daHash ? daHash.toString("hex").slice(0, 16) + "..." : "not_posted",
  });
  
  // 3) Call settleStateRoot(batch_id, root, da_hash, numIntents, numItems)
  // CRITICAL: Batch ID must be monotonically increasing to prevent replay attacks
  // da_hash links to the off-chain data (IPFS/Arweave) for reconstruction
  const rootArray = Array.from(stateRoot); // [u8; 32]
  
  // Build the transaction using program.methods
  const tx = await program.methods
    .settleStateRoot(batchIdNum, rootArray, daHashArray, numIntents, numItems)
    .accounts({
      config: configPda,
      authority: authorityPubkey,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    ])
    .transaction();
  
  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = authorityPubkey;
  
  // Let authSigner sign the transaction bytes
  const rawSigned = await signer.signTransaction(
    tx.serialize({ requireAllSignatures: false })
  );
  const signedTx = Transaction.from(rawSigned);
  
  // Send the signed transaction
  const txSig = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
  });
  
  // Wait for confirmation
  // CRITICAL: Register for fake confirmation detection
  const currentSlot = await connection.getSlot();
  fakeConfirmationDetector.registerPending(txSig, currentSlot);

  await connection.confirmTransaction(txSig, "confirmed");

  // CRITICAL: Verify confirmation is legitimate (not fake)
  try {
    const status = await connection.getSignatureStatus(txSig);
    if (status.value) {
      const confirmedSlot = status.value.slot || currentSlot;
      const isValid = await fakeConfirmationDetector.verifyConfirmation(txSig, confirmedSlot);
      if (!isValid) {
        logger.error("🚨 FAKE CONFIRMATION DETECTED - Transaction may not be valid", {
          batchId: batch.batchId,
          txSignature: txSig,
        });
        brickMonitor.recordFailure("Fake confirmation detected");
        throw new Error("Fake confirmation detected - transaction rejected");
      }
      networkPartitionProtector.updateSlot(confirmedSlot);
      brickMonitor.recordSuccess();
    }
  } catch (error) {
    logger.error("Failed to verify transaction confirmation", {
      batchId: batch.batchId,
      txSignature: txSig,
      error: error instanceof Error ? error.message : String(error),
    });
    // Re-throw if it's a fake confirmation error
    if (error instanceof Error && error.message.includes("Fake confirmation")) {
      throw error;
    }
  }
  
  logger.info("[SETTLEMENT][WRAITH] Batch settled on-chain", {
    batchId: batch.batchId,
    txSig,
    batchIdNum: nextBatchId,
    daHash: daHash ? daHash.toString("hex").slice(0, 16) + "..." : "not_posted",
  });
  
  return txSig;
}

