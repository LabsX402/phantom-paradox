/**
 * Merkle Proof Generator for SPL Account Compression
 * 
 * This script generates Merkle proofs required for buy_compressed_listing,
 * cancel_compressed_listing, and other compression operations.
 * 
 * Uses @solana/spl-account-compression SDK which matches the on-chain
 * SPL Account Compression program's Merkle tree structure.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  ConcurrentMerkleTreeAccount,
  getLeafAssetId,
} from "@solana/spl-account-compression";
import keccak256 from "keccak";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { MerkleTree } from "merkletreejs";

/**
 * CompressedListing structure matching Rust side
 */
export interface CompressedListingData {
  game_id: number;
  listing_id: number;
  seller: PublicKey;
  kind: number; // 0=Fixed, 1=English, 2=Dutch
  currency_mint: PublicKey;
  item_mint: PublicKey;
  quantity: number;
  price: number;
  end_time: number;
  creator: PublicKey;
  royalty_bps: number;
  bump: number;
}

/**
 * Hash a CompressedListing to get the leaf hash
 * Matches the Rust implementation in state/compression.rs
 */
export function hashCompressedListing(listing: CompressedListingData): Buffer {
  const hasher = keccak256.create();
  
  // Hash each field in the same order as Rust
  hasher.update(Buffer.from(new BN(listing.game_id).toArray("le", 8)));
  hasher.update(Buffer.from(new BN(listing.listing_id).toArray("le", 8)));
  hasher.update(listing.seller.toBuffer());
  hasher.update(Buffer.from([listing.kind]));
  hasher.update(listing.currency_mint.toBuffer());
  hasher.update(listing.item_mint.toBuffer());
  hasher.update(Buffer.from(new BN(listing.quantity).toArray("le", 8)));
  hasher.update(Buffer.from(new BN(listing.price).toArray("le", 8)));
  hasher.update(Buffer.from(new BN(listing.end_time).toArray("le", 8)));
  hasher.update(listing.creator.toBuffer());
  hasher.update(Buffer.from(new BN(listing.royalty_bps).toArray("le", 2)));
  hasher.update(Buffer.from([listing.bump]));
  
  return Buffer.from(hasher.digest());
}

/**
 * Get Merkle proof for a leaf in a ConcurrentMerkleTree
 * 
 * IMPORTANT: SPL Account Compression uses a specific Merkle tree structure.
 * You need to maintain an off-chain index of all leaves to generate proofs.
 * 
 * This function assumes you have:
 * 1. Tracked all leaves as they were added (via events/logs)
 * 2. Maintained the tree structure off-chain
 * 
 * @param connection - Solana RPC connection
 * @param merkleTree - PublicKey of the Merkle tree account
 * @param leafHash - Hash of the leaf to get proof for
 * @param leafIndex - Index of the leaf in the tree
 * @param allLeaves - Array of all leaf hashes in the tree (must be maintained off-chain)
 * @returns Proof data including root, proof path, and leaf index
 */
export async function getMerkleProof(
  connection: Connection,
  merkleTree: PublicKey,
  leafHash: Buffer,
  leafIndex: number,
  allLeaves: Buffer[] // Must be provided from your indexer
): Promise<{
  root: Buffer;
  proof: Buffer[];
  leafIndex: number;
  leafHash: Buffer;
}> {
  // Fetch the ConcurrentMerkleTree account to get tree parameters
  const treeAccount = await ConcurrentMerkleTreeAccount.fromAccountAddress(
    connection,
    merkleTree
  );

  const maxDepth = treeAccount.getMaxDepth();
  const maxBufferSize = treeAccount.getMaxBufferSize();

  // Rebuild the Merkle tree from all leaves
  // Note: SPL Account Compression uses keccak256 for hashing
  const hashFn = (data: Buffer) => {
    const hasher = keccak256("keccak256");
    hasher.update(data);
    return Buffer.from(hasher.digest());
  };

  // Create Merkle tree from leaves
  // Pad with empty leaves (zeros) to match tree size
  const emptyLeaf = Buffer.alloc(32);
  const paddedLeaves = [...allLeaves];
  while (paddedLeaves.length < Math.pow(2, maxDepth)) {
    paddedLeaves.push(emptyLeaf);
  }

  const tree = new MerkleTree(paddedLeaves, hashFn, {
    sortPairs: false,
    hashLeaves: false, // Leaves are already hashed
  });

  // Get the current root from on-chain
  const onChainRoot = treeAccount.getCurrentRoot();
  
  // Verify our off-chain root matches on-chain root
  const offChainRoot = tree.getRoot();
  if (!onChainRoot.equals(offChainRoot)) {
    throw new Error(
      `Root mismatch! On-chain: ${onChainRoot.toString("hex")}, Off-chain: ${offChainRoot.toString("hex")}`
    );
  }

  // Generate proof for the leaf
  const proof = tree.getProof(leafHash, leafIndex);

  return {
    root: Buffer.from(onChainRoot),
    proof: proof.map((p) => Buffer.from(p.data)),
    leafIndex,
    leafHash,
  };
}

/**
 * Generate proof for buy_compressed_listing
 * 
 * @param connection - Solana RPC connection
 * @param merkleTree - PublicKey of the game's Merkle tree
 * @param listingData - CompressedListing data
 * @param leafIndex - Index of the listing in the tree
 * @param allLeaves - Array of all leaf hashes in the tree (must be maintained off-chain)
 * @returns Proof data ready for buy_compressed_listing instruction
 */
export async function generateBuyProof(
  connection: Connection,
  merkleTree: PublicKey,
  listingData: CompressedListingData,
  leafIndex: number,
  allLeaves: Buffer[] // Must be provided from your indexer
): Promise<{
  root: Buffer;
  dataHash: Buffer;
  creatorHash: Buffer; // Can be [0;32] if not used
  nonce: number;
  index: number;
  proof: Buffer[];
  listingData: CompressedListingData;
}> {
  // Hash the listing to get data_hash
  const dataHash = hashCompressedListing(listingData);

  // Verify the leaf hash matches at the given index
  if (!allLeaves[leafIndex] || !allLeaves[leafIndex].equals(dataHash)) {
    throw new Error(
      `Leaf hash mismatch at index ${leafIndex}. Expected: ${dataHash.toString("hex")}, Got: ${allLeaves[leafIndex]?.toString("hex") || "undefined"}`
    );
  }

  // Get Merkle proof
  const proofData = await getMerkleProof(
    connection,
    merkleTree,
    dataHash,
    leafIndex,
    allLeaves
  );

  return {
    root: proofData.root,
    dataHash: proofData.leafHash,
    creatorHash: Buffer.alloc(32), // Not used in current implementation
    nonce: leafIndex, // Using leaf index as nonce
    index: leafIndex,
    proof: proofData.proof,
    listingData,
  };
}

/**
 * Example usage: Generate proof and call buy_compressed_listing
 */
export async function exampleBuyCompressedListing(
  connection: Connection,
  program: anchor.Program,
  buyer: Keypair,
  merkleTree: PublicKey,
  listingData: CompressedListingData,
  leafIndex: number
) {
  // Generate proof
  const proofData = await generateBuyProof(
    connection,
    merkleTree,
    listingData,
    leafIndex
  );

  // Convert proof buffers to arrays for Anchor
  const proofArray = proofData.proof.map((p) => Array.from(p)) as [number[]];

  // Call buy_compressed_listing
  const tx = await program.methods
    .buyCompressedListing(
      Array.from(proofData.root),
      Array.from(proofData.dataHash),
      Array.from(proofData.creatorHash),
      new BN(proofData.nonce),
      proofData.index,
      proofArray,
      new BN(listingData.listing_id),
      listingData.kind,
      new BN(listingData.quantity),
      new BN(listingData.price),
      new BN(listingData.end_time),
      listingData.creator,
      listingData.royalty_bps
    )
    .accounts({
      config: /* config PDA */,
      game: /* game PDA */,
      buyer: buyer.publicKey,
      seller: listingData.seller,
      itemMint: listingData.item_mint,
      currencyMint: listingData.currency_mint,
      buyerTokenAccount: /* buyer token account */,
      sellerTokenAccount: /* seller token account */,
      buyerItemAccount: /* buyer item account */,
      sellerItemAccount: /* seller item account */,
      protocolTreasury: /* protocol treasury */,
      protocolTreasuryTokenAccount: /* protocol treasury token account */,
      gameOwnerWallet: /* game owner wallet */,
      gameOwnerTokenAccount: /* game owner token account */,
      creatorTokenAccount: /* creator token account */,
      merkleTree: merkleTree,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
      logWrapper: SPL_NOOP_PROGRAM_ID,
      tokenProgram: /* token program */,
      associatedTokenProgram: /* associated token program */,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([buyer])
    .rpc();

  return tx;
}

/**
 * Helper: Get active leaf count from on-chain tree
 * 
 * NOTE: To get actual leaves, you MUST track them via:
 * 1. CompressedListingCreated events from your program
 * 2. SPL Account Compression program logs
 * 3. Your indexer database
 * 
 * This function only returns the count, not the actual leaves.
 */
export async function getActiveLeafCount(
  connection: Connection,
  merkleTree: PublicKey
): Promise<number> {
  const treeAccount = await ConcurrentMerkleTreeAccount.fromAccountAddress(
    connection,
    merkleTree
  );

  return treeAccount.getActiveLeafCount().toNumber();
}

