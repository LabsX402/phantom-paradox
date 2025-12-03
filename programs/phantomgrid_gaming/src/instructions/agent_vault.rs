use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    AgentVault, AgentPerformance, AgentVaultDeposited, AgentVaultWithdrawn,
    AgentPerformanceUpdated, PgError, AGENT_VAULT_SEED, AGENT_SEED,
};
use crate::instructions::marketplace::AgentRegistry;

// ======================================================================
// AGENT VAULT INSTRUCTIONS
// ======================================================================

/// Initialize agent vault (user deposits funds for agent to trade)
pub fn init_agent_vault(
    ctx: Context<InitAgentVault>,
    max_daily_volume: u64,
    max_per_trade_size: u64,
    allowed_markets_hash: [u8; 32],
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    
    vault.owner = ctx.accounts.owner.key();
    vault.agent = ctx.accounts.agent.key();
    vault.mint = ctx.accounts.mint.key();
    vault.balance = 0;
    vault.max_daily_volume = max_daily_volume;
    vault.max_per_trade_size = max_per_trade_size;
    vault.allowed_markets_hash = allowed_markets_hash;
    vault.bump = ctx.bumps.vault;
    
    Ok(())
}

/// Deposit funds into agent vault
pub fn deposit_agent_vault(
    ctx: Context<DepositAgentVault>,
    amount: u64,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    
    // Transfer from owner to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.owner_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.owner.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    token::transfer(cpi_ctx, amount)?;
    
    vault.balance = vault.balance
        .checked_add(amount)
        .ok_or(PgError::Overflow)?;
    
    emit!(AgentVaultDeposited {
        owner: vault.owner,
        agent: vault.agent,
        vault: vault.key(),
        amount,
    });
    
    Ok(())
}

/// Withdraw funds from agent vault
pub fn withdraw_agent_vault(
    ctx: Context<WithdrawAgentVault>,
    amount: u64,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    
    require!(vault.balance >= amount, PgError::InsufficientCredits);
    
    vault.balance = vault.balance
        .checked_sub(amount)
        .ok_or(PgError::Overflow)?;
    
    // Transfer from vault to owner
    let seeds: &[&[&[u8]]] = &[&[AGENT_VAULT_SEED, vault.owner.as_ref(), vault.agent.as_ref(), &[vault.bump]]];
    let cpi_accounts = Transfer {
        from: ctx.accounts.vault_token_account.to_account_info(),
        to: ctx.accounts.owner_token_account.to_account_info(),
        authority: vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        seeds,
    );
    token::transfer(cpi_ctx, amount)?;
    
    emit!(AgentVaultWithdrawn {
        owner: vault.owner,
        agent: vault.agent,
        vault: vault.key(),
        amount,
    });
    
    Ok(())
}

/// Update agent performance metrics (called by netting engine after batch settlement)
pub fn update_agent_performance(
    ctx: Context<UpdateAgentPerformance>,
    volume: u64,
    pnl: i64,
) -> Result<()> {
    let performance = &mut ctx.accounts.performance;
    let clock = Clock::get()?;
    
    performance.total_volume = performance.total_volume
        .checked_add(volume)
        .ok_or(PgError::Overflow)?;
    
    performance.total_pnl = performance.total_pnl
        .checked_add(pnl)
        .ok_or(PgError::Overflow)?;
    
    // Update max drawdown if PnL is negative
    if pnl < 0 {
        let drawdown = pnl.abs() as u64;
        if drawdown > performance.max_drawdown {
            performance.max_drawdown = drawdown;
        }
    }
    
    performance.trade_count = performance.trade_count
        .checked_add(1)
        .ok_or(PgError::Overflow)?;
    performance.last_update = clock.unix_timestamp;
    
    emit!(AgentPerformanceUpdated {
        agent: performance.agent,
        total_volume: performance.total_volume,
        total_pnl: performance.total_pnl,
        trade_count: performance.trade_count,
        num_items: 0, // Not applicable for performance updates
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}

// ======================================================================
// CONTEXTS
// ======================================================================

#[derive(Accounts)]
pub struct InitAgentVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    /// CHECK: Agent registry account
    pub agent: Account<'info, AgentRegistry>,
    
    /// CHECK: Token mint
    pub mint: AccountInfo<'info>,
    
    #[account(
        init,
        payer = owner,
        space = 8 + std::mem::size_of::<AgentVault>(),
        seeds = [AGENT_VAULT_SEED, owner.key().as_ref(), agent.agent_id.as_ref()],
        bump
    )]
    pub vault: Account<'info, AgentVault>,
    
    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = owner,
        token::mint = mint,
        token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositAgentVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        seeds = [AGENT_VAULT_SEED, owner.key().as_ref(), vault.agent.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, AgentVault>,
    
    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawAgentVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        seeds = [AGENT_VAULT_SEED, owner.key().as_ref(), vault.agent.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, AgentVault>,
    
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateAgentPerformance<'info> {
    /// CHECK: Server authority (netting engine) - must be mutable as payer
    #[account(mut)]
    pub server_authority: Signer<'info>,
    
    /// CHECK: Agent registry
    pub agent: Account<'info, AgentRegistry>,
    
    #[account(
        init_if_needed,
        payer = server_authority,
        space = 8 + std::mem::size_of::<AgentPerformance>(),
        seeds = [AGENT_SEED, agent.agent_id.as_ref(), b"performance"],
        bump
    )]
    pub performance: Account<'info, AgentPerformance>,
    
    pub system_program: Program<'info, System>,
}

