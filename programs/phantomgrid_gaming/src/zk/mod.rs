use anchor_lang::prelude::*;
#[cfg(feature = "zk")]
use light_sdk::compressed_account::CompressedAccount;
#[cfg(feature = "zk")]
use light_sdk::LightDiscriminator;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, LightDiscriminator)]
#[light_discriminator(
    // This is a unique identifier for the ZkListing type in the ZK state tree
    // We use a random byte array or derive it. For now, we let the macro handle it if possible,
    // or provide a fixed seed. Light SDK macros often auto-derive.
)]
pub struct ZkListing {
    pub game_id: u64,
    pub listing_id: u64,
    pub seller: Pubkey,
    pub item_mint: Pubkey,
    pub currency_mint: Pubkey,
    pub price: u64,
    pub quantity: u64,
    pub end_time: i64,
    pub creator: Pubkey,
    pub royalty_bps: u16,
}

impl CompressedAccount for ZkListing {}

// ZK Compression Event
#[event]
pub struct ZkListingCreated {
    pub game_id: u64,
    pub listing_id: u64,
    pub seller: Pubkey,
    pub compressed_address: [u8; 32], // The hash of the compressed account
}

#[error_code]
pub enum ZkError {
    #[msg("ZK Proof Verification Failed")]
    InvalidProof,
    #[msg("ZK State Mismatch")]
    StateMismatch,
}
