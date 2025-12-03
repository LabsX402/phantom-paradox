use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("PDXStk11111111111111111111111111111111111111");

/// PDOX STAKING PROGRAM
/// 
/// Allows agents to:
/// 1. Stake PDOX to become active agents
/// 2. Track reputation scores (0-100)
/// 3. Get slashed for poor performance (<80 score)
/// 4. Claim rewards from slashed agents
/// 
/// Minimum stake: 1000 PDOX
/// Slash threshold: 80/100 reputation
/// Slash amount: 10% of stake per violation

#[program]
pub mod pdox_stake {
    use super::*;

    /// Initialize the staking pool
    pub fn initialize(ctx: Context<Initialize>, bump: u8) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.pdox_mint = ctx.accounts.pdox_mint.key();
        pool.total_staked = 0;
        pool.total_agents = 0;
        pool.slash_pool = 0;
        pool.bump = bump;
        
        msg!("PDOX Staking Pool initialized");
        Ok(())
    }

    /// Stake PDOX to become an active agent
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(amount >= MIN_STAKE, StakeError::InsufficientStake);
        
        let agent = &mut ctx.accounts.agent_account;
        let pool = &mut ctx.accounts.pool;
        
        // Initialize or update agent
        if agent.stake == 0 {
            agent.owner = ctx.accounts.staker.key();
            agent.reputation = 100; // Start with perfect score
            agent.jobs_completed = 0;
            agent.jobs_failed = 0;
            agent.created_at = Clock::get()?.unix_timestamp;
            agent.last_active = Clock::get()?.unix_timestamp;
            agent.is_active = true;
            pool.total_agents += 1;
        }
        
        // Transfer PDOX to pool vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.staker_token.to_account_info(),
            to: ctx.accounts.pool_vault.to_account_info(),
            authority: ctx.accounts.staker.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;
        
        agent.stake += amount;
        pool.total_staked += amount;
        
        msg!("Agent staked {} PDOX. Total stake: {}", amount, agent.stake);
        Ok(())
    }

    /// Unstake PDOX (only if reputation >= 80)
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        let agent = &mut ctx.accounts.agent_account;
        let pool = &mut ctx.accounts.pool;
        
        require!(agent.reputation >= SLASH_THRESHOLD, StakeError::ReputationTooLow);
        require!(agent.stake >= amount, StakeError::InsufficientStake);
        require!(agent.stake - amount >= MIN_STAKE || amount == agent.stake, StakeError::BelowMinStake);
        
        // Transfer PDOX from pool vault to staker
        let seeds = &[
            b"pool".as_ref(),
            &[pool.bump],
        ];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.pool_vault.to_account_info(),
            to: ctx.accounts.staker_token.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;
        
        agent.stake -= amount;
        pool.total_staked -= amount;
        
        if agent.stake == 0 {
            agent.is_active = false;
            pool.total_agents -= 1;
        }
        
        msg!("Agent unstaked {} PDOX. Remaining: {}", amount, agent.stake);
        Ok(())
    }

    /// Update agent reputation (called by authorized watcher)
    pub fn update_reputation(
        ctx: Context<UpdateReputation>,
        new_score: u8,
        job_success: bool,
    ) -> Result<()> {
        let agent = &mut ctx.accounts.agent_account;
        
        require!(new_score <= 100, StakeError::InvalidScore);
        
        let old_score = agent.reputation;
        agent.reputation = new_score;
        agent.last_active = Clock::get()?.unix_timestamp;
        
        if job_success {
            agent.jobs_completed += 1;
        } else {
            agent.jobs_failed += 1;
        }
        
        msg!("Reputation updated: {} -> {}", old_score, new_score);
        
        // Check if slash is needed
        if new_score < SLASH_THRESHOLD && old_score >= SLASH_THRESHOLD {
            msg!("WARNING: Agent fell below threshold. Slash pending.");
        }
        
        Ok(())
    }

    /// Slash an agent with low reputation
    pub fn slash(ctx: Context<Slash>) -> Result<()> {
        let agent = &mut ctx.accounts.agent_account;
        let pool = &mut ctx.accounts.pool;
        
        require!(agent.reputation < SLASH_THRESHOLD, StakeError::AboveThreshold);
        require!(agent.stake > 0, StakeError::NoStake);
        
        // Calculate slash amount (10% of stake)
        let slash_amount = agent.stake / 10;
        
        agent.stake -= slash_amount;
        pool.slash_pool += slash_amount;
        
        // Deactivate if stake too low
        if agent.stake < MIN_STAKE {
            agent.is_active = false;
        }
        
        msg!("Agent slashed {} PDOX. Remaining stake: {}", slash_amount, agent.stake);
        Ok(())
    }

    /// Distribute slash pool to good agents (called periodically)
    pub fn distribute_rewards(ctx: Context<DistributeRewards>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        require!(pool.slash_pool > 0, StakeError::NoRewards);
        
        // In real impl, this would iterate over all agents and distribute
        // proportionally to their stake * reputation
        // For MVP, just reset the pool (actual distribution in off-chain)
        
        msg!("Distributing {} PDOX from slash pool", pool.slash_pool);
        pool.slash_pool = 0;
        
        Ok(())
    }

    /// Record heartbeat (keeps agent active)
    pub fn heartbeat(ctx: Context<Heartbeat>) -> Result<()> {
        let agent = &mut ctx.accounts.agent_account;
        
        require!(agent.is_active, StakeError::AgentInactive);
        
        agent.last_active = Clock::get()?.unix_timestamp;
        
        Ok(())
    }
}

// ============== CONSTANTS ==============

const MIN_STAKE: u64 = 1_000_000_000; // 1000 PDOX (9 decimals)
const SLASH_THRESHOLD: u8 = 80;

// ============== ACCOUNTS ==============

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + StakePool::SIZE,
        seeds = [b"pool"],
        bump
    )]
    pub pool: Account<'info, StakePool>,
    
    /// CHECK: PDOX mint address
    pub pdox_mint: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut, seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,
    
    #[account(
        init_if_needed,
        payer = staker,
        space = 8 + AgentAccount::SIZE,
        seeds = [b"agent", staker.key().as_ref()],
        bump
    )]
    pub agent_account: Account<'info, AgentAccount>,
    
    #[account(mut)]
    pub staker: Signer<'info>,
    
    #[account(mut)]
    pub staker_token: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub pool_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut, seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,
    
    #[account(
        mut,
        seeds = [b"agent", staker.key().as_ref()],
        bump,
        constraint = agent_account.owner == staker.key()
    )]
    pub agent_account: Account<'info, AgentAccount>,
    
    #[account(mut)]
    pub staker: Signer<'info>,
    
    #[account(mut)]
    pub staker_token: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub pool_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateReputation<'info> {
    #[account(seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,
    
    #[account(
        mut,
        seeds = [b"agent", agent_owner.key().as_ref()],
        bump
    )]
    pub agent_account: Account<'info, AgentAccount>,
    
    /// CHECK: Agent owner address
    pub agent_owner: UncheckedAccount<'info>,
    
    #[account(constraint = watcher.key() == pool.authority)]
    pub watcher: Signer<'info>,
}

#[derive(Accounts)]
pub struct Slash<'info> {
    #[account(mut, seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,
    
    #[account(
        mut,
        seeds = [b"agent", agent_owner.key().as_ref()],
        bump
    )]
    pub agent_account: Account<'info, AgentAccount>,
    
    /// CHECK: Agent owner address
    pub agent_owner: UncheckedAccount<'info>,
    
    #[account(constraint = watcher.key() == pool.authority)]
    pub watcher: Signer<'info>,
}

#[derive(Accounts)]
pub struct DistributeRewards<'info> {
    #[account(mut, seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, StakePool>,
    
    #[account(constraint = authority.key() == pool.authority)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Heartbeat<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent.key().as_ref()],
        bump,
        constraint = agent_account.owner == agent.key()
    )]
    pub agent_account: Account<'info, AgentAccount>,
    
    pub agent: Signer<'info>,
}

// ============== STATE ==============

#[account]
pub struct StakePool {
    pub authority: Pubkey,      // 32
    pub pdox_mint: Pubkey,      // 32
    pub total_staked: u64,      // 8
    pub total_agents: u64,      // 8
    pub slash_pool: u64,        // 8
    pub bump: u8,               // 1
}

impl StakePool {
    pub const SIZE: usize = 32 + 32 + 8 + 8 + 8 + 1;
}

#[account]
pub struct AgentAccount {
    pub owner: Pubkey,          // 32
    pub stake: u64,             // 8
    pub reputation: u8,         // 1
    pub jobs_completed: u64,    // 8
    pub jobs_failed: u64,       // 8
    pub created_at: i64,        // 8
    pub last_active: i64,       // 8
    pub is_active: bool,        // 1
}

impl AgentAccount {
    pub const SIZE: usize = 32 + 8 + 1 + 8 + 8 + 8 + 8 + 1;
}

// ============== ERRORS ==============

#[error_code]
pub enum StakeError {
    #[msg("Stake amount below minimum (1000 PDOX)")]
    InsufficientStake,
    
    #[msg("Would drop below minimum stake")]
    BelowMinStake,
    
    #[msg("Reputation too low to unstake (need 80+)")]
    ReputationTooLow,
    
    #[msg("Agent not active")]
    AgentInactive,
    
    #[msg("Reputation score must be 0-100")]
    InvalidScore,
    
    #[msg("Agent above slash threshold")]
    AboveThreshold,
    
    #[msg("No stake to slash")]
    NoStake,
    
    #[msg("No rewards to distribute")]
    NoRewards,
}

