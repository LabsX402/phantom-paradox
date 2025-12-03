# Compression Testing Guide

## Overview

This directory contains TypeScript scripts for testing SPL Account Compression operations, specifically `buy_compressed_listing`.

## Files

- **`compression_proofs.ts`** - Core utilities for generating Merkle proofs
- **`test_compressed_listing.ts`** - Complete test script for buy_compressed_listing

## Prerequisites

1. **Off-chain Indexer Required**: You MUST maintain an index of all Merkle tree leaves
   - Track `CompressedListingCreated` events from your program
   - Store leaf hashes and indices in a database
   - Rebuild tree structure off-chain for proof generation

2. **Dependencies**: Already installed in `package.json`
   - `@solana/spl-account-compression`
   - `keccak` (for hashing)
   - `merkletreejs` (for Merkle tree operations)

## How It Works

### 1. Hash Generation

The `hashCompressedListing()` function matches the Rust implementation in `state/compression.rs`:

```typescript
const listingHash = hashCompressedListing({
  game_id: 1,
  listing_id: 1,
  seller: sellerPubkey,
  kind: 0, // Fixed price
  currency_mint: usdcMint,
  item_mint: nftMint,
  quantity: 1,
  price: 1_000_000,
  end_time: Math.floor(Date.now() / 1000) + 86400,
  creator: creatorPubkey,
  royalty_bps: 500,
  bump: 0,
});
```

### 2. Proof Generation

```typescript
// You must provide all leaves from your indexer
const allLeaves: Buffer[] = await fetchLeavesFromIndexer(merkleTree);

const proofData = await generateBuyProof(
  connection,
  merkleTree,
  listingData,
  leafIndex,
  allLeaves
);
```

### 3. Calling buy_compressed_listing

```typescript
await program.methods
  .buyCompressedListing(
    Array.from(proofData.root),
    Array.from(proofData.dataHash),
    Array.from(proofData.creatorHash),
    new BN(proofData.nonce),
    proofData.index,
    proofData.proof.map((p) => Array.from(p)),
    // ... listing parameters
  )
  .accounts({ /* ... */ })
  .rpc();
```

## Critical Requirements

### Off-Chain Indexer

You **MUST** maintain an off-chain index because:

1. **SPL Account Compression doesn't expose leaf data on-chain**
   - Only the root hash is stored
   - Individual leaves are not queryable

2. **Proof generation requires all leaves**
   - You need to rebuild the tree structure
   - Track leaves as they're added via events

3. **Leaf tracking via events**:
   ```typescript
   // In your indexer/listener
   program.addEventListener("CompressedListingCreated", (event) => {
     await db.insertLeaf({
       tree: event.tree,
       leafIndex: event.leaf_index,
       leafHash: event.listing_hash,
       data: event,
     });
   });
   ```

## buy_compressed_listing Logic Verification

The on-chain logic is **sound**:

✅ **Hash Verification**: Reconstructs `CompressedListing` and verifies `data_hash` matches  
✅ **Merkle Proof**: Uses `verify_and_replace` to nullify the leaf (replaces with `[0u8; 32]`)  
✅ **Delegated Transfer**: Game PDA signs as delegate to transfer item from seller to buyer  
✅ **Fee Distribution**: Correctly calculates and distributes protocol fees, game fees, and royalties  
✅ **Pause Checks**: Enforces both global and game-level pause flags  

## Testing Workflow

1. **Initialize Game Tree**:
   ```bash
   anchor run init-game-tree --game-id 1 --max-depth 14 --max-buffer-size 64
   ```

2. **Create Compressed Listing**:
   ```bash
   anchor run create-compressed-listing --game-id 1 --listing-id 1 ...
   ```

3. **Index the Leaf**:
   - Your indexer should capture the `CompressedListingCreated` event
   - Store the leaf hash and index

4. **Generate Proof & Buy**:
   ```bash
   ts-node src/tests/test_compressed_listing.ts
   ```

## Troubleshooting

### "Root mismatch" Error

Your off-chain tree doesn't match on-chain. Ensure:
- All leaves are indexed correctly
- Tree is rebuilt with same hash function (keccak256)
- No leaves were missed or duplicated

### "Leaf hash mismatch" Error

The leaf at the given index doesn't match the listing data. Verify:
- Correct `leafIndex` from your indexer
- Listing data matches what was originally created
- Hash function matches Rust implementation

### "InvalidDataHash" On-Chain Error

The reconstructed `CompressedListing` hash doesn't match `data_hash`. Check:
- All fields match exactly (including `bump: 0`)
- Field order matches Rust implementation
- Endianness is correct (little-endian for numbers)

## Next Steps

1. **Integrate with your indexer**: Connect `compression_proofs.ts` to your database
2. **Add event tracking**: Ensure `CompressedListingCreated` events are captured
3. **Test end-to-end**: Run full workflow from listing creation to purchase
4. **Monitor tree state**: Keep off-chain tree in sync with on-chain state

