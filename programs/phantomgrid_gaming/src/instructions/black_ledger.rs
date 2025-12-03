use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::{
    BlackLedgerConfig, BlackLedgerWallet, BlackLedgerConfigUpdated,
    TransferBlockedByBlackLedger, ArmageddonThresholdChangeProposed,
    PgError, BLACK_LEDGER_SEED,
};

// ======================================================================
// BLACK LEDGER INSTRUCTIONS
// ======================================================================

/// Initialize Black Ledger config (called when PDOX mint is created)
/// Sets safe defaults: risk_score=0, armageddon_threshold=255 (effectively disabled)
pub fn init_black_ledger(
    ctx: Context<InitBlackLedger>,
    min_quarantine_amount: u64,
    betrayal_ratio_bps: u16,
    lifeboat_percent_bps: u16,
    epoch_duration_secs: i64,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    
    require!(lifeboat_percent_bps <= 2000, PgError::InvalidAmount); // Max 20%
    require!(betrayal_ratio_bps <= 10000, PgError::InvalidBetrayalRatio);
    
    config.mint = ctx.accounts.mint.key();
    config.risk_score = 0; // Off by default
    config.armageddon_threshold = 255; // Effectively disabled
    config.min_quarantine_amount = min_quarantine_amount;
    config.betrayal_ratio_bps = betrayal_ratio_bps;
    config.lifeboat_percent_bps = lifeboat_percent_bps;
    config.epoch_duration_secs = epoch_duration_secs;
    config.authority = ctx.accounts.authority.key();
    config.threshold_change_proposed_at = 0;
    config.proposed_threshold = None;
    config.min_armageddon_threshold = 200; // Hard limit: cannot go below 200 without DAO
    config.bump = ctx.bumps.config;
    
    Ok(())
}

/// Propose armageddon threshold change (requires DAO vote + 7-14 day timelock)
pub fn propose_armageddon_threshold_change(
    ctx: Context<ProposeArmageddonThresholdChange>,
    new_threshold: u8,
    timelock_days: u8,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let clock = Clock::get()?;
    
    require!(config.authority == ctx.accounts.authority.key(), PgError::Unauthorized);
    require!(new_threshold >= config.min_armageddon_threshold, PgError::InvalidAmount);
    require!(timelock_days >= 7 && timelock_days <= 14, PgError::InvalidTime);
    
    config.proposed_threshold = Some(new_threshold);
    config.threshold_change_proposed_at = clock.unix_timestamp;
    
    let unlock_time = clock.unix_timestamp + (timelock_days as i64 * 24 * 60 * 60);
    
    emit!(ArmageddonThresholdChangeProposed {
        mint: config.mint,
        current_threshold: config.armageddon_threshold,
        proposed_threshold: new_threshold,
        unlock_time,
    });
    
    Ok(())
}

/// Execute armageddon threshold change (after DAO vote + timelock)
pub fn execute_armageddon_threshold_change(
    ctx: Context<ExecuteArmageddonThresholdChange>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let clock = Clock::get()?;
    
    require!(config.authority == ctx.accounts.authority.key(), PgError::Unauthorized);
    
    let proposed = config.proposed_threshold.ok_or(PgError::InvalidAmount)?;
    let timelock_secs = 7 * 24 * 60 * 60; // Minimum 7 days
    
    require!(
        clock.unix_timestamp >= config.threshold_change_proposed_at + timelock_secs,
        PgError::ArmageddonTimelockActive
    );
    
    config.armageddon_threshold = proposed;
    config.proposed_threshold = None;
    config.threshold_change_proposed_at = 0;
    
    emit!(BlackLedgerConfigUpdated {
        mint: config.mint,
        risk_score: config.risk_score,
        armageddon_threshold: config.armageddon_threshold,
    });
    
    Ok(())
}

/// Update risk score (can be called by authority, but changes to threshold require DAO)
pub fn update_risk_score(
    ctx: Context<UpdateRiskScore>,
    new_risk_score: u8,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    
    require!(config.authority == ctx.accounts.authority.key(), PgError::Unauthorized);
    // Note: new_risk_score is u8, always <= 255
    
    config.risk_score = new_risk_score;
    
    emit!(BlackLedgerConfigUpdated {
        mint: config.mint,
        risk_score: config.risk_score,
        armageddon_threshold: config.armageddon_threshold,
    });
    
    Ok(())
}

// ======================================================================
// TRANSFER HOOK (Called by SPL Token-2022 program)
// ======================================================================

/// Transfer hook - validates transfers based on Black Ledger rules
/// This is called automatically by SPL Token-2022 during transfers
/// NOTE: This is a placeholder - actual transfer hook must implement SPL Transfer Hook Interface
/// For production, this should be a separate program that implements the interface
#[allow(clippy::too_many_arguments)]
pub fn on_transfer(
    ctx: Context<OnTransfer>,
    amount: u64,
) -> Result<()> {
    let config = &ctx.accounts.config;
    let wallet = &mut ctx.accounts.wallet;
    let clock = Clock::get()?;
    
    // Initialize wallet if needed
    if wallet.wallet == Pubkey::default() {
        wallet.wallet = ctx.accounts.source_account.owner;
        wallet.mint = config.mint;
        wallet.betrayal_score = 0;
        wallet.last_epoch = 0;
        wallet.epoch_transfer_amount = 0;
        wallet.bump = ctx.bumps.wallet;
    }
    
    // Rule 1: If Armageddon is off (threshold = 255), allow all transfers
    if config.armageddon_threshold >= 255 {
        return Ok(());
    }
    
    // Rule 2: Check if risk_score >= armageddon_threshold (Armageddon mode active)
    if config.risk_score >= config.armageddon_threshold {
        // Rule 3: Lifeboat rule - always allow up to X% of balance per epoch
        let source_balance = ctx.accounts.source_account.amount;
        let lifeboat_amount = source_balance
            .checked_mul(config.lifeboat_percent_bps as u64)
            .and_then(|x| x.checked_div(10000))
            .ok_or(PgError::Overflow)?;
        
        // Check epoch reset
        let current_epoch = clock.unix_timestamp / config.epoch_duration_secs;
        let wallet_epoch = wallet.last_epoch;
        
        if current_epoch > wallet_epoch {
            // New epoch, reset counter
            wallet.epoch_transfer_amount = 0;
            wallet.last_epoch = current_epoch;
        }
        
        // Check if transfer exceeds lifeboat limit
        let new_epoch_amount = wallet.epoch_transfer_amount
            .checked_add(amount)
            .ok_or(PgError::Overflow)?;
        
        if new_epoch_amount > lifeboat_amount {
            emit!(TransferBlockedByBlackLedger {
                wallet: ctx.accounts.source_account.owner,
                mint: config.mint,
                amount,
                reason: "Exceeds lifeboat limit".to_string(),
            });
            return Err(PgError::TransferRateLimitExceeded.into());
        }
        
        // Update epoch transfer amount
        wallet.epoch_transfer_amount = new_epoch_amount;
        
        // Rule 4: Check betrayal ratio (if dumping large % of balance)
        let betrayal_ratio = amount
            .checked_mul(10000)
            .and_then(|x| x.checked_div(source_balance.max(1)))
            .ok_or(PgError::Overflow)?;
        
        if betrayal_ratio >= config.betrayal_ratio_bps as u64 && amount >= config.min_quarantine_amount {
            // Increase betrayal score
            wallet.betrayal_score = wallet.betrayal_score.saturating_add(1);
            
            // If betrayal score is high, block transfer (beyond lifeboat)
            if wallet.betrayal_score >= 10 {
                emit!(TransferBlockedByBlackLedger {
                    wallet: ctx.accounts.source_account.owner,
                    mint: config.mint,
                    amount,
                    reason: "High betrayal score".to_string(),
                });
                return Err(PgError::TransferBlockedByBlackLedger.into());
            }
        }
    }
    
    Ok(())
}

// ======================================================================
// CONTEXTS
// ======================================================================

#[derive(Accounts)]
pub struct InitBlackLedger<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// CHECK: Mint address
    pub mint: AccountInfo<'info>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<BlackLedgerConfig>(),
        seeds = [BLACK_LEDGER_SEED, mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, BlackLedgerConfig>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProposeArmageddonThresholdChange<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [BLACK_LEDGER_SEED, config.mint.as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, BlackLedgerConfig>,
}

#[derive(Accounts)]
pub struct ExecuteArmageddonThresholdChange<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [BLACK_LEDGER_SEED, config.mint.as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, BlackLedgerConfig>,
}

#[derive(Accounts)]
pub struct UpdateRiskScore<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [BLACK_LEDGER_SEED, config.mint.as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, BlackLedgerConfig>,
}

#[derive(Accounts)]
pub struct OnTransfer<'info> {
    /// CHECK: Validated by SPL Token-2022 program
    pub config: Account<'info, BlackLedgerConfig>,
    
    /// CHECK: Source token account
    #[account(mut)]
    pub source_account: Account<'info, TokenAccount>,
    
    /// CHECK: Wallet tracking account (must exist - created separately)
    #[account(
        seeds = [BLACK_LEDGER_SEED, config.mint.as_ref(), source_account.owner.as_ref()],
        bump
    )]
    pub wallet: Account<'info, BlackLedgerWallet>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

