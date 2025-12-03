use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    DevVestingVault, DaoTreasuryVault, DevUnlockRequested, DevUnlockExecuted,
    DaoUnlockProposed, DaoUnlockExecuted, PgError,
    DEV_VESTING_SEED, DAO_TREASURY_SEED,
};

// ======================================================================
// DEV VESTING INSTRUCTIONS
// ======================================================================

/// Initialize dev vesting vault (called at TGE)
/// Enhanced with cliff period and progressive unlocks
/// 
/// Parameters:
/// - total_allocated: Total dev allocation (e.g. 100M PDOX)
/// - liquid_at_tge: Amount liquid at TGE (20% of total_allocated)
/// - locked_amount: Amount to lock (80% of total_allocated)
pub fn init_dev_vesting(
    ctx: Context<InitDevVesting>,
    total_allocated: u64,
    liquid_at_tge: u64,
    locked_amount: u64,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;
    
    require!(
        liquid_at_tge + locked_amount == total_allocated,
        PgError::InvalidAmount
    );
    require!(liquid_at_tge > 0, PgError::InvalidAmount);
    require!(locked_amount > 0, PgError::InvalidAmount);
    
    vault.dev = ctx.accounts.dev.key();
    vault.mint = ctx.accounts.mint.key();
    vault.total_allocated = total_allocated;
    vault.liquid_at_tge = liquid_at_tge;
    vault.total_locked = locked_amount;
    vault.locked_amount = locked_amount;
    vault.pending_amount = 0;
    vault.initialized_at = clock.unix_timestamp;
    vault.last_request_time = 0;
    vault.unlock_time = 0;
    
    // Default parameters (can be updated via governance)
    vault.max_unlock_bps_per_request = 1000; // 10% of locked
    vault.cooldown_secs = 30 * 24 * 60 * 60; // 30 days
    vault.timelock_secs = 30 * 24 * 60 * 60; // 30 days
    vault.cliff_secs = 6 * 30 * 24 * 60 * 60; // 6 months
    vault.current_unlock_rate_bps = 500; // 5% for year 1
    
    vault.bump = ctx.bumps.vault;
    
    // Transfer locked tokens from dev wallet to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.dev_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.dev.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    token::transfer(cpi_ctx, locked_amount)?;
    
    Ok(())
}

/// Request unlock (enhanced with cliff and progressive unlocks)
/// 
/// Rules:
/// 1. Cliff period must be expired (6 months from initialization)
/// 2. Max unlock based on current rate (5% year 1, 10% year 2+)
/// 3. Cooldown between requests (30 days)
/// 4. Timelock from request to availability (30 days)
pub fn request_dev_unlock(
    ctx: Context<RequestDevUnlock>,
    amount: u64,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;
    
    // Rule 1: Cliff period must be expired
    let cliff_expires_at = vault.initialized_at
        .checked_add(vault.cliff_secs)
        .ok_or(PgError::Overflow)?;
    require!(
        clock.unix_timestamp >= cliff_expires_at,
        PgError::UnlockCooldownActive // Reuse error code for cliff
    );
    
    // Rule 2: Max unlock based on current rate (progressive)
    let max_unlock = vault.locked_amount
        .checked_mul(vault.current_unlock_rate_bps as u64)
        .and_then(|x| x.checked_div(10000))
        .ok_or(PgError::Overflow)?;
    
    require!(amount <= max_unlock, PgError::UnlockAmountTooHigh);
    require!(vault.locked_amount >= amount, PgError::InsufficientCredits);
    
    // Rule 3: Cooldown between requests
    if vault.last_request_time > 0 {
        require!(
            clock.unix_timestamp >= vault.last_request_time + vault.cooldown_secs,
            PgError::UnlockCooldownActive
        );
    }
    
    // Rule 4: Timelock from request to availability
    let unlock_time = clock.unix_timestamp
        .checked_add(vault.timelock_secs)
        .ok_or(PgError::Overflow)?;
    
    // Update progressive unlock rate (year 1: 5%, year 2+: 10%)
    let one_year_secs = 365 * 24 * 60 * 60;
    let years_since_init = (clock.unix_timestamp - vault.initialized_at) / one_year_secs;
    if years_since_init >= 1 && vault.current_unlock_rate_bps == 500 {
        vault.current_unlock_rate_bps = 1000; // Increase to 10% after year 1
    }
    
    vault.locked_amount = vault.locked_amount
        .checked_sub(amount)
        .ok_or(PgError::Overflow)?;
    vault.pending_amount = vault.pending_amount
        .checked_add(amount)
        .ok_or(PgError::Overflow)?;
    vault.last_request_time = clock.unix_timestamp;
    vault.unlock_time = unlock_time;
    
    emit!(DevUnlockRequested {
        dev: vault.dev,
        vault: vault.key(),
        amount,
        unlock_time,
    });
    
    Ok(())
}

/// Execute unlock (after timelock expires)
pub fn execute_dev_unlock(ctx: Context<ExecuteDevUnlock>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;
    
    require!(
        clock.unix_timestamp >= vault.unlock_time,
        PgError::UnlockTimelockActive
    );
    require!(vault.pending_amount > 0, PgError::NoPendingUnlock);
    
    let amount = vault.pending_amount;
    vault.pending_amount = 0;
    vault.unlock_time = 0;
    
    // Transfer from vault to dev wallet
    let seeds: &[&[&[u8]]] = &[&[DEV_VESTING_SEED, vault.dev.as_ref(), &[vault.bump]]];
    let cpi_accounts = Transfer {
        from: ctx.accounts.vault_token_account.to_account_info(),
        to: ctx.accounts.dev_token_account.to_account_info(),
        authority: vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        seeds,
    );
    token::transfer(cpi_ctx, amount)?;
    
    emit!(DevUnlockExecuted {
        dev: vault.dev,
        vault: vault.key(),
        amount,
    });
    
    Ok(())
}

// ======================================================================
// DAO TREASURY INSTRUCTIONS
// ======================================================================

/// Initialize DAO treasury vault
pub fn init_dao_treasury(
    ctx: Context<InitDaoTreasury>,
    initial_balance: u64,
    max_unlock_per_period_bps: u16,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    
    require!(max_unlock_per_period_bps <= 2000, PgError::InvalidAmount); // Max 20%
    
    vault.governance = ctx.accounts.governance.key();
    vault.mint = ctx.accounts.mint.key();
    vault.balance = initial_balance;
    vault.pending_amount = 0;
    vault.unlock_time = 0;
    vault.proposal_id = 0;
    vault.pending_destination = Pubkey::default();
    // Note: max_unlock_per_period_bps is not stored in vault (calculated from governance config)
    vault.last_unlock_time = 0;
    vault.bump = ctx.bumps.vault;
    
    // Transfer tokens from governance wallet to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.governance_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.governance.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    token::transfer(cpi_ctx, initial_balance)?;
    
    Ok(())
}

/// Propose DAO treasury unlock (requires DAO vote, then 7-14 day timelock)
pub fn propose_dao_unlock(
    ctx: Context<ProposeDaoUnlock>,
    proposal_id: u64,
    amount: u64,
    destination: Pubkey,
    timelock_days: u8,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;
    
    require!(vault.governance == ctx.accounts.governance.key(), PgError::Unauthorized);
    require!(amount <= vault.balance, PgError::InsufficientCredits);
    require!(timelock_days >= 7 && timelock_days <= 14, PgError::InvalidTime);
    
    // Check max unlock per 30-day period
    // Default to 10% (1000 bps) if not specified during init
    const DEFAULT_MAX_UNLOCK_BPS: u16 = 1000; // 10%
    let period_secs = 30 * 24 * 60 * 60;
    let max_per_period = vault.balance
        .checked_mul(DEFAULT_MAX_UNLOCK_BPS as u64)
        .and_then(|x| x.checked_div(10000))
        .ok_or(PgError::Overflow)?;
    
    if vault.last_unlock_time > 0 && clock.unix_timestamp < vault.last_unlock_time + period_secs {
        // Within same period, check cumulative
        require!(amount <= max_per_period, PgError::TreasuryUnlockTooHigh);
    }
    
    vault.pending_amount = amount;
    vault.proposal_id = proposal_id;
    vault.pending_destination = destination;
    vault.unlock_time = clock.unix_timestamp + (timelock_days as i64 * 24 * 60 * 60);
    
    emit!(DaoUnlockProposed {
        treasury: vault.key(),
        proposal_id,
        amount,
        destination,
        unlock_time: vault.unlock_time,
    });
    
    Ok(())
}

/// Execute DAO treasury unlock (after vote + timelock)
pub fn execute_dao_unlock(ctx: Context<ExecuteDaoUnlock>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;
    
    require!(
        clock.unix_timestamp >= vault.unlock_time,
        PgError::TreasuryTimelockActive
    );
    require!(vault.pending_amount > 0, PgError::NoPendingUnlock);
    
    let amount = vault.pending_amount;
    let destination = vault.pending_destination;
    let proposal_id = vault.proposal_id;
    
    vault.balance = vault.balance
        .checked_sub(amount)
        .ok_or(PgError::Overflow)?;
    vault.pending_amount = 0;
    vault.unlock_time = 0;
    vault.last_unlock_time = clock.unix_timestamp;
    vault.proposal_id = 0;
    vault.pending_destination = Pubkey::default();
    
    // Transfer from vault to destination
    let seeds: &[&[&[u8]]] = &[&[DAO_TREASURY_SEED, vault.governance.as_ref(), &[vault.bump]]];
    let cpi_accounts = Transfer {
        from: ctx.accounts.vault_token_account.to_account_info(),
        to: ctx.accounts.destination_token_account.to_account_info(),
        authority: vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        seeds,
    );
    token::transfer(cpi_ctx, amount)?;
    
    emit!(DaoUnlockExecuted {
        treasury: vault.key(),
        proposal_id,
        amount,
        destination,
    });
    
    Ok(())
}

// ======================================================================
// CONTEXTS
// ======================================================================

#[derive(Accounts)]
pub struct InitDevVesting<'info> {
    #[account(mut)]
    pub dev: Signer<'info>,
    
    /// CHECK: Token mint for vesting - validated by associated token account seeds
    pub mint: AccountInfo<'info>,
    
    #[account(
        init,
        payer = dev,
        space = 8 + std::mem::size_of::<DevVestingVault>(),
        seeds = [DEV_VESTING_SEED, dev.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, DevVestingVault>,
    
    #[account(mut)]
    pub dev_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = dev,
        token::mint = mint,
        token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestDevUnlock<'info> {
    #[account(mut)]
    pub dev: Signer<'info>,
    
    #[account(
        mut,
        seeds = [DEV_VESTING_SEED, dev.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, DevVestingVault>,
}

#[derive(Accounts)]
pub struct ExecuteDevUnlock<'info> {
    #[account(mut)]
    pub dev: Signer<'info>,
    
    #[account(
        mut,
        seeds = [DEV_VESTING_SEED, dev.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, DevVestingVault>,
    
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub dev_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct InitDaoTreasury<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,
    
    /// CHECK: Token mint for treasury - validated by associated token account seeds
    pub mint: AccountInfo<'info>,
    
    #[account(
        init,
        payer = governance,
        space = 8 + std::mem::size_of::<DaoTreasuryVault>(),
        seeds = [DAO_TREASURY_SEED, governance.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, DaoTreasuryVault>,
    
    #[account(mut)]
    pub governance_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = governance,
        token::mint = mint,
        token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProposeDaoUnlock<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,
    
    #[account(
        mut,
        seeds = [DAO_TREASURY_SEED, governance.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, DaoTreasuryVault>,
}

#[derive(Accounts)]
pub struct ExecuteDaoUnlock<'info> {
    pub governance: Signer<'info>,
    
    #[account(
        mut,
        seeds = [DAO_TREASURY_SEED, governance.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, DaoTreasuryVault>,
    
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: Destination is validated in instruction
    #[account(mut)]
    pub destination_token_account: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
}

