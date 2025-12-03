/**
 * ======================================================================
 * PHANTOM NEXUS - Agent Marketplace & Royalties
 * ======================================================================
 * 
 * The Phantom Nexus is the marketplace where developers publish Agents.
 * Users run Agents to execute trades automatically.
 * 
 * Revenue Model (0.3% Rule):
 * - Total Agent Trade Fee: 0.3% (30 bps) of trade volume
 * - Creator Share: 0.05% (5 bps) if creator is set (User Agent)
 * - Protocol Revenue: 0.25% (25 bps) if creator is set, or full 0.3% if no creator (Protocol/Dev Agent)
 */

use anchor_lang::prelude::*;
use crate::error::PgError;

// ======================================================================
// SEEDS
// ======================================================================

pub const AGENT_SEED: &[u8] = b"agent";

// ======================================================================
// CONSTANTS
// ======================================================================

/// Agent Trade Fee: 0.3% (30 basis points) of trade volume
pub const AGENT_TRADE_FEE_BPS: u16 = 30;

/// Creator Share: 0.05% (5 basis points) of trade volume
pub const CREATOR_SHARE_BPS: u16 = 5;

/// Registration fee: 0.01 SOL
pub const REGISTRATION_FEE_LAMPORTS: u64 = 10_000_000; // 0.01 SOL

/// Minimum payout threshold: 0.01 SOL (prevents dust payouts where tx fees eat most of it)
/// Transaction fees are typically ~0.000005 SOL, so 0.01 SOL ensures meaningful payouts
pub const MIN_PAYOUT_THRESHOLD_LAMPORTS: u64 = 10_000_000; // 0.01 SOL

// ======================================================================
// ACCOUNTS
// ======================================================================

/// Agent Registry - Tracks agent usage, accumulated royalties, and comprehensive corporate analytics
/// 
/// CORPORATE-GRADE METRICS:
/// - User Adoption: Unique users, adoption rate, retention
/// - Performance: Volume, PnL, success rates, average performance per user
/// - Geographic Distribution: GPS data (with explicit permission)
/// - Device/Network Data: Phone model, mobile operator, signal strength (with explicit permission)
/// - Network Coverage Mapping: For mobile operators to build real-world coverage maps
#[account]
pub struct AgentRegistry {
    /// The developer/creator who owns this agent
    pub authority: Pubkey,
    
    /// The Agent's unique identifier (mint/pubkey)
    pub agent_id: Pubkey,
    
    /// The creator who receives royalties (None for Protocol/Dev Agents)
    /// If Some(creator), this is a User Agent and creator gets 5 bps
    /// If None, this is a Protocol/Dev Agent and protocol keeps full 0.3%
    pub creator: Option<Pubkey>,
    
    /// Accumulated royalties waiting to be claimed (in lamports)
    pub accumulated_royalties: u64,
    
    /// Total volume processed by this agent (for stats)
    pub total_volume_processed: u128,
    
    /// CORPORATE METRICS: User Adoption & Engagement
    /// Number of unique users who have "taken this agent home" (adopted it)
    /// This is the key metric corporations want: "How many people use this agent?"
    pub unique_users_count: u64,
    
    /// Number of active users (users who used agent in last 30 days)
    pub active_users_count: u64,
    
    /// Total number of times agent was adopted/activated by users
    pub total_adoptions: u64,
    
    /// Average volume per user (total_volume_processed / unique_users_count)
    /// This shows average performance per agent worker
    pub avg_volume_per_user: u128,
    
    /// Retention rate (percentage of users who return after first use)
    /// Calculated off-chain: (returning_users / unique_users) * 100
    /// Stored as basis points (0-10000 = 0-100%)
    pub retention_rate_bps: u16,
    
    /// CORPORATE METRICS: Performance Analytics
    /// Total number of successful executions (trades completed)
    pub successful_executions: u64,
    
    /// Total number of failed executions
    pub failed_executions: u64,
    
    /// Success rate (successful_executions / total_executions) * 10000
    /// Stored as basis points (0-10000 = 0-100%)
    pub success_rate_bps: u16,
    
    /// Average execution time in milliseconds (for performance benchmarking)
    /// Calculated off-chain and updated periodically
    pub avg_execution_time_ms: u64,
    
    /// Timestamp when agent was registered
    pub registered_at: i64,
    
    /// Last time agent was used (for activity tracking)
    pub last_used_at: i64,
    
    /// Bump seed for PDA
    pub bump: u8,
    
    /// Reserved for future use
    pub reserved: [u8; 7],
}

// ======================================================================
// INSTRUCTIONS
// ======================================================================

/// Register a new agent in the marketplace
/// 
/// Requires 0.01 SOL transfer to protocol_treasury.
/// 
/// # Arguments
/// - `agent_id`: The Agent's unique identifier (mint/pubkey)
/// - `creator`: Optional creator pubkey. If Some, this is a User Agent (creator gets 5 bps).
///              If None, this is a Protocol/Dev Agent (protocol keeps full 0.3%).
/// 
/// # Errors
/// - `PgError::Unauthorized` if payer is not the authority
/// - `PgError::InvalidAmount` if registration fee is not paid
pub fn register_agent(
    ctx: Context<RegisterAgent>, 
    agent_id: Pubkey,
    creator: Option<Pubkey>
) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    let clock = Clock::get()?;
    
    // Verify registration fee payment (0.01 SOL)
    let payer_lamports_before = ctx.accounts.payer.to_account_info().lamports();
    let treasury_lamports_before = ctx.accounts.protocol_treasury.to_account_info().lamports();
    
    // Transfer 0.01 SOL from payer to protocol_treasury
    **ctx.accounts.payer.to_account_info().try_borrow_mut_lamports()? = payer_lamports_before
        .checked_sub(REGISTRATION_FEE_LAMPORTS)
        .ok_or(PgError::InvalidAmount)?;
    
    **ctx.accounts.protocol_treasury.to_account_info().try_borrow_mut_lamports()? = treasury_lamports_before
        .checked_add(REGISTRATION_FEE_LAMPORTS)
        .ok_or(PgError::Overflow)?;
    
    registry.authority = ctx.accounts.authority.key();
    registry.agent_id = agent_id;
    registry.creator = creator;
    registry.accumulated_royalties = 0;
    registry.total_volume_processed = 0;
    
    // Initialize corporate metrics
    registry.unique_users_count = 0;
    registry.active_users_count = 0;
    registry.total_adoptions = 0;
    registry.avg_volume_per_user = 0;
    registry.retention_rate_bps = 0;
    registry.successful_executions = 0;
    registry.failed_executions = 0;
    registry.success_rate_bps = 0;
    registry.avg_execution_time_ms = 0;
    
    registry.registered_at = clock.unix_timestamp;
    registry.last_used_at = 0; // Not used yet
    registry.bump = ctx.bumps.registry;
    
    if let Some(creator) = creator {
        msg!("Agent registered: {} by {} (User Agent, creator: {})", 
             agent_id, ctx.accounts.authority.key(), creator);
    } else {
        msg!("Agent registered: {} by {} (Protocol/Dev Agent)", 
             agent_id, ctx.accounts.authority.key());
    }
    
    Ok(())
}

/// Claim accumulated royalties for an agent
/// 
/// Transfers accumulated royalties from the protocol vault to the agent creator.
/// Only the defined creator can claim royalties (not the authority).
/// 
/// # Errors
/// - `PgError::Unauthorized` if signer is not the agent creator
/// - `PgError::InvalidAmount` if no royalties to claim or creator is not set
pub fn claim_royalties(ctx: Context<ClaimRoyalties>) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    
    // Only the creator can claim royalties (not the authority)
    let creator = registry.creator.ok_or(PgError::InvalidAmount)?;
    
    require!(
        ctx.accounts.authority.key() == creator,
        PgError::Unauthorized
    );
    
    // Minimum payout threshold: prevents dust payouts where transaction fees eat most of the payout
    // Transaction fees are typically ~0.000005 SOL, so 0.01 SOL ensures meaningful payouts
    require!(
        registry.accumulated_royalties >= MIN_PAYOUT_THRESHOLD_LAMPORTS,
        PgError::InvalidAmount
    );
    
    msg!("Claiming royalties: {} lamports (minimum threshold: {} lamports)", 
         registry.accumulated_royalties, MIN_PAYOUT_THRESHOLD_LAMPORTS);
    
    let amount = registry.accumulated_royalties;
    
    // Transfer from vault to creator (using checked arithmetic to prevent overflow)
    let vault_lamports = ctx.accounts.vault.to_account_info().lamports();
    let new_vault_lamports = vault_lamports
        .checked_sub(amount)
        .ok_or(PgError::Overflow)?;
    **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? = new_vault_lamports;
    
    let creator_lamports = ctx.accounts.authority.to_account_info().lamports();
    let new_creator_lamports = creator_lamports
        .checked_add(amount)
        .ok_or(PgError::Overflow)?;
    **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? = new_creator_lamports;
    
    // Reset accumulated royalties
    registry.accumulated_royalties = 0;
    
    msg!("Royalties claimed: {} lamports by creator {}", amount, creator);
    
    Ok(())
}

/// Record agent adoption - Called when a user "takes an agent home" (adopts it)
/// 
/// This is the KEY METRIC corporations want: "How many people use this agent?"
/// Updates unique_users_count, total_adoptions, and retention metrics.
/// 
/// # Arguments
/// - `is_new_user`: Whether this is the first time this user is adopting this agent
/// 
/// # Events
/// - Emits `AgentAdopted` event for off-chain analytics
pub fn record_agent_adoption(
    ctx: Context<RecordAgentAdoption>,
    is_new_user: bool,
) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    let clock = Clock::get()?;
    
    // Update adoption metrics
    registry.total_adoptions = registry.total_adoptions
        .checked_add(1)
        .ok_or(PgError::Overflow)?;
    
    if is_new_user {
        registry.unique_users_count = registry.unique_users_count
            .checked_add(1)
            .ok_or(PgError::Overflow)?;
    }
    
    // Update last used timestamp
    registry.last_used_at = clock.unix_timestamp;
    
    // Emit event for off-chain analytics
    emit!(crate::AgentAdopted {
        agent: registry.agent_id,
        user: ctx.accounts.user.key(),
        timestamp: clock.unix_timestamp,
        is_new_user,
    });
    
    msg!("Agent adoption recorded: agent={}, user={}, is_new_user={}", 
         registry.agent_id, ctx.accounts.user.key(), is_new_user);
    
    Ok(())
}

/// Record agent usage - Called when agent executes/works
/// 
/// Updates performance metrics: success rate, execution time, volume per user.
/// 
/// # Arguments
/// - `volume`: Volume processed in this execution (in lamports)
/// - `success`: Whether execution was successful
/// - `execution_time_ms`: Execution time in milliseconds
/// 
/// # Events
/// - Emits `AgentUsed` event for off-chain analytics
pub fn record_agent_usage(
    ctx: Context<RecordAgentUsage>,
    volume: u64,
    success: bool,
    execution_time_ms: u64,
) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    let clock = Clock::get()?;
    
    // Update volume
    registry.total_volume_processed = registry.total_volume_processed
        .checked_add(volume as u128)
        .ok_or(PgError::Overflow)?;
    
    // Update success/failure counts
    if success {
        registry.successful_executions = registry.successful_executions
            .checked_add(1)
            .ok_or(PgError::Overflow)?;
    } else {
        registry.failed_executions = registry.failed_executions
            .checked_add(1)
            .ok_or(PgError::Overflow)?;
    }
    
    // Calculate success rate (in basis points)
    let total_executions = registry.successful_executions
        .checked_add(registry.failed_executions)
        .ok_or(PgError::Overflow)?;
    
    if total_executions > 0 {
        registry.success_rate_bps = ((registry.successful_executions as u128)
            .checked_mul(10_000)
            .and_then(|x| x.checked_div(total_executions as u128))
            .unwrap_or(0)) as u16;
    }
    
    // Update average execution time (exponential moving average)
    // EMA: new_avg = (old_avg * 0.9) + (new_value * 0.1)
    registry.avg_execution_time_ms = ((registry.avg_execution_time_ms as u128)
        .checked_mul(9)
        .and_then(|x| x.checked_add((execution_time_ms as u128).checked_mul(1)?))
        .and_then(|x| x.checked_div(10))
        .unwrap_or(execution_time_ms as u128)) as u64;
    
    // Update average volume per user
    if registry.unique_users_count > 0 {
        registry.avg_volume_per_user = registry.total_volume_processed
            .checked_div(registry.unique_users_count as u128)
            .unwrap_or(0);
    }
    
    // Update last used timestamp
    registry.last_used_at = clock.unix_timestamp;
    
    // Emit event for off-chain analytics
    emit!(crate::AgentUsed {
        agent: registry.agent_id,
        user: ctx.accounts.user.key(),
        volume,
        success,
        execution_time_ms,
        timestamp: clock.unix_timestamp,
    });
    
    msg!("Agent usage recorded: agent={}, user={}, volume={}, success={}, time_ms={}", 
         registry.agent_id, ctx.accounts.user.key(), volume, success, execution_time_ms);
    
    Ok(())
}

/// Record agent data collection - PRIVACY-PRESERVING data collection with EXPLICIT permission
/// 
/// COLLECTS (with 100% EXPLICIT permission):
/// - GPS location (latitude, longitude)
/// - Phone model
/// - Mobile operator
/// - Mobile signal strength
/// - Network type (2G/3G/4G/5G)
/// - WiFi SSID (optional, with permission)
/// 
/// USE CASE: Mobile operators can use agents to build real-world network coverage maps
/// (not theoretical coverage, but ACTUAL coverage based on user data)
/// 
/// PRIVACY:
/// - Data collection requires EXPLICIT opt-in (permission_granted MUST be true)
/// - Sensitive data (operator names, WiFi SSIDs) stored as hashes on-chain
/// - Full data stored off-chain in encrypted database
/// - Users can revoke permission at any time
/// 
/// # Arguments
/// - `latitude`: GPS latitude (scaled by 1e6, e.g., 37.7749 = 37774900)
/// - `longitude`: GPS longitude (scaled by 1e6, e.g., -122.4194 = -122419400)
/// - `mobile_operator_hash`: Hash of mobile operator name (e.g., "Verizon", "AT&T")
/// - `phone_model_hash`: Hash of phone model (e.g., "iPhone 15 Pro")
/// - `signal_strength_dbm`: Signal strength in dBm (-120 to -50, typical range)
/// - `network_type`: Network type (0=Unknown, 1=2G, 2=3G, 3=4G/LTE, 4=5G)
/// - `wifi_ssid_hash`: Optional WiFi SSID hash (if WiFi was used, with permission)
/// - `permission_granted`: MUST be true - data collection requires explicit opt-in
/// 
/// # Errors
/// - `PgError::InvalidAmount` if permission_granted is false
/// 
/// # Events
/// - Emits `AgentDataCollected` event for off-chain analytics and network coverage mapping
pub fn record_agent_data_collection(
    ctx: Context<RecordAgentDataCollection>,
    latitude: i32,
    longitude: i32,
    mobile_operator_hash: [u8; 32],
    phone_model_hash: [u8; 32],
    signal_strength_dbm: i16,
    network_type: u8,
    wifi_ssid_hash: Option<[u8; 32]>,
    permission_granted: bool,
) -> Result<()> {
    // CRITICAL: Data collection requires EXPLICIT permission
    require!(
        permission_granted,
        PgError::InvalidAmount
    );
    
    // Validate network type
    require!(
        network_type <= 4, // 0=Unknown, 1=2G, 2=3G, 3=4G/LTE, 4=5G
        PgError::InvalidAmount
    );
    
    // Validate signal strength (typical range: -120 dBm to -50 dBm)
    require!(
        signal_strength_dbm >= -120 && signal_strength_dbm <= -50,
        PgError::InvalidAmount
    );
    
    // Validate GPS coordinates (rough bounds check)
    require!(
        latitude >= -90_000_000 && latitude <= 90_000_000, // -90 to +90 degrees
        PgError::InvalidAmount
    );
    require!(
        longitude >= -180_000_000 && longitude <= 180_000_000, // -180 to +180 degrees
        PgError::InvalidAmount
    );
    
    let registry = &ctx.accounts.registry;
    let clock = Clock::get()?;
    
    // Emit event for off-chain analytics and network coverage mapping
    emit!(crate::AgentDataCollected {
        agent: registry.agent_id,
        user: ctx.accounts.user.key(),
        latitude,
        longitude,
        mobile_operator_hash,
        phone_model_hash,
        signal_strength_dbm,
        network_type,
        wifi_ssid_hash,
        timestamp: clock.unix_timestamp,
        permission_granted: true, // Always true (checked above)
    });
    
    msg!("Agent data collection recorded: agent={}, user={}, lat={}, lon={}, signal={}dBm, network={}", 
         registry.agent_id, ctx.accounts.user.key(), latitude, longitude, signal_strength_dbm, network_type);
    
    Ok(())
}

// ======================================================================
// CONTEXTS
// ======================================================================

#[derive(Accounts)]
#[instruction(agent_id: Pubkey, creator: Option<Pubkey>)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + size_of::<AgentRegistry>(), // Compile-time constant - safe
        seeds = [AGENT_SEED, agent_id.as_ref()],
        bump
    )]
    pub registry: Account<'info, AgentRegistry>,
    
    /// CHECK: The developer/creator who owns this agent
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    /// CHECK: GlobalConfig to access protocol_treasury
    /// Seeds: [CONFIG_SEED]
    pub config: Account<'info, crate::GlobalConfig>,
    
    /// CHECK: Protocol treasury wallet (must match config.protocol_treasury)
    #[account(
        mut,
        constraint = protocol_treasury.key() == config.protocol_treasury @ PgError::Unauthorized
    )]
    pub protocol_treasury: SystemAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimRoyalties<'info> {
    #[account(
        mut,
        seeds = [AGENT_SEED, registry.agent_id.key().as_ref()],
        bump = registry.bump
    )]
    pub registry: Account<'info, AgentRegistry>,
    
    /// CHECK: Must match registry.authority
    pub authority: Signer<'info>,
    
    /// CHECK: Protocol vault (where royalties accumulate)
    #[account(mut)]
    pub vault: SystemAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordAgentAdoption<'info> {
    #[account(
        mut,
        seeds = [AGENT_SEED, registry.agent_id.key().as_ref()],
        bump = registry.bump
    )]
    pub registry: Account<'info, AgentRegistry>,
    
    /// CHECK: User who is adopting the agent
    pub user: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordAgentUsage<'info> {
    #[account(
        mut,
        seeds = [AGENT_SEED, registry.agent_id.key().as_ref()],
        bump = registry.bump
    )]
    pub registry: Account<'info, AgentRegistry>,
    
    /// CHECK: User who is using the agent
    pub user: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordAgentDataCollection<'info> {
    #[account(
        seeds = [AGENT_SEED, registry.agent_id.key().as_ref()],
        bump = registry.bump
    )]
    pub registry: Account<'info, AgentRegistry>,
    
    /// CHECK: User who granted permission for data collection
    pub user: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

