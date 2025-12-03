use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::error::PgError;

// ============================================================================
// HYDRA BLACKMIRROR - Untraceable Rotating Shard System
// ============================================================================
//
// Architecture:
// - HydraIndex: Master tracker of all epochs and shards
// - HydraShard: Individual payment shard (1000s per token per epoch)
// - CommitmentQueue: Serverless message passing (Vault → BlackMirror)
// ============================================================================

// ============================================================================
// CONSTANTS
// ============================================================================

/// Maximum shards per token per epoch
pub const MAX_SHARDS_PER_TOKEN: u16 = 1000;

/// Maximum supported tokens (SOL, PDOX, USDC, etc.)
pub const MAX_SUPPORTED_TOKENS: usize = 10;

/// Maximum pending commitments in queue
pub const MAX_COMMITMENTS: usize = 16;

/// Commitment expiry time in seconds
pub const COMMITMENT_EXPIRY_SECONDS: i64 = 3600; // 1 hour

// ============================================================================
// HYDRA INDEX - Master Tracker
// ============================================================================

#[account]
#[derive(Default)]
pub struct HydraIndex {
    pub current_epoch: u64,
    pub shards_per_token: u16,
    pub supported_tokens: Vec<Pubkey>,
    pub total_value_locked: u64,
    pub last_rotation: i64,
    pub rotation_interval: i64,
    pub authority: Pubkey,
    pub backup_authority: Option<Pubkey>,
    pub paused: bool,
    pub bump: u8,
}

impl HydraIndex {
    pub const SEED: &'static [u8] = b"hydra_index";
    
    pub fn space(num_tokens: usize) -> usize {
        8 + 8 + 2 + 4 + (32 * num_tokens) + 8 + 8 + 8 + 32 + 1 + 32 + 1 + 1
    }
    
    pub fn rotation_due(&self, current_time: i64) -> bool {
        current_time >= self.last_rotation + self.rotation_interval
    }
}

// ============================================================================
// HYDRA SHARD - Individual Payment Shard
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum ShardStatus {
    #[default]
    Active,
    Draining,
    Closed,
}

#[account]
#[derive(Default)]
pub struct HydraShard {
    pub epoch: u64,
    pub token_mint: Pubkey,
    pub shard_id: u16,
    pub balance: u64,
    pub status: ShardStatus,
    pub successor_shards: [u16; 5],
    pub num_successors: u8,
    pub payouts_processed: u64,
    pub volume_processed: u64,
    pub created_at: i64,
    pub closed_at: i64,
    pub bump: u8,
}

impl HydraShard {
    pub const SEED: &'static [u8] = b"hydra";
    
    pub const fn space() -> usize {
        8 + 8 + 32 + 2 + 8 + 1 + (2 * 5) + 1 + 8 + 8 + 8 + 8 + 1
    }
    
    pub fn can_receive(&self) -> bool {
        self.status == ShardStatus::Active
    }
    
    pub fn can_send(&self) -> bool {
        self.status == ShardStatus::Active || self.status == ShardStatus::Draining
    }
}

// ============================================================================
// COMMITMENT QUEUE - Serverless Message Passing
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum CommitmentStatus {
    #[default]
    Pending,
    Executed,
    Expired,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct Commitment {
    pub hash: [u8; 32],
    pub created_at: i64,
    pub expires_at: i64,
    pub status: CommitmentStatus,
    pub deposit_slot: u64,
    pub shard_hint: u16,
}

impl Commitment {
    pub fn is_expired(&self, current_time: i64) -> bool {
        current_time > self.expires_at
    }
    
    pub fn can_execute(&self, current_time: i64) -> bool {
        self.status == CommitmentStatus::Pending && !self.is_expired(current_time)
    }
}

#[account]
pub struct CommitmentQueue {
    pub commitments: [Commitment; MAX_COMMITMENTS],
    pub active_count: u16,
    pub head: u16,
    pub tail: u16,
    pub total_processed: u64,
    pub total_expired: u64,
    pub total_cancelled: u64,
    pub authority: Pubkey,
    pub bump: u8,
}

impl Default for CommitmentQueue {
    fn default() -> Self {
        Self {
            commitments: [Commitment::default(); MAX_COMMITMENTS],
            active_count: 0,
            head: 0,
            tail: 0,
            total_processed: 0,
            total_expired: 0,
            total_cancelled: 0,
            authority: Pubkey::default(),
            bump: 0,
        }
    }
}

impl CommitmentQueue {
    pub const SEED: &'static [u8] = b"hydra_queue";
    
    pub const fn space() -> usize {
        8 + (64 * MAX_COMMITMENTS) + 2 + 2 + 2 + 8 + 8 + 8 + 32 + 1
    }
    
    pub fn push(&mut self, commitment: Commitment) -> Result<u16> {
        require!((self.active_count as usize) < MAX_COMMITMENTS, HydraError::QueueFull);
        let index = self.tail;
        self.commitments[index as usize] = commitment;
        self.tail = (self.tail + 1) % (MAX_COMMITMENTS as u16);
        self.active_count += 1;
        Ok(index)
    }
    
    pub fn get(&self, index: u16) -> Option<&Commitment> {
        if index < MAX_COMMITMENTS as u16 {
            Some(&self.commitments[index as usize])
        } else {
            None
        }
    }
    
    pub fn mark_executed(&mut self, index: u16) -> Result<()> {
        require!(index < MAX_COMMITMENTS as u16, HydraError::InvalidCommitmentIndex);
        let commitment = &mut self.commitments[index as usize];
        require!(commitment.status == CommitmentStatus::Pending, HydraError::CommitmentNotPending);
        commitment.status = CommitmentStatus::Executed;
        self.total_processed += 1;
        self.active_count = self.active_count.saturating_sub(1);
        Ok(())
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

// ============================================================================
// HYDRA INSTRUCTIONS
// ============================================================================

/// Initialize the Hydra system
/// Creates the master HydraIndex and CommitmentQueue
/// NOTE: Box<> used to reduce stack frame size (Solana 4KB limit)
#[derive(Accounts)]
#[instruction(shards_per_token: u16, rotation_interval: i64)]
pub struct InitializeHydra<'info> {
    #[account(
        init,
        payer = authority,
        space = HydraIndex::space(MAX_SUPPORTED_TOKENS),
        seeds = [HydraIndex::SEED],
        bump
    )]
    pub hydra_index: Box<Account<'info, HydraIndex>>,
    
    #[account(
        init,
        payer = authority,
        space = CommitmentQueue::space(),
        seeds = [CommitmentQueue::SEED],
        bump
    )]
    pub commitment_queue: Box<Account<'info, CommitmentQueue>>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn initialize_hydra(
    ctx: Context<InitializeHydra>,
    shards_per_token: u16,
    rotation_interval: i64,
) -> Result<()> {
    require!(shards_per_token > 0 && shards_per_token <= MAX_SHARDS_PER_TOKEN, HydraError::InvalidShardId);
    require!(rotation_interval >= 60, PgError::InvalidAmount); // Min 1 minute
    
    let hydra_index = &mut ctx.accounts.hydra_index;
    let commitment_queue = &mut ctx.accounts.commitment_queue;
    let clock = Clock::get()?;
    
    // Initialize HydraIndex
    hydra_index.current_epoch = 1;
    hydra_index.shards_per_token = shards_per_token;
    hydra_index.supported_tokens = Vec::new();
    hydra_index.total_value_locked = 0;
    hydra_index.last_rotation = clock.unix_timestamp;
    hydra_index.rotation_interval = rotation_interval;
    hydra_index.authority = ctx.accounts.authority.key();
    hydra_index.backup_authority = None;
    hydra_index.paused = false;
    hydra_index.bump = ctx.bumps.hydra_index;
    
    // Initialize CommitmentQueue
    commitment_queue.commitments = [Commitment::default(); MAX_COMMITMENTS];
    commitment_queue.active_count = 0;
    commitment_queue.head = 0;
    commitment_queue.tail = 0;
    commitment_queue.total_processed = 0;
    commitment_queue.total_expired = 0;
    commitment_queue.total_cancelled = 0;
    commitment_queue.authority = ctx.accounts.authority.key();
    commitment_queue.bump = ctx.bumps.commitment_queue;
    
    emit!(HydraInitialized {
        authority: ctx.accounts.authority.key(),
        shards_per_token,
        rotation_interval,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

/// Add a supported token to Hydra
#[derive(Accounts)]
pub struct AddSupportedToken<'info> {
    #[account(
        mut,
        seeds = [HydraIndex::SEED],
        bump = hydra_index.bump,
        has_one = authority @ PgError::Unauthorized
    )]
    pub hydra_index: Account<'info, HydraIndex>,
    
    pub token_mint: InterfaceAccount<'info, Mint>,
    
    pub authority: Signer<'info>,
}

pub fn add_supported_token(ctx: Context<AddSupportedToken>) -> Result<()> {
    let hydra_index = &mut ctx.accounts.hydra_index;
    let token_mint = ctx.accounts.token_mint.key();
    
    require!(!hydra_index.paused, HydraError::HydraPaused);
    require!(
        hydra_index.supported_tokens.len() < MAX_SUPPORTED_TOKENS,
        HydraError::TokenNotSupported
    );
    require!(
        !hydra_index.supported_tokens.contains(&token_mint),
        HydraError::ShardAlreadyExists
    );
    
    hydra_index.supported_tokens.push(token_mint);
    
    Ok(())
}

/// Create a new Hydra shard for a specific epoch/token/shard_id
#[derive(Accounts)]
#[instruction(epoch: u64, shard_id: u16)]
pub struct CreateHydraShard<'info> {
    #[account(
        seeds = [HydraIndex::SEED],
        bump = hydra_index.bump
    )]
    pub hydra_index: Account<'info, HydraIndex>,
    
    #[account(
        init,
        payer = payer,
        space = HydraShard::space(),
        seeds = [
            HydraShard::SEED,
            &epoch.to_le_bytes(),
            token_mint.key().as_ref(),
            &shard_id.to_le_bytes()
        ],
        bump
    )]
    pub hydra_shard: Account<'info, HydraShard>,
    
    pub token_mint: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn create_hydra_shard(
    ctx: Context<CreateHydraShard>,
    epoch: u64,
    shard_id: u16,
) -> Result<()> {
    let hydra_index = &ctx.accounts.hydra_index;
    let hydra_shard = &mut ctx.accounts.hydra_shard;
    let token_mint = ctx.accounts.token_mint.key();
    let clock = Clock::get()?;
    
    require!(!hydra_index.paused, HydraError::HydraPaused);
    require!(epoch == hydra_index.current_epoch || epoch == hydra_index.current_epoch + 1, HydraError::InvalidEpoch);
    require!(shard_id < hydra_index.shards_per_token, HydraError::InvalidShardId);
    require!(hydra_index.supported_tokens.contains(&token_mint), HydraError::TokenNotSupported);
    
    hydra_shard.epoch = epoch;
    hydra_shard.token_mint = token_mint;
    hydra_shard.shard_id = shard_id;
    hydra_shard.balance = 0;
    hydra_shard.status = ShardStatus::Active;
    hydra_shard.successor_shards = [0; 5];
    hydra_shard.num_successors = 0;
    hydra_shard.payouts_processed = 0;
    hydra_shard.volume_processed = 0;
    hydra_shard.created_at = clock.unix_timestamp;
    hydra_shard.closed_at = 0;
    hydra_shard.bump = ctx.bumps.hydra_shard;
    
    emit!(ShardCreated {
        epoch,
        token_mint,
        shard_id,
        shard_pda: hydra_shard.key(),
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

/// Queue a commitment (deposit detected, queue payout instruction)
#[derive(Accounts)]
#[instruction(commitment_hash: [u8; 32], shard_hint: u16)]
pub struct QueueCommitment<'info> {
    #[account(
        seeds = [HydraIndex::SEED],
        bump = hydra_index.bump
    )]
    pub hydra_index: Account<'info, HydraIndex>,
    
    #[account(
        mut,
        seeds = [CommitmentQueue::SEED],
        bump = commitment_queue.bump
    )]
    pub commitment_queue: Account<'info, CommitmentQueue>,
    
    /// The server authority that detected the deposit
    pub authority: Signer<'info>,
}

pub fn queue_commitment(
    ctx: Context<QueueCommitment>,
    commitment_hash: [u8; 32],
    shard_hint: u16,
) -> Result<()> {
    let hydra_index = &ctx.accounts.hydra_index;
    let commitment_queue = &mut ctx.accounts.commitment_queue;
    let clock = Clock::get()?;
    
    require!(!hydra_index.paused, HydraError::HydraPaused);
    
    let commitment = Commitment {
        hash: commitment_hash,
        created_at: clock.unix_timestamp,
        expires_at: clock.unix_timestamp + COMMITMENT_EXPIRY_SECONDS,
        status: CommitmentStatus::Pending,
        deposit_slot: clock.slot,
        shard_hint,
    };
    
    let index = commitment_queue.push(commitment)?;
    
    emit!(CommitmentQueued {
        commitment_hash,
        index,
        expires_at: clock.unix_timestamp + COMMITMENT_EXPIRY_SECONDS,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

/// Execute a commitment (payout from shard to recipient)
/// Anyone can call this with the correct proof!
/// NOTE: Box<> used to reduce stack frame size (Solana 4KB limit)
#[derive(Accounts)]
#[instruction(commitment_index: u16, recipient: Pubkey, amount: u64, nonce: u64)]
pub struct ExecuteCommitment<'info> {
    #[account(
        mut,
        seeds = [HydraIndex::SEED],
        bump = hydra_index.bump
    )]
    pub hydra_index: Box<Account<'info, HydraIndex>>,
    
    #[account(
        mut,
        seeds = [CommitmentQueue::SEED],
        bump = commitment_queue.bump
    )]
    pub commitment_queue: Box<Account<'info, CommitmentQueue>>,
    
    #[account(
        mut,
        seeds = [
            HydraShard::SEED,
            &hydra_shard.epoch.to_le_bytes(),
            hydra_shard.token_mint.as_ref(),
            &hydra_shard.shard_id.to_le_bytes()
        ],
        bump = hydra_shard.bump
    )]
    pub hydra_shard: Box<Account<'info, HydraShard>>,
    
    /// Shard's token account (PDA-owned)
    #[account(
        mut,
        token::mint = token_mint,
    )]
    pub shard_token_account: InterfaceAccount<'info, TokenAccount>,
    
    /// Recipient's token account
    #[account(
        mut,
        token::mint = token_mint,
    )]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,
    
    pub token_mint: InterfaceAccount<'info, Mint>,
    
    /// Anyone can crank this (serverless!)
    #[account(mut)]
    pub cranker: Signer<'info>,
    
    pub token_program: Program<'info, Token2022>,
}

pub fn execute_commitment(
    ctx: Context<ExecuteCommitment>,
    commitment_index: u16,
    recipient: Pubkey,
    amount: u64,
    nonce: u64,
) -> Result<()> {
    let hydra_index = &ctx.accounts.hydra_index;
    let commitment_queue = &mut ctx.accounts.commitment_queue;
    let hydra_shard = &mut ctx.accounts.hydra_shard;
    let clock = Clock::get()?;
    
    require!(!hydra_index.paused, HydraError::HydraPaused);
    require!(hydra_shard.can_send(), HydraError::ShardCannotSend);
    require!(hydra_shard.balance >= amount, HydraError::InsufficientShardBalance);
    
    // Get and validate commitment
    let commitment = commitment_queue.get(commitment_index)
        .ok_or(HydraError::InvalidCommitmentIndex)?;
    
    require!(commitment.can_execute(clock.unix_timestamp), HydraError::CommitmentExpired);
    
    // Copy hash before we mutate the queue
    let commitment_hash_copy = commitment.hash;
    
    // Verify commitment hash matches expected preimage
    // The hash is computed off-chain as sha256(recipient || amount || nonce)
    // Here we verify by recomputing and comparing
    // Using keccak which is available in the program
    let amount_bytes = amount.to_le_bytes();
    let nonce_bytes = nonce.to_le_bytes();
    
    // Concatenate preimage
    let mut preimage = [0u8; 48]; // 32 + 8 + 8
    preimage[..32].copy_from_slice(recipient.as_ref());
    preimage[32..40].copy_from_slice(&amount_bytes);
    preimage[40..48].copy_from_slice(&nonce_bytes);
    
    // Use keccak for hash verification
    let computed_hash = solana_program::keccak::hash(&preimage);
    require!(
        computed_hash.0 == commitment_hash_copy,
        HydraError::CommitmentHashMismatch
    );
    
    // Execute transfer from shard
    let epoch_bytes = hydra_shard.epoch.to_le_bytes();
    let shard_id_bytes = hydra_shard.shard_id.to_le_bytes();
    let bump_slice = [hydra_shard.bump];
    let shard_seeds: &[&[u8]] = &[
        HydraShard::SEED,
        epoch_bytes.as_ref(),
        hydra_shard.token_mint.as_ref(),
        shard_id_bytes.as_ref(),
        &bump_slice,
    ];
    let signer_seeds = &[shard_seeds];
    
    let decimals = ctx.accounts.token_mint.decimals;
    
    // Calculate fee (Token-2022 transfer fee)
    // For now, assume fee is handled by Token-2022 extension
    let transfer_cpi = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.shard_token_account.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: hydra_shard.to_account_info(),
        },
        signer_seeds,
    );
    
    token_2022::transfer_checked(transfer_cpi, amount, decimals)?;
    
    // Update shard state
    hydra_shard.balance = hydra_shard.balance.saturating_sub(amount);
    hydra_shard.payouts_processed += 1;
    hydra_shard.volume_processed += amount;
    
    // Mark commitment as executed
    commitment_queue.mark_executed(commitment_index)?;
    
    emit!(CommitmentExecuted {
        commitment_hash: commitment_hash_copy,
        recipient,
        amount,
        shard_id: hydra_shard.shard_id,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

/// Trigger epoch rotation (Runaway Bride!)
/// Creates new shards and marks old ones as draining
#[derive(Accounts)]
pub struct RotateEpoch<'info> {
    #[account(
        mut,
        seeds = [HydraIndex::SEED],
        bump = hydra_index.bump
    )]
    pub hydra_index: Account<'info, HydraIndex>,
    
    /// Anyone can trigger rotation if it's due!
    pub cranker: Signer<'info>,
}

pub fn rotate_epoch(ctx: Context<RotateEpoch>) -> Result<()> {
    let hydra_index = &mut ctx.accounts.hydra_index;
    let clock = Clock::get()?;
    
    require!(!hydra_index.paused, HydraError::HydraPaused);
    require!(hydra_index.rotation_due(clock.unix_timestamp), HydraError::RotationNotDue);
    
    let old_epoch = hydra_index.current_epoch;
    let new_epoch = old_epoch + 1;
    
    // Increment epoch
    hydra_index.current_epoch = new_epoch;
    hydra_index.last_rotation = clock.unix_timestamp;
    
    emit!(EpochRotated {
        old_epoch,
        new_epoch,
        shards_draining: hydra_index.shards_per_token * hydra_index.supported_tokens.len() as u16,
        shards_created: 0, // Will be created by separate calls
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

/// Migrate funds from old shard to new shards (split migration!)
#[derive(Accounts)]
#[instruction(amounts: [u64; 5])]
pub struct MigrateShard<'info> {
    #[account(
        seeds = [HydraIndex::SEED],
        bump = hydra_index.bump
    )]
    pub hydra_index: Account<'info, HydraIndex>,
    
    /// Old shard (must be draining)
    #[account(
        mut,
        seeds = [
            HydraShard::SEED,
            &from_shard.epoch.to_le_bytes(),
            from_shard.token_mint.as_ref(),
            &from_shard.shard_id.to_le_bytes()
        ],
        bump = from_shard.bump,
        constraint = from_shard.epoch < hydra_index.current_epoch @ HydraError::InvalidEpoch
    )]
    pub from_shard: Account<'info, HydraShard>,
    
    /// From shard's token account
    #[account(
        mut,
        token::mint = token_mint,
    )]
    pub from_token_account: InterfaceAccount<'info, TokenAccount>,
    
    /// Target shard 1 (new epoch)
    #[account(
        mut,
        seeds = [
            HydraShard::SEED,
            &hydra_index.current_epoch.to_le_bytes(),
            token_mint.key().as_ref(),
            &to_shard_1.shard_id.to_le_bytes()
        ],
        bump = to_shard_1.bump
    )]
    pub to_shard_1: Account<'info, HydraShard>,
    
    #[account(
        mut,
        token::mint = token_mint,
    )]
    pub to_token_account_1: InterfaceAccount<'info, TokenAccount>,
    
    // Note: In production, we'd use remaining_accounts for up to 5 target shards
    // For simplicity, showing just 1 target here
    
    pub token_mint: InterfaceAccount<'info, Mint>,
    
    /// Migration authority or cranker
    pub authority: Signer<'info>,
    
    pub token_program: Program<'info, Token2022>,
}

pub fn migrate_shard(
    ctx: Context<MigrateShard>,
    amounts: [u64; 5],
) -> Result<()> {
    let hydra_index = &ctx.accounts.hydra_index;
    let from_shard = &mut ctx.accounts.from_shard;
    let to_shard_1 = &mut ctx.accounts.to_shard_1;
    let clock = Clock::get()?;
    
    require!(!hydra_index.paused, HydraError::HydraPaused);
    require!(from_shard.can_send(), HydraError::ShardCannotSend);
    require!(to_shard_1.can_receive(), HydraError::ShardCannotReceive);
    
    let transfer_amount = amounts[0]; // First target shard
    require!(from_shard.balance >= transfer_amount, HydraError::InsufficientShardBalance);
    
    // Mark from_shard as draining if not already
    if from_shard.status == ShardStatus::Active {
        from_shard.status = ShardStatus::Draining;
    }
    
    // Execute transfer
    let epoch_bytes = from_shard.epoch.to_le_bytes();
    let shard_id_bytes = from_shard.shard_id.to_le_bytes();
    let bump_slice = [from_shard.bump];
    let from_seeds: &[&[u8]] = &[
        HydraShard::SEED,
        epoch_bytes.as_ref(),
        from_shard.token_mint.as_ref(),
        shard_id_bytes.as_ref(),
        &bump_slice,
    ];
    let signer_seeds = &[from_seeds];
    
    let decimals = ctx.accounts.token_mint.decimals;
    
    let transfer_cpi = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.from_token_account.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
            to: ctx.accounts.to_token_account_1.to_account_info(),
            authority: from_shard.to_account_info(),
        },
        signer_seeds,
    );
    
    token_2022::transfer_checked(transfer_cpi, transfer_amount, decimals)?;
    
    // Update balances
    from_shard.balance = from_shard.balance.saturating_sub(transfer_amount);
    to_shard_1.balance += transfer_amount;
    
    // Close shard if empty
    if from_shard.balance == 0 {
        from_shard.status = ShardStatus::Closed;
        from_shard.closed_at = clock.unix_timestamp;
    }
    
    emit!(ShardMigrated {
        from_epoch: from_shard.epoch,
        to_epoch: hydra_index.current_epoch,
        from_shard: from_shard.shard_id,
        to_shards: [to_shard_1.shard_id, 0, 0, 0, 0],
        amounts,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

/// Fund a shard (deposit into Hydra)
#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct FundShard<'info> {
    #[account(
        mut,
        seeds = [HydraIndex::SEED],
        bump = hydra_index.bump
    )]
    pub hydra_index: Account<'info, HydraIndex>,
    
    #[account(
        mut,
        seeds = [
            HydraShard::SEED,
            &hydra_shard.epoch.to_le_bytes(),
            hydra_shard.token_mint.as_ref(),
            &hydra_shard.shard_id.to_le_bytes()
        ],
        bump = hydra_shard.bump
    )]
    pub hydra_shard: Account<'info, HydraShard>,
    
    #[account(
        mut,
        token::mint = token_mint,
    )]
    pub shard_token_account: InterfaceAccount<'info, TokenAccount>,
    
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = funder
    )]
    pub funder_token_account: InterfaceAccount<'info, TokenAccount>,
    
    pub token_mint: InterfaceAccount<'info, Mint>,
    
    pub funder: Signer<'info>,
    
    pub token_program: Program<'info, Token2022>,
}

pub fn fund_shard(ctx: Context<FundShard>, amount: u64) -> Result<()> {
    let hydra_index = &mut ctx.accounts.hydra_index;
    let hydra_shard = &mut ctx.accounts.hydra_shard;
    
    require!(!hydra_index.paused, HydraError::HydraPaused);
    require!(hydra_shard.can_receive(), HydraError::ShardCannotReceive);
    
    let decimals = ctx.accounts.token_mint.decimals;
    
    let transfer_cpi = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.funder_token_account.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
            to: ctx.accounts.shard_token_account.to_account_info(),
            authority: ctx.accounts.funder.to_account_info(),
        },
    );
    
    token_2022::transfer_checked(transfer_cpi, amount, decimals)?;
    
    // Update state
    hydra_shard.balance += amount;
    hydra_index.total_value_locked += amount;
    
    Ok(())
}

/// Emergency pause Hydra (authority only)
#[derive(Accounts)]
pub struct PauseHydra<'info> {
    #[account(
        mut,
        seeds = [HydraIndex::SEED],
        bump = hydra_index.bump,
        has_one = authority @ PgError::Unauthorized
    )]
    pub hydra_index: Account<'info, HydraIndex>,
    
    pub authority: Signer<'info>,
}

pub fn pause_hydra(ctx: Context<PauseHydra>) -> Result<()> {
    ctx.accounts.hydra_index.paused = true;
    Ok(())
}

pub fn unpause_hydra(ctx: Context<PauseHydra>) -> Result<()> {
    ctx.accounts.hydra_index.paused = false;
    Ok(())
}

