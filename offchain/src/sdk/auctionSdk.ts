/**
 * ======================================================================
 * PHANTOMGRID AUCTION SDK - TypeScript
 * ======================================================================
 * 
 * Developer-friendly SDK for batch auction operations.
 * 
 * Features:
 * - batchCommitAuctions: Commit 1,000+ auctions in one tx
 * - settleAuction: Settle individual auctions with proofs
 * - adminSeizeListing: Admin seizure for fraud/compliance
 * 
 * Data Flow:
 * 1. Developer calls batchCommitAuctions with auction array
 * 2. SDK builds Merkle tree off-chain
 * 3. SDK submits commit_auctions_root tx
 * 4. SDK returns batch_id, root, and proof map
 * 5. For settlement, SDK fetches proof from indexer/DB
 * 6. SDK builds and sends verify_and_settle_auction tx
 * 
 * Failure Modes:
 * - RPC connection failures
 * - Transaction failures (insufficient funds, compute limits)
 * - Invalid auction data
 * - Missing proofs (if indexer not synced)
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  buildAuctionTree,
  AuctionInput,
  BatchCommitResult,
  getProofForAuction,
  MerkleProof,
} from "../compression/treeBuilder";
import {
  VirtualBundler,
  SettlementInput,
  BundlerConfig,
} from "../bundler/virtualBundler";

/**
 * SDK configuration
 */
export interface AuctionSdkConfig {
  connection: Connection;
  programId: PublicKey;
  wallet: Wallet;
  bundlerConfig?: Partial<BundlerConfig>;
  indexerUrl?: string; // For fetching proofs if not in local DB
}

/**
 * Batch commit result (user-facing)
 */
export interface BatchCommitResponse {
  batchId: number;
  root: string; // Base58 encoded
  auctionCount: number;
  startLeafIndex: number;
  endLeafIndex: number;
  transactionSignature: string;
  proofs: Map<number | bigint, {
    proof: string[]; // Base58 encoded
    leaf: string; // Base58 encoded
    leafIndex: number;
  }>;
}

/**
 * Settlement result
 */
export interface SettlementResponse {
  auctionId: number | bigint;
  transactionSignature: string;
  price: number | bigint;
  winner: string;
}

/**
 * Admin seizure result
 */
export interface SeizureResponse {
  auctionId: number | bigint;
  transactionSignature: string;
  destination: string;
  reasonCode: number;
}

/**
 * Main SDK class
 */
export class PhantomGridAuctionSdk {
  private connection: Connection;
  private programId: PublicKey;
  private provider: AnchorProvider;
  private program: Program;
  private bundler: VirtualBundler;
  private config: AuctionSdkConfig;

  constructor(config: AuctionSdkConfig) {
    this.connection = config.connection;
    this.programId = config.programId;
    this.config = config;

    // Create provider
    this.provider = new AnchorProvider(
      config.connection,
      config.wallet,
      { commitment: "confirmed" }
    );

    // Load program (in production, load from IDL)
    // this.program = new Program(idl, this.programId, this.provider);
    // For now, we'll use a placeholder - in production, load actual IDL
    this.program = {} as Program;

    // Create bundler
    const bundlerConfig: BundlerConfig = {
      rpcUrl: config.connection.rpcEndpoint,
      useJito: config.bundlerConfig?.useJito ?? false,
      useALTs: config.bundlerConfig?.useALTs ?? true,
      maxTxPerBundle: config.bundlerConfig?.maxTxPerBundle ?? 10,
      maxAccountsPerTx: config.bundlerConfig?.maxAccountsPerTx ?? 64,
      jitoBlockEngineUrl: config.bundlerConfig?.jitoBlockEngineUrl,
      jitoTipAccount: config.bundlerConfig?.jitoTipAccount
        ? new PublicKey(config.bundlerConfig.jitoTipAccount)
        : undefined,
    };

    this.bundler = new VirtualBundler(
      this.connection,
      bundlerConfig,
      this.provider,
      this.program
    );
  }

  /**
   * Batch commit auctions (1,000+ in one transaction)
   * 
   * @param game Game public key
   * @param auctions Array of auction inputs
   * @param serverAuthority Server authority keypair (must sign)
   * @returns Batch commit result with proofs
   */
  async batchCommitAuctions(
    game: PublicKey,
    auctions: AuctionInput[],
    serverAuthority: Keypair
  ): Promise<BatchCommitResponse> {
    if (auctions.length === 0) {
      throw new Error("Cannot commit empty auction array");
    }

    if (auctions.length > 10_000) {
      throw new Error("Batch size exceeds maximum (10,000 auctions)");
    }

    // Get current leaf count from tree config (in production, fetch from on-chain)
    // For now, assume starting from 0
    const startLeafIndex = 0;
    const batchId = Date.now();

    // Build Merkle tree
    const treeResult = buildAuctionTree(auctions, startLeafIndex, batchId);

    // Build commit transaction
    const commitTx = await this.bundler.buildCommitTransaction(
      this.programId,
      game,
      batchId,
      treeResult.root,
      treeResult.auctionCount,
      treeResult.startLeafIndex,
      serverAuthority.publicKey,
      serverAuthority.publicKey
    );

    // Sign and send
    commitTx.sign(serverAuthority);
    const signature = await sendAndConfirmTransaction(
      this.connection,
      commitTx,
      [serverAuthority],
      { commitment: "confirmed" }
    );

    // Convert proofs to user-friendly format
    const proofsMap = new Map<number | bigint, {
      proof: string[];
      leaf: string;
      leafIndex: number;
    }>();

    for (const [auctionId, proof] of treeResult.proofs.entries()) {
      proofsMap.set(auctionId, {
        proof: proof.proof.map((p) => p.toString("base58")),
        leaf: proof.leaf.toString("base58"),
        leafIndex: proof.leafIndex,
      });
    }

    return {
      batchId,
      root: treeResult.root.toString("base58"),
      auctionCount: treeResult.auctionCount,
      startLeafIndex: treeResult.startLeafIndex,
      endLeafIndex: treeResult.endLeafIndex,
      transactionSignature: signature,
      proofs: proofsMap,
    };
  }

  /**
   * Settle an auction
   * 
   * @param game Game public key
   * @param auctionId Auction ID
   * @param batchId Batch ID
   * @param winner Winner public key
   * @param settlementPrice Settlement price
   * @param proof Merkle proof (if not provided, fetched from indexer)
   * @param leafData Auction leaf data (if not provided, fetched from indexer)
   * @returns Settlement result
   */
  async settleAuction(
    game: PublicKey,
    auctionId: number | bigint,
    batchId: number | bigint,
    winner: PublicKey,
    settlementPrice: number | bigint,
    proof?: MerkleProof,
    leafData?: any // Auction leaf data from indexer
  ): Promise<SettlementResponse> {
    // If proof/leafData not provided, fetch from indexer
    if (!proof || !leafData) {
      const fetched = await this.fetchAuctionData(auctionId, batchId);
      proof = proof || fetched.proof;
      leafData = leafData || fetched.leafData;
    }

    if (!proof || !leafData) {
      throw new Error("Missing proof or leaf data for auction");
    }

    // Build settlement input
    const settlement: SettlementInput = {
      auctionId,
      batchId,
      leafIndex: proof.leafIndex,
      proof: proof.proof,
      game: game.toString(),
      seller: leafData.seller,
      assetMint: leafData.assetMint,
      startPrice: leafData.startPrice,
      buyNowPrice: leafData.buyNowPrice,
      reservePrice: leafData.reservePrice,
      startTs: leafData.startTs,
      endTs: leafData.endTs,
      statusFlags: leafData.statusFlags,
      kind: leafData.kind,
      quantity: leafData.quantity,
      creator: leafData.creator,
      royaltyBps: leafData.royaltyBps,
      winner: winner.toString(),
      settlementPrice,
      currencyMint: leafData.currencyMint || "", // Should be from game config
      merkleTree: leafData.merkleTree || "", // Should be from tree config
    };

    // Build settlement batch
    const batch = await this.bundler.buildSettlementBatch(
      this.programId,
      [settlement]
    );

    if (batch.transactions.length === 0) {
      throw new Error("Failed to build settlement transaction");
    }

    // Get winner keypair (in production, this should be passed in)
    // For now, assume it's available in wallet
    const winnerKeypair = this.config.wallet.payer as Keypair;

    // Sign and send
    const tx = batch.transactions[0];
    tx.sign(winnerKeypair);
    const signature = await sendAndConfirmTransaction(
      this.connection,
      tx,
      [winnerKeypair],
      { commitment: "confirmed" }
    );

    return {
      auctionId,
      transactionSignature: signature,
      price: settlementPrice,
      winner: winner.toString(),
    };
  }

  /**
   * Admin seizure of a listing
   * 
   * @param game Game public key
   * @param auctionId Auction ID
   * @param batchId Batch ID
   * @param adminAuthority Admin authority keypair
   * @param complianceVault Destination for seized asset
   * @param reasonCode Reason code (0=UNSPECIFIED, 1=FRAUD, 2=TOS_VIOLATION, etc.)
   * @returns Seizure result
   */
  async adminSeizeListing(
    game: PublicKey,
    auctionId: number | bigint,
    batchId: number | bigint,
    adminAuthority: Keypair,
    complianceVault: PublicKey,
    reasonCode: number = 0
  ): Promise<SeizureResponse> {
    // Fetch auction data
    const fetched = await this.fetchAuctionData(auctionId, batchId);
    if (!fetched.proof || !fetched.leafData) {
      throw new Error("Missing proof or leaf data for auction");
    }

    // Build seizure instruction (similar to settlement)
    // In production, use program.methods.adminSeizeListing()
    // For now, return placeholder
    const signature = "placeholder"; // TODO: Implement actual seizure

    return {
      auctionId,
      transactionSignature: signature,
      destination: complianceVault.toString(),
      reasonCode,
    };
  }

  /**
   * Fetch auction data from indexer/DB
   */
  private async fetchAuctionData(
    auctionId: number | bigint,
    batchId: number | bigint
  ): Promise<{
    proof?: MerkleProof;
    leafData?: any;
  }> {
    // In production, fetch from indexer API or local DB
    // For now, return empty (should be implemented)
    if (this.config.indexerUrl) {
      // Fetch from indexer
      // const response = await fetch(`${this.config.indexerUrl}/auctions/${auctionId}`);
      // return await response.json();
    }

    // Fallback: fetch from local DB (if available)
    // This would use your existing DB connection

    return {};
  }
}

/**
 * Factory function to create SDK instance
 */
export function createAuctionSdk(config: AuctionSdkConfig): PhantomGridAuctionSdk {
  return new PhantomGridAuctionSdk(config);
}

