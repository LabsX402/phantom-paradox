use anchor_lang::prelude::*;

#[error_code]
pub enum PgError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Math overflow")]
    Overflow,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid time window")]
    InvalidTime,
    #[msg("Listings paused")]
    ListingsPaused,
    #[msg("Settlements paused")]
    SettlementsPaused,
    #[msg("Invalid listing status")]
    InvalidListingStatus,
    #[msg("Invalid listing kind")]
    InvalidListingKind,
    #[msg("Insufficient credits")]
    InsufficientCredits,
    #[msg("Insufficient quantity")]
    InsufficientQuantity,
    #[msg("Fee too high")]
    FeeTooHigh,
    #[msg("Cancel penalty too high")]
    CancelPenaltyTooHigh,
    #[msg("KYC required")]
    KycRequired,
    #[msg("Currency mint mismatch")]
    CurrencyMintMismatch,
    #[msg("Item mint mismatch")]
    ItemMintMismatch,
    #[msg("Invalid Merkle proof")]
    InvalidMerkleProof,
    #[msg("Invalid meta-transaction signature")]
    InvalidMetaTxSignature,

    // --- hyperscale / compression / zk extras ---
    #[msg("Invalid royalty configuration")]
    InvalidRoyalty,
    #[msg("Invalid compressed data hash")]
    InvalidDataHash,
    #[msg("Listing must be settled or cancelled with zero remaining quantity")]
    ListingNotSettled,
    #[msg("Feature not enabled")]
    FeatureNotEnabled,
    #[msg("Reentrancy detected")]
    ReentrancyDetected,

    // --- compressed auction batch errors ---
    #[msg("Auction tree not initialized")]
    AuctionTreeNotInitialized,
    #[msg("Invalid batch ID")]
    InvalidBatchId,
    #[msg("Root mismatch - Merkle proof verification failed")]
    RootMismatch,
    #[msg("Auction not found in batch")]
    AuctionNotFound,
    #[msg("Auction already settled or cancelled")]
    AuctionAlreadyFinalized,
    #[msg("Auction not in seiz-able state")]
    AuctionNotSeizable,
    #[msg("Invalid leaf index")]
    InvalidLeafIndex,
    #[msg("Batch size exceeds maximum")]
    BatchSizeExceeded,
    #[msg("Admin authority required")]
    AdminAuthorityRequired,

    // --- net engine errors ---
    #[msg("Invalid window ID")]
    InvalidWindow,
    #[msg("Net volume exceeds maximum")]
    NetVolumeTooHigh,
    #[msg("Net trade count exceeds maximum")]
    NetTradeCountTooHigh,

    // --- vesting errors ---
    #[msg("Unlock amount exceeds maximum (10% of locked)")]
    UnlockAmountTooHigh,
    #[msg("Unlock request cooldown not expired (30 days)")]
    UnlockCooldownActive,
    #[msg("Unlock timelock not expired")]
    UnlockTimelockActive,
    #[msg("No pending unlock request")]
    NoPendingUnlock,
    #[msg("DAO vote required for treasury unlock")]
    DaoVoteRequired,
    #[msg("Treasury unlock amount exceeds maximum per period")]
    TreasuryUnlockTooHigh,
    #[msg("Treasury timelock not expired")]
    TreasuryTimelockActive,

    // --- black ledger errors ---
    #[msg("Transfer blocked by Black Ledger (Armageddon mode)")]
    TransferBlockedByBlackLedger,
    #[msg("Transfer exceeds rate limit (lifeboat rule)")]
    TransferRateLimitExceeded,
    #[msg("Armageddon threshold change requires DAO vote")]
    ArmageddonThresholdChangeRequiresDao,
    #[msg("Armageddon threshold change timelock not expired")]
    ArmageddonTimelockActive,
    #[msg("Invalid risk score")]
    InvalidRiskScore,
    #[msg("Invalid betrayal ratio")]
    InvalidBetrayalRatio,
    #[msg("Seller amount after fees must be positive")]
    InvalidSellerAmount,

    // --- LP growth errors ---
    #[msg("LP growth not enabled")]
    LpGrowthNotEnabled,
    #[msg("Insufficient fees accumulated for LP growth")]
    InsufficientFeesForLpGrowth,
    #[msg("LP growth lock is active")]
    LpGrowthLockActive,
    #[msg("LP growth requires DAO vote")]
    LpGrowthRequiresDaoVote,
    #[msg("Invalid LP ratio")]
    InvalidLpRatio,
    #[msg("LP withdrawal timelock not expired")]
    LpWithdrawalTimelockActive,
    #[msg("LP withdrawal exceeds maximum per period")]
    LpWithdrawalTooHigh,

    // --- bundle guard errors ---
    #[msg("Bundled dump detected")]
    BundledDumpDetected,
    #[msg("Bundle guard not enabled")]
    BundleGuardNotEnabled,

    // --- dynamic timelock errors ---
    #[msg("Config change proposal not found")]
    ConfigChangeProposalNotFound,
    #[msg("Config change proposal already executed")]
    ConfigChangeProposalExecuted,
    #[msg("Risk score update exceeds maximum delta")]
    RiskScoreUpdateTooHigh,

    // --- worker profile errors ---
    #[msg("Invalid payout method")]
    InvalidPayoutMethod,
}
