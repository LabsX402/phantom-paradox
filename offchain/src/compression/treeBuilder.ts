/**
 * ======================================================================
 * HYPERSCALE AUCTION TREE BUILDER
 * ======================================================================
 * 
 * Builds Merkle trees for batch auction commits (1,000+ auctions per batch).
 * Uses Keccak256 hashing to match on-chain compression logic.
 * 
 * Data Flow:
 * 1. Accept array of auction inputs
 * 2. Convert each to AuctionLeaf structure
 * 3. Hash each leaf
 * 4. Build Merkle tree from hashes
 * 5. Generate proofs for each leaf
 * 6. Return root + proofs map
 * 
 * Failure Modes:
 * - Invalid auction data (missing fields, invalid timestamps)
 * - Tree depth exceeded (max 2^24 leaves)
 * - Hash computation failures
 */

import { PublicKey } from "@solana/web3.js";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

/**
 * Auction input structure (what developers provide)
 */
export interface AuctionInput {
  auctionId: number | bigint;
  seller: PublicKey | string;
  assetMint: PublicKey | string;
  startPrice: number | bigint;
  buyNowPrice: number | bigint;
  reservePrice: number | bigint;
  startTs: number | bigint;
  endTs: number | bigint;
  kind: number; // 0=Fixed, 1=English, 2=Dutch
  quantity: number | bigint;
  creator: PublicKey | string;
  royaltyBps: number;
}

/**
 * Auction leaf structure (matches on-chain AuctionLeaf)
 */
export interface AuctionLeaf {
  auctionId: bigint;
  seller: PublicKey;
  assetMint: PublicKey;
  startPrice: bigint;
  buyNowPrice: bigint;
  reservePrice: bigint;
  startTs: bigint;
  endTs: bigint;
  statusFlags: number; // Bitflags: bit 0 = active
  kind: number;
  quantity: bigint;
  creator: PublicKey;
  royaltyBps: number;
  reserved: Uint8Array; // 6 bytes
}

/**
 * Merkle proof result
 */
export interface MerkleProof {
  root: Buffer;
  proof: Buffer[];
  leaf: Buffer;
  leafIndex: number;
}

/**
 * Batch commit result
 */
export interface BatchCommitResult {
  batchId: number;
  root: Buffer;
  auctionCount: number;
  startLeafIndex: number;
  endLeafIndex: number;
  proofs: Map<number | bigint, MerkleProof>; // auctionId -> proof
  leaves: AuctionLeaf[];
}

/**
 * Convert auction input to leaf structure
 */
export function auctionInputToLeaf(input: AuctionInput): AuctionLeaf {
  return {
    auctionId: BigInt(input.auctionId),
    seller: typeof input.seller === "string" 
      ? new PublicKey(input.seller) 
      : input.seller,
    assetMint: typeof input.assetMint === "string"
      ? new PublicKey(input.assetMint)
      : input.assetMint,
    startPrice: BigInt(input.startPrice),
    buyNowPrice: BigInt(input.buyNowPrice),
    reservePrice: BigInt(input.reservePrice),
    startTs: BigInt(input.startTs),
    endTs: BigInt(input.endTs),
    statusFlags: 0x01, // Active by default
    kind: input.kind,
    quantity: BigInt(input.quantity),
    creator: typeof input.creator === "string"
      ? new PublicKey(input.creator)
      : input.creator,
    royaltyBps: input.royaltyBps,
    reserved: new Uint8Array(6), // All zeros
  };
}

/**
 * Hash an auction leaf (matches on-chain keccak256 hashing)
 */
export function hashAuctionLeaf(leaf: AuctionLeaf): Buffer {
  const hasher = keccak256();
  
  // Serialize leaf data in same order as on-chain
  const data = Buffer.concat([
    bufferFromBigInt(leaf.auctionId, 8),
    leaf.seller.toBuffer(),
    leaf.assetMint.toBuffer(),
    bufferFromBigInt(leaf.startPrice, 8),
    bufferFromBigInt(leaf.buyNowPrice, 8),
    bufferFromBigInt(leaf.reservePrice, 8),
    bufferFromBigInt(leaf.startTs, 8),
    bufferFromBigInt(leaf.endTs, 8),
    Buffer.from([leaf.statusFlags]),
    Buffer.from([leaf.kind]),
    bufferFromBigInt(leaf.quantity, 8),
    leaf.creator.toBuffer(),
    Buffer.from([leaf.royaltyBps & 0xFF, (leaf.royaltyBps >> 8) & 0xFF]),
    Buffer.from(leaf.reserved),
  ]);
  
  return keccak256(data);
}

/**
 * Helper to convert bigint to little-endian buffer
 */
function bufferFromBigInt(value: bigint, bytes: number): Buffer {
  const buf = Buffer.allocUnsafe(bytes);
  let v = value;
  for (let i = 0; i < bytes; i++) {
    buf[i] = Number(v & 0xFFn);
    v = v >> 8n;
  }
  return buf;
}

/**
 * Build Merkle tree from auction inputs
 * 
 * @param auctions Array of auction inputs
 * @param startLeafIndex Starting leaf index (for batch tracking)
 * @param batchId Batch identifier
 * @returns Batch commit result with root and proofs
 */
export function buildAuctionTree(
  auctions: AuctionInput[],
  startLeafIndex: number = 0,
  batchId: number = Date.now()
): BatchCommitResult {
  if (auctions.length === 0) {
    throw new Error("Cannot build tree from empty auction array");
  }
  
  if (auctions.length > 10_000) {
    throw new Error("Batch size exceeds maximum (10,000 auctions)");
  }
  
  // Convert inputs to leaves
  const leaves: AuctionLeaf[] = auctions.map(auctionInputToLeaf);
  
  // Hash each leaf
  const leafHashes: Buffer[] = leaves.map(hashAuctionLeaf);
  
  // Build Merkle tree
  const tree = new MerkleTree(leafHashes, keccak256, {
    sortPairs: false,
    hashLeaves: false, // We already hashed the leaves
  });
  
  // Get root
  const root = tree.getRoot();
  
  // Generate proofs for each leaf
  const proofs = new Map<number | bigint, MerkleProof>();
  
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    const leafHash = leafHashes[i];
    const proof = tree.getProof(leafHash);
    const leafIndex = startLeafIndex + i;
    
    proofs.set(leaf.auctionId, {
      root,
      proof: proof.map((p) => Buffer.from(p.data)),
      leaf: leafHash,
      leafIndex,
    });
  }
  
  return {
    batchId,
    root,
    auctionCount: auctions.length,
    startLeafIndex,
    endLeafIndex: startLeafIndex + auctions.length,
    proofs,
    leaves,
  };
}

/**
 * Verify a Merkle proof
 */
export function verifyProof(
  leaf: Buffer,
  proof: Buffer[],
  root: Buffer
): boolean {
  const tree = new MerkleTree([], keccak256, {
    sortPairs: false,
    hashLeaves: false,
  });
  
  return tree.verify(proof, leaf, root);
}

/**
 * Get proof for a specific auction ID from a batch result
 */
export function getProofForAuction(
  batchResult: BatchCommitResult,
  auctionId: number | bigint
): MerkleProof | null {
  return batchResult.proofs.get(auctionId) || null;
}

