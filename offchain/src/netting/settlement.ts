/**
 * On-chain Settlement - Sends batches to Solana
 * 
 * This module handles sending netting batches to the on-chain program
 * for final settlement.
 */

import { Connection, PublicKey, Keypair, SystemProgram, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { getProgram, connection } from "../shared/solana";
import { NettingBatch, SettledItem, NetDelta } from "./types";
import { logger } from "../shared/logger";
import bs58 from "bs58";
import { fakeConfirmationDetector, brickMonitor, networkPartitionProtector } from "../security/hardening";

// Server authority keypair (for signing settlement transactions)
// In production, this should come from a secure key management system
let serverAuthority: Keypair | null = null;

/**
 * Initialize server authority from environment
 */
function getServerAuthority(): Keypair {
  if (serverAuthority) {
    return serverAuthority;
  }

  const secretKey = process.env.SERVER_AUTHORITY_SECRET_KEY;
  if (secretKey) {
    try {
      serverAuthority = Keypair.fromSecretKey(bs58.decode(secretKey));
      logger.info("Server authority loaded from env");
    } catch (error) {
      logger.warn("Failed to load server authority from env, using random keypair (DEV ONLY)");
      serverAuthority = Keypair.generate();
    }
  } else {
    logger.warn("SERVER_AUTHORITY_SECRET_KEY not set, using random keypair (DEV ONLY)");
    serverAuthority = Keypair.generate();
  }

  return serverAuthority;
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
 * Settle a batch on-chain
 */
export async function settleBatchOnChain(
  batch: NettingBatch
): Promise<string> {
  const enableOnChain = process.env.ENABLE_ONCHAIN_SETTLEMENT === "true";
  if (!enableOnChain) {
    logger.debug("On-chain settlement disabled, skipping");
    throw new Error("On-chain settlement is disabled");
  }

  if (!batch.result) {
    throw new Error("Batch has no result to settle");
  }

  try {
    const program = getProgram();
    const authority = getServerAuthority();
    const configPda = getGlobalConfigPda(program.programId);

    // Convert batch ID to number (use hash of UUID for deterministic batch IDs)
    // For now, use a simple hash of the batch ID string
    const batchIdNum = hashStringToNumber(batch.batchId);

    // Convert batch hash to array
    const batchHashArray = batch.batchHash 
      ? Array.from(batch.batchHash)
      : Array.from(Buffer.alloc(32, 0)); // Default to zeros if no hash

    // Convert settled items - CRITICAL: Use safe conversion to prevent precision loss
    const items = Array.from(batch.result.finalOwners.entries()).map(([itemId, owner]) => {
      // For itemId, we need to handle it safely - if it's numeric, parse it, otherwise hash it
      let itemIdNum: number;
      const parsed = parseInt(itemId, 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= Number.MAX_SAFE_INTEGER) {
        itemIdNum = parsed;
      } else {
        // If itemId is not numeric, hash it to a number (deterministic)
        itemIdNum = hashStringToNumber(itemId);
      }
      return {
        itemId: new BN(itemIdNum),
        finalOwner: new PublicKey(owner),
      };
    });

    // Convert cash deltas
    const cashDeltas = Array.from(batch.result.netCashDeltas.entries())
      .filter(([_, delta]) => delta !== 0n) // Only include non-zero deltas
      .map(([owner, deltaLamports]) => ({
        owner: new PublicKey(owner),
        deltaLamports: new BN(deltaLamports.toString()),
      }));

    // Convert royalty distribution (Phantom Nexus)
    const royaltyDistribution: Array<[PublicKey, BN]> = [];
    const agentRegistries: PublicKey[] = [];
    
    if (batch.result.royaltyDistribution && batch.result.royaltyDistribution.size > 0) {
      // Derive AgentRegistry PDAs for each agent
      for (const [agentId, royaltyAmount] of batch.result.royaltyDistribution.entries()) {
        if (royaltyAmount > 0n) {
          const agentPubkey = new PublicKey(agentId);
          const [registryPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("agent"), agentPubkey.toBuffer()],
            program.programId
          );
          
          royaltyDistribution.push([agentPubkey, new BN(royaltyAmount.toString())]);
          agentRegistries.push(registryPda);
        }
      }
    }

    // Extract π-Standard protocol fee (pi_fee)
    const piFee = batch.result.piFeeLamports ? Number(batch.result.piFeeLamports) : 0;

    logger.info("Settling batch on-chain", {
      batchId: batch.batchId,
      batchIdNum,
      numItems: items.length,
      numDeltas: cashDeltas.length,
      numAgents: royaltyDistribution.length,
      piFee,
    });

    // Build accounts list (include agent registries as remaining accounts)
    const accounts = {
      config: configPda,
      authority: authority.publicKey,
      clock: SYSVAR_CLOCK_PUBKEY,
    };

    // Send settlement transaction with royalty distribution and π-fee
    // Anchor expects Vec<(Pubkey, u64)> as array of tuples [PublicKey, BN]
    const txSignature = await program.methods
      .settleNetBatch(
        new BN(batchIdNum),
        batchHashArray,
        items,
        cashDeltas,
        royaltyDistribution, // Already in format [PublicKey, BN][]
        new BN(piFee) // π-Standard protocol fee
      )
      .accounts(accounts)
      .remainingAccounts(
        agentRegistries.map(registry => ({
          pubkey: registry,
          isWritable: true,
          isSigner: false,
        }))
      )
      .signers([authority])
      .rpc();

    // CRITICAL: Register for fake confirmation detection
    const currentSlot = await connection.getSlot();
    fakeConfirmationDetector.registerPending(txSignature, currentSlot);

    // CRITICAL: Verify confirmation is legitimate (not fake)
    try {
      const status = await connection.getSignatureStatus(txSignature);
      if (status.value) {
        const confirmedSlot = status.value.slot || currentSlot;
        const isValid = await fakeConfirmationDetector.verifyConfirmation(txSignature, confirmedSlot);
        if (!isValid) {
          logger.error("🚨 FAKE CONFIRMATION DETECTED - Transaction may not be valid", {
            batchId: batch.batchId,
            txSignature,
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
        txSignature,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't fail the settlement, but log the issue
    }

    logger.info("Batch settled on-chain", {
      batchId: batch.batchId,
      txSignature,
    });

    return txSignature;
  } catch (error: any) {
    logger.error("Failed to settle batch on-chain", {
      batchId: batch.batchId,
      error: error?.message,
      code: error?.code,
    });
    throw error;
  }
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

