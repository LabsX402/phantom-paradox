use anchor_lang::prelude::*;

// ============================================================================
// HYDRA BLACKMIRROR STATE - Untraceable Rotating Shard System
// ============================================================================
// 
// The Hydra system creates 1000s of PDAs that constantly rotate, making it
// impossible for chain analysis tools to track funds flow.
//
// Architecture:
// - HydraIndex: Master tracker of all epochs and shards
// - HydraShard: Individual payment shard (1000s per token per epoch)
// - CommitmentQueue: Serverless message passing (Vault → BlackMirror)
//
// PDA Seeds:
// - HydraIndex: ["hydra_index"]
// - HydraShard: ["hydra", epoch, token_mint, shard_id]
// - CommitmentQueue: ["hydra_queue"]
// ============================================================================

/// Maximum shards per token per epoch
pub const MAX_SHARDS_PER_TOKEN: u16 = 1000;

/// Maximum supported tokens (SOL, PDOX, USDC, etc.)
pub const MAX_SUPPORTED_TOKENS: usize = 10;

/// Maximum pending commitments in queue
pub const MAX_COMMITMENTS: usize = 100;

/// Commitment expiry time in seconds
pub const COMMITMENT_EXPIRY_SECONDS: i64 = 3600; // 1 hour

// ============================================================================
// HYDRA INDEX - Master Tracker
// ============================================================================

#[account]
#[derive(Default)]
pub struct HydraIndex {
    /// Current epoch number (increments on rotation)
    pub current_epoch: u64,
    
    /// Number of shards per token
    pub shards_per_token: u16,
    
    /// List of supported token mints
    pub supported_tokens: Vec<Pubkey>,
    
    /// Total value locked across all shards (in lamports equivalent)
    pub total_value_locked: u64,
    
    /// Timestamp of last rotation
    pub last_rotation: i64,
    
    /// Rotation interval in seconds (e.g., 3600 = 1 hour)
    pub rotation_interval: i64,
    
    /// Authority that can trigger rotation and manage shards
    pub authority: Pubkey,
    
    /// Backup authority (multi-sig recommended)
    pub backup_authority: Option<Pubkey>,
    
    /// Emergency pause flag
    pub paused: bool,
    
    /// Bump seed for PDA
    pub bump: u8,
}

impl HydraIndex {
    pub const SEED: &'static [u8] = b"hydra_index";
    
    /// Calculate space needed for account
    pub fn space(num_tokens: usize) -> usize {
        8 +  // discriminator
        8 +  // current_epoch
        2 +  // shards_per_token
        4 + (32 * num_tokens) + // supported_tokens vec
        8 +  // total_value_locked
        8 +  // last_rotation
        8 +  // rotation_interval
        32 + // authority
        1 + 32 + // backup_authority (Option)
        1 +  // paused
        1    // bump
    }
    
    /// Check if rotation is due
    pub fn rotation_due(&self, current_time: i64) -> bool {
        current_time >= self.last_rotation + self.rotation_interval
    }
    
    /// Get shard PDA
    pub fn get_shard_pda(
        epoch: u64,
        token_mint: &Pubkey,
        shard_id: u16,
        program_id: &Pubkey,
    ) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                HydraShard::SEED,
                &epoch.to_le_bytes(),
                token_mint.as_ref(),
                &shard_id.to_le_bytes(),
            ],
            program_id,
        )
    }
}

// ============================================================================
// HYDRA SHARD - Individual Payment Shard
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum ShardStatus {
    /// Shard can receive and send payments
    #[default]
    Active,
    /// Shard is migrating funds to new epoch (only outgoing allowed)
    Draining,
    /// Shard is empty and archived
    Closed,
}

#[account]
#[derive(Default)]
pub struct HydraShard {
    /// Epoch this shard belongs to
    pub epoch: u64,
    
    /// Token mint this shard handles
    pub token_mint: Pubkey,
    
    /// Shard ID within this epoch/token combination
    pub shard_id: u16,
    
    /// Current balance tracked (for quick lookup)
    pub balance: u64,
    
    /// Shard status
    pub status: ShardStatus,
    
    /// Shard IDs in next epoch to migrate funds to (for rotation)
    pub successor_shards: [u16; 5], // Max 5 successors for split migration
    
    /// Number of valid successors
    pub num_successors: u8,
    
    /// Total payouts processed
    pub payouts_processed: u64,
    
    /// Total volume processed (for metrics)
    pub volume_processed: u64,
    
    /// Creation timestamp
    pub created_at: i64,
    
    /// Closure timestamp (if closed)
    pub closed_at: i64,
    
    /// Bump seed for PDA
    pub bump: u8,
}

impl HydraShard {
    pub const SEED: &'static [u8] = b"hydra";
    
    /// Calculate space needed for account
    pub const fn space() -> usize {
        8 +  // discriminator
        8 +  // epoch
        32 + // token_mint
        2 +  // shard_id
        8 +  // balance
        1 +  // status (enum)
        (2 * 5) + // successor_shards array
        1 +  // num_successors
        8 +  // payouts_processed
        8 +  // volume_processed
        8 +  // created_at
        8 +  // closed_at
        1    // bump
    }
    
    /// Check if shard can receive funds
    pub fn can_receive(&self) -> bool {
        self.status == ShardStatus::Active
    }
    
    /// Check if shard can send funds
    pub fn can_send(&self) -> bool {
        self.status == ShardStatus::Active || self.status == ShardStatus::Draining
    }
    
    /// Add successor shard for migration
    pub fn add_successor(&mut self, shard_id: u16) -> Result<()> {
        require!(
            (self.num_successors as usize) < 5,
            HydraError::TooManySuccessors
        );
        self.successor_shards[self.num_successors as usize] = shard_id;
        self.num_successors += 1;
        Ok(())
    }
}

// ============================================================================
// COMMITMENT QUEUE - Serverless Message Passing
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum CommitmentStatus {
    /// Waiting to be executed
    #[default]
    Pending,
    /// Successfully executed
    Executed,
    /// Expired (not executed in time)
    Expired,
    /// Cancelled (deposit failed)
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct Commitment {
    /// Keccak256 hash of (recipient, amount, nonce)
    pub hash: [u8; 32],
    
    /// Creation timestamp
    pub created_at: i64,
    
    /// Expiry timestamp
    pub expires_at: i64,
    
    /// Current status
    pub status: CommitmentStatus,
    
    /// Deposit transaction signature (for verification)
    pub deposit_slot: u64,
    
    /// Preferred shard hint (0 = any)
    pub shard_hint: u16,
}

impl Commitment {
    /// Check if commitment is expired
    pub fn is_expired(&self, current_time: i64) -> bool {
        current_time > self.expires_at
    }
    
    /// Check if commitment can be executed
    pub fn can_execute(&self, current_time: i64) -> bool {
        self.status == CommitmentStatus::Pending && !self.is_expired(current_time)
    }
}

#[account]
pub struct CommitmentQueue {
    /// List of pending commitments
    pub commitments: [Commitment; MAX_COMMITMENTS],
    
    /// Number of active commitments
    pub active_count: u16,
    
    /// Head index for circular buffer
    pub head: u16,
    
    /// Tail index for circular buffer
    pub tail: u16,
    
    /// Total commitments processed
    pub total_processed: u64,
    
    /// Total commitments expired
    pub total_expired: u64,
    
    /// Total commitments cancelled
    pub total_cancelled: u64,
    
    /// Authority that can manage queue
    pub authority: Pubkey,
    
    /// Bump seed for PDA
    pub bump: u8,
}

impl CommitmentQueue {
    pub const SEED: &'static [u8] = b"hydra_queue";
    
    /// Calculate space needed for account
    pub const fn space() -> usize {
        8 +  // discriminator
        (64 * MAX_COMMITMENTS) + // commitments array (each ~64 bytes)
        2 +  // active_count
        2 +  // head
        2 +  // tail
        8 +  // total_processed
        8 +  // total_expired
        8 +  // total_cancelled
        32 + // authority
        1    // bump
    }
    
    /// Add a new commitment to the queue
    pub fn push(&mut self, commitment: Commitment) -> Result<u16> {
        require!(
            (self.active_count as usize) < MAX_COMMITMENTS,
            HydraError::QueueFull
        );
        
        let index = self.tail;
        self.commitments[index as usize] = commitment;
        self.tail = (self.tail + 1) % (MAX_COMMITMENTS as u16);
        self.active_count += 1;
        
        Ok(index)
    }
    
    /// Get commitment by index
    pub fn get(&self, index: u16) -> Option<&Commitment> {
        if index < MAX_COMMITMENTS as u16 {
            Some(&self.commitments[index as usize])
        } else {
            None
        }
    }
    
    /// Mark commitment as executed
    pub fn mark_executed(&mut self, index: u16) -> Result<()> {
        require!(
            index < MAX_COMMITMENTS as u16,
            HydraError::InvalidCommitmentIndex
        );
        
        let commitment = &mut self.commitments[index as usize];
        require!(
            commitment.status == CommitmentStatus::Pending,
            HydraError::CommitmentNotPending
        );
        
        commitment.status = CommitmentStatus::Executed;
        self.total_processed += 1;
        self.active_count = self.active_count.saturating_sub(1);
        
        Ok(())
    }
    
    /// Clean up expired commitments
    pub fn cleanup_expired(&mut self, current_time: i64) -> u64 {
        let mut cleaned = 0u64;
        
        for i in 0..MAX_COMMITMENTS {
            let commitment = &mut self.commitments[i];
            if commitment.status == CommitmentStatus::Pending 
                && commitment.is_expired(current_time) 
            {
                commitment.status = CommitmentStatus::Expired;
                self.total_expired += 1;
                self.active_count = self.active_count.saturating_sub(1);
                cleaned += 1;
            }
        }
        
        cleaned
    }
}

// ============================================================================
// HYDRA ERRORS
// ============================================================================

#[error_code]
pub enum HydraError {
    #[msg("Hydra system is paused")]
    HydraPaused,
    
    #[msg("Rotation not yet due")]
    RotationNotDue,
    
    #[msg("Shard cannot receive funds")]
    ShardCannotReceive,
    
    #[msg("Shard cannot send funds")]
    ShardCannotSend,
    
    #[msg("Too many successor shards")]
    TooManySuccessors,
    
    #[msg("Commitment queue is full")]
    QueueFull,
    
    #[msg("Invalid commitment index")]
    InvalidCommitmentIndex,
    
    #[msg("Commitment is not pending")]
    CommitmentNotPending,
    
    #[msg("Commitment hash mismatch")]
    CommitmentHashMismatch,
    
    #[msg("Commitment expired")]
    CommitmentExpired,
    
    #[msg("Invalid shard ID")]
    InvalidShardId,
    
    #[msg("Token not supported")]
    TokenNotSupported,
    
    #[msg("Insufficient shard balance")]
    InsufficientShardBalance,
    
    #[msg("Shard already exists")]
    ShardAlreadyExists,
    
    #[msg("Invalid epoch")]
    InvalidEpoch,
}

// ============================================================================
// HYDRA EVENTS
// ============================================================================

#[event]
pub struct HydraInitialized {
    pub authority: Pubkey,
    pub shards_per_token: u16,
    pub rotation_interval: i64,
    pub timestamp: i64,
}

#[event]
pub struct ShardCreated {
    pub epoch: u64,
    pub token_mint: Pubkey,
    pub shard_id: u16,
    pub shard_pda: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct EpochRotated {
    pub old_epoch: u64,
    pub new_epoch: u64,
    pub shards_draining: u16,
    pub shards_created: u16,
    pub timestamp: i64,
}

#[event]
pub struct CommitmentQueued {
    pub commitment_hash: [u8; 32],
    pub index: u16,
    pub expires_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct CommitmentExecuted {
    pub commitment_hash: [u8; 32],
    pub recipient: Pubkey,
    pub amount: u64,
    pub shard_id: u16,
    pub timestamp: i64,
}

#[event]
pub struct ShardMigrated {
    pub from_epoch: u64,
    pub to_epoch: u64,
    pub from_shard: u16,
    pub to_shards: [u16; 5],
    pub amounts: [u64; 5],
    pub timestamp: i64,
}

