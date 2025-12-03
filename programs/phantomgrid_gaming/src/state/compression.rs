use anchor_lang::prelude::*;
use solana_program::keccak;
#[cfg(feature = "compression")]
use spl_account_compression::program::SplAccountCompression;
#[cfg(feature = "compression")]
use spl_noop::program::SplNoop;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CompressedListing {
    pub game_id: u64,
    pub listing_id: u64,
    pub seller: Pubkey,
    pub kind: u8, // 0=Fixed, 1=English, 2=Dutch
    pub currency_mint: Pubkey,
    pub item_mint: Pubkey,
    pub quantity: u64,
    pub price: u64,
    pub end_time: i64,
    pub creator: Pubkey,
    pub royalty_bps: u16,
    pub bump: u8, // For stateless PDA derivation if needed
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CompressedBid {
    pub game_id: u64,
    pub listing_id: u64, // Target listing (if specific) or 0 for collection offer
    pub bidder: Pubkey,
    pub price: u64,
    pub expiry: i64,
    pub nonce: u64, // To ensure uniqueness
}

impl CompressedListing {
    // Hash function for the leaf
    pub fn hash(&self) -> [u8; 32] {
        let mut hasher = keccak::Hasher::default();
        hasher.hash(&self.game_id.to_le_bytes());
        hasher.hash(&self.listing_id.to_le_bytes());
        hasher.hash(self.seller.as_ref());
        hasher.hash(&[self.kind]);
        hasher.hash(self.currency_mint.as_ref());
        hasher.hash(self.item_mint.as_ref());
        hasher.hash(&self.quantity.to_le_bytes());
        hasher.hash(&self.price.to_le_bytes());
        hasher.hash(&self.end_time.to_le_bytes());
        hasher.hash(self.creator.as_ref());
        hasher.hash(&self.royalty_bps.to_le_bytes());
        hasher.hash(&[self.bump]);
        hasher.result().to_bytes()
    }
}

impl CompressedBid {
    pub fn hash(&self) -> [u8; 32] {
        let mut hasher = keccak::Hasher::default();
        hasher.hash(&self.game_id.to_le_bytes());
        hasher.hash(&self.listing_id.to_le_bytes());
        hasher.hash(self.bidder.as_ref());
        hasher.hash(&self.price.to_le_bytes());
        hasher.hash(&self.expiry.to_le_bytes());
        hasher.hash(&self.nonce.to_le_bytes());
        hasher.result().to_bytes()
    }
}

// ======================================================================
// HYPERSCALE AUCTION COMPRESSION - Batch Root Commit Pattern
// ======================================================================
// This enables committing 1,000+ auctions in a single transaction
// by storing only Merkle roots on-chain, with full data in leaves.

/// Compressed auction leaf structure for batch root commits.
/// This is the minimal on-chain representation of an auction.
///
/// OPTIMIZATION: Uses metadata hash instead of full data to minimize on-chain storage.
/// Full auction details (names, descriptions, images) are stored on Shadow Drive/IPFS.
/// Trade history and ownership data are stored in No-Op logs (free, indexer-readable).
///
/// This enables "Near-Zero Cost" by:
/// 1. Storing only hash pointers (32 bytes) instead of full metadata
/// 2. Using No-Op logs for trade history (zero rent cost)
/// 3. Shadow Drive/IPFS for heavy metadata (cheaper than on-chain)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct AuctionLeaf {
    /// Unique auction identifier (u64 for compactness, can be hash-derived)
    pub auction_id: u64,

    /// Seller public key (32 bytes)
    pub seller: Pubkey,

    /// Asset reference - OPTIMIZED: Can be:
    /// - Mint address for on-chain assets (if already minted)
    /// - Metadata hash (32 bytes) for lazy-minted items (mint on first trade)
    /// - Item ID hash for off-chain items (stored in SQL until first listing)
    pub asset_mint_or_hash: Pubkey, // Dual-purpose: mint address OR metadata hash

    /// Price information - compacted into minimal fields
    /// start_price: base price for auctions
    /// buy_now_price: optional immediate purchase price (0 = disabled)
    /// reserve_price: minimum acceptable bid (0 = no reserve)
    pub start_price: u64,
    pub buy_now_price: u64,
    pub reserve_price: u64,

    /// Timing - compacted timestamps
    /// start_ts: auction start time (i64 unix timestamp)
    /// end_ts: auction end time (i64 unix timestamp)
    pub start_ts: i64,
    pub end_ts: i64,

    /// Status flags - bitflags for efficient storage
    /// Bit 0: active (1 = active, 0 = inactive)
    /// Bit 1: cancelled (1 = cancelled)
    /// Bit 2: settled (1 = settled)
    /// Bit 3: seized (1 = admin-seized)
    /// Bits 4-7: reserved for future use
    pub status_flags: u8,

    /// Auction kind: 0=Fixed, 1=English, 2=Dutch
    pub kind: u8,

    /// Quantity available (for multi-item listings)
    pub quantity: u64,

    /// Creator/royalty recipient
    pub creator: Pubkey,

    /// Royalty basis points (0-10000, where 10000 = 100%)
    pub royalty_bps: u16,

    /// Reserved for future extensions (maintains 32-byte alignment)
    pub reserved: [u8; 6],
}

impl AuctionLeaf {
    /// Compute the hash of an auction leaf for Merkle tree inclusion.
    /// This hash is what gets stored in the Merkle tree.
    ///
    /// OPTIMIZATION: Only hashes essential data. Metadata is stored off-chain.
    pub fn hash(&self) -> [u8; 32] {
        let mut hasher = keccak::Hasher::default();
        hasher.hash(&self.auction_id.to_le_bytes());
        hasher.hash(self.seller.as_ref());
        hasher.hash(self.asset_mint_or_hash.as_ref()); // Can be mint OR metadata hash
        hasher.hash(&self.start_price.to_le_bytes());
        hasher.hash(&self.buy_now_price.to_le_bytes());
        hasher.hash(&self.reserve_price.to_le_bytes());
        hasher.hash(&self.start_ts.to_le_bytes());
        hasher.hash(&self.end_ts.to_le_bytes());
        hasher.hash(&[self.status_flags]);
        hasher.hash(&[self.kind]);
        hasher.hash(&self.quantity.to_le_bytes());
        hasher.hash(self.creator.as_ref());
        hasher.hash(&self.royalty_bps.to_le_bytes());
        hasher.hash(&self.reserved);
        hasher.result().to_bytes()
    }

    /// Check if auction is active
    pub fn is_active(&self) -> bool {
        (self.status_flags & 0x01) != 0
    }

    /// Check if auction is cancelled
    pub fn is_cancelled(&self) -> bool {
        (self.status_flags & 0x02) != 0
    }

    /// Check if auction is settled
    pub fn is_settled(&self) -> bool {
        (self.status_flags & 0x04) != 0
    }

    /// Check if auction is seized
    pub fn is_seized(&self) -> bool {
        (self.status_flags & 0x08) != 0
    }

    /// Mark auction as active
    pub fn set_active(&mut self) {
        self.status_flags |= 0x01;
    }

    /// Mark auction as cancelled
    pub fn set_cancelled(&mut self) {
        self.status_flags |= 0x02;
        self.status_flags &= !0x01; // Clear active flag
    }

    /// Mark auction as settled
    pub fn set_settled(&mut self) {
        self.status_flags |= 0x04;
        self.status_flags &= !0x01; // Clear active flag
    }

    /// Mark auction as seized
    pub fn set_seized(&mut self) {
        self.status_flags |= 0x08;
        self.status_flags &= !0x01; // Clear active flag
    }
}
