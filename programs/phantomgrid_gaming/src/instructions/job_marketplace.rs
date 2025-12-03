/**
 * ======================================================================
 * JOB MARKETPLACE - Clean Way for Job Givers to Post Work
 * ======================================================================
 * 
 * Flow:
 * 1. Job giver selects agent type (e.g., "computing power agent")
 * 2. Sees average price paid for workers
 * 3. Sets price (same/lower/higher depending on speed needs)
 * 4. Tops up balance
 * 5. Job is posted and waiting for workers
 * 6. Workers take jobs (with rate limiting to prevent budget overflow)
 * 7. Workers complete jobs and get paid
 * 
 * BUDGET PROTECTION:
 * - Max workers per job (prevents 1000 workers from taking 10 SOL job)
 * - Budget tracking (ensures we don't pay more than available)
 * - Payment on completion (workers only get paid when they deliver)
 */

use anchor_lang::prelude::*;
use crate::error::PgError;
use crate::instructions::marketplace::AgentRegistry;
use crate::{JobCreated, JobTaken, JobCompleted, JobCancelled};

// ======================================================================
// SEEDS
// ======================================================================

pub const JOB_SEED: &[u8] = b"job";
pub const JOB_ASSIGNMENT_SEED: &[u8] = b"job_assignment";
pub const JOB_BUDGET_SEED: &[u8] = b"job_budget";
pub const WORKER_SEED: &[u8] = b"worker";

// ======================================================================
// ACCOUNTS
// ======================================================================

/// Job Posting - A job that needs workers
#[account]
pub struct JobPosting {
    /// Job giver (who posted the job)
    pub job_giver: Pubkey,
    
    /// Agent type required (e.g., "computing power agent")
    pub agent_id: Pubkey,
    
    /// Job identifier (unique per job giver)
    pub job_id: u64,
    
    /// Price per worker (in lamports)
    pub price_per_worker: u64,
    
    /// Price per worker (in USD cents) - for fiat pricing
    pub price_per_worker_usd_cents: u64,
    
    /// Total budget allocated for this job (in lamports)
    pub total_budget: u64,
    
    /// Budget remaining (decreases as workers are paid)
    pub budget_remaining: u64,
    
    /// Maximum number of workers allowed (prevents budget overflow)
    /// Example: 10 SOL budget, 0.01 SOL per worker = max 1000 workers
    /// But if we set max_workers = 100, then only 100 workers can take the job
    pub max_workers: u64,
    
    /// Current number of workers who have taken the job
    pub workers_taken: u64,
    
    /// Current number of workers who have completed the job
    pub workers_completed: u64,
    
    /// Job status
    pub status: JobStatus,
    
    /// Timestamp when job was created
    pub created_at: i64,
    
    /// Timestamp when job expires (0 = no expiration)
    pub expires_at: i64,
    
    /// Bump seed for PDA
    pub bump: u8,
    
    /// Reserved for future use
    pub reserved: [u8; 7],
}

/// Job Status
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum JobStatus {
    /// Job is open and accepting workers
    Open,
    /// Job is closed (budget exhausted or manually closed)
    Closed,
    /// Job is completed (all workers completed or job giver closed it)
    Completed,
    /// Job is cancelled (job giver cancelled before completion)
    Cancelled,
}

/// Worker Assignment - Tracks when a worker takes a job
#[account]
pub struct WorkerAssignment {
    /// Job this assignment is for
    pub job: Pubkey,
    
    /// Worker who took the job
    pub worker: Pubkey,
    
    /// Assignment identifier (unique per job)
    pub assignment_id: u64,
    
    /// Status of the assignment
    pub status: AssignmentStatus,
    
    /// Timestamp when worker took the job
    pub assigned_at: i64,
    
    /// Timestamp when worker completed the job (0 if not completed)
    pub completed_at: i64,
    
    /// Payment amount (in lamports)
    pub payment_amount: u64,
    
    /// Whether payment has been made
    pub payment_made: bool,
    
    /// Bump seed for PDA
    pub bump: u8,
    
    /// Reserved for future use
    pub reserved: [u8; 7],
}

/// Assignment Status
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AssignmentStatus {
    /// Worker has taken the job but not completed it yet
    Assigned,
    /// Worker has completed the job and is waiting for payment
    Completed,
    /// Worker has been paid
    Paid,
    /// Assignment was cancelled
    Cancelled,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Worker Profile & Payout Preferences
// ─────────────────────────────────────────────────────────────────────────────

#[account]
pub struct WorkerProfile {
    pub authority: Pubkey,
    pub bump: u8,

    // Payout method chosen by worker
    pub payout_method: PayoutMethod,

    // Custom payout address (PayPal email, UPI ID, phone for M-Pesa, etc.)
    pub payout_address: String, // max 64 chars

    // Worker sets their own price per job (in lamports or USD cents)
    pub bid_price_lamports: u64,        // if they want SOL/USDC
    pub bid_price_usd_cents: u64,       // if they want fiat

    // Stats used for ranking
    pub total_jobs_completed: u64,
    pub total_volume_earned: u64,
    pub avg_response_time_ms: u64,
    pub success_rate_bps: u16, // 10000 = 100%

    pub created_at: i64,
    pub last_active: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PayoutMethod {
    Sol,
    Usdc,
    Paypal,
    MPesa,
    Upi,
    Alipay,
}

impl Default for PayoutMethod {
    fn default() -> Self { PayoutMethod::Sol }
}

impl TryFrom<u8> for PayoutMethod {
    type Error = Error;
    fn try_from(value: u8) -> Result<Self> {
        match value {
            0 => Ok(PayoutMethod::Sol),
            1 => Ok(PayoutMethod::Usdc),
            2 => Ok(PayoutMethod::Paypal),
            3 => Ok(PayoutMethod::MPesa),
            4 => Ok(PayoutMethod::Upi),
            5 => Ok(PayoutMethod::Alipay),
            _ => Err(PgError::InvalidPayoutMethod.into()),
        }
    }
}

// ======================================================================
// INSTRUCTIONS
// ======================================================================

/// Worker registers or updates their profile + payout preferences
pub fn register_worker(
    ctx: Context<RegisterWorker>, 
    payout_method: u8,
    payout_address: String,
    bid_price_lamports: u64,
    bid_price_usd_cents: u64,
) -> Result<()> {
    require!(payout_address.len() <= 64, PgError::InvalidAmount);
    
    let profile = &mut ctx.accounts.worker_profile;
    let clock = Clock::get()?;
    
    profile.authority = ctx.accounts.authority.key();
    profile.bump = ctx.bumps.worker_profile;
    profile.payout_method = PayoutMethod::try_from(payout_method)?;
    profile.payout_address = payout_address;
    profile.bid_price_lamports = bid_price_lamports;
    profile.bid_price_usd_cents = bid_price_usd_cents;
    
    // Initialize stats if new profile
    if profile.created_at == 0 {
        profile.success_rate_bps = 10000;
        profile.created_at = clock.unix_timestamp;
    }
    
    profile.last_active = clock.unix_timestamp;

    Ok(())
}

/// Create a job posting
/// 
/// Job giver:
/// 1. Selects agent type
/// 2. Sees average price (calculated off-chain from historical data)
/// 3. Sets price_per_worker (can be same/lower/higher than average)
/// 4. Sets total_budget (e.g., 10 SOL)
/// 5. Sets max_workers (prevents too many workers from taking the job)
/// 6. Tops up balance (transfers funds to job budget account)
/// 
/// # Arguments
/// - `job_id`: Unique job identifier (per job giver)
/// - `agent_id`: Agent type required for this job
/// - `price_per_worker`: Price to pay each worker (in lamports)
/// - `max_workers`: Maximum number of workers allowed (prevents budget overflow)
/// - `expires_at`: Optional expiration timestamp (0 = no expiration)
/// 
/// # Errors
/// - `PgError::InvalidAmount` if price_per_worker is 0 or max_workers is 0
/// - `PgError::InsufficientCredits` if job giver doesn't have enough balance
pub fn create_job_posting(
    ctx: Context<CreateJobPosting>,
    job_id: u64,
    agent_id: Pubkey,
    price_per_worker: u64,
    price_per_worker_usd_cents: u64,
    max_workers: u64,
    expires_at: i64,
) -> Result<()> {
    require!(price_per_worker > 0, PgError::InvalidAmount);
    require!(max_workers > 0, PgError::InvalidAmount);
    
    // Calculate total budget needed
    let total_budget = price_per_worker
        .checked_mul(max_workers)
        .ok_or(PgError::Overflow)?;
    
    // Verify job giver has enough balance
    let job_giver_balance = ctx.accounts.job_giver_token_account.amount;
    require!(
        job_giver_balance >= total_budget,
        PgError::InsufficientCredits
    );
    
    // Transfer funds from job giver to job budget account
    let cpi_accounts = anchor_spl::token::Transfer {
        from: ctx.accounts.job_giver_token_account.to_account_info(),
        to: ctx.accounts.job_budget_token_account.to_account_info(),
        authority: ctx.accounts.job_giver.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    anchor_spl::token::transfer(cpi_ctx, total_budget)?;
    
    // Initialize job posting
    let job = &mut ctx.accounts.job;
    let clock = Clock::get()?;
    
    job.job_giver = ctx.accounts.job_giver.key();
    job.agent_id = agent_id;
    job.job_id = job_id;
    job.price_per_worker = price_per_worker;
    job.price_per_worker_usd_cents = price_per_worker_usd_cents;
    job.total_budget = total_budget;
    job.budget_remaining = total_budget;
    job.max_workers = max_workers;
    job.workers_taken = 0;
    job.workers_completed = 0;
    job.status = JobStatus::Open;
    job.created_at = clock.unix_timestamp;
    job.expires_at = expires_at;
    job.bump = ctx.bumps.job;
    
    msg!("Job created: job_id={}, agent_id={}, price_per_worker={}, max_workers={}, total_budget={}", 
         job_id, agent_id, price_per_worker, max_workers, total_budget);
    
    emit!(JobCreated {
        job: job.key(),
        job_giver: job.job_giver,
        agent_id,
        job_id,
        price_per_worker,
        max_workers,
        total_budget,
        created_at: clock.unix_timestamp,
    });
    
    Ok(())
}

/// Take a job - Worker takes an available job
/// 
/// RATE LIMITING:
/// - Checks if max_workers has been reached
/// - Checks if budget_remaining is sufficient
/// - Prevents workers from taking jobs without payment guarantee
/// 
/// # Errors
/// - `PgError::InvalidAmount` if job is not open or max workers reached
/// - `PgError::InsufficientCredits` if budget is insufficient
pub fn take_job(
    ctx: Context<TakeJob>,
    assignment_id: u64,
) -> Result<()> {
    let job = &mut ctx.accounts.job;
    let clock = Clock::get()?;
    
    // Verify job is open
    require!(
        job.status == JobStatus::Open,
        PgError::InvalidAmount
    );
    
    // Check if job has expired
    if job.expires_at > 0 && clock.unix_timestamp >= job.expires_at {
        job.status = JobStatus::Closed;
        return Err(PgError::InvalidAmount.into());
    }
    
    // Check if max workers reached
    require!(
        job.workers_taken < job.max_workers,
        PgError::InvalidAmount
    );
    
    // Check if budget is sufficient
    require!(
        job.budget_remaining >= job.price_per_worker,
        PgError::InsufficientCredits
    );
    
    // Create worker assignment
    let assignment = &mut ctx.accounts.assignment;
    assignment.job = job.key();
    assignment.worker = ctx.accounts.worker.key();
    assignment.assignment_id = assignment_id;
    assignment.status = AssignmentStatus::Assigned;
    assignment.assigned_at = clock.unix_timestamp;
    assignment.completed_at = 0;
    assignment.payment_amount = job.price_per_worker;
    assignment.payment_made = false;
    assignment.bump = ctx.bumps.assignment;
    
    // Update job state
    job.workers_taken = job.workers_taken
        .checked_add(1)
        .ok_or(PgError::Overflow)?;
    
    // Reserve budget for this worker (don't deduct yet, deduct on completion)
    // We track budget_remaining to ensure we don't over-commit
    
    // If all workers are taken, close the job
    if job.workers_taken >= job.max_workers {
        job.status = JobStatus::Closed;
    }
    
    msg!("Job taken: job={}, worker={}, assignment_id={}, workers_taken={}/{}", 
         job.key(), ctx.accounts.worker.key(), assignment_id, job.workers_taken, job.max_workers);
    
    emit!(JobTaken {
        job: job.key(),
        worker: ctx.accounts.worker.key(),
        assignment: assignment.key(),
        assignment_id,
        workers_taken: job.workers_taken,
        max_workers: job.max_workers,
        assigned_at: clock.unix_timestamp,
    });
    
    Ok(())
}

/// Complete job - Worker completes the job and gets paid
/// 
/// PAYMENT LOGIC:
/// - Worker must have taken the job (assignment exists)
/// - Worker completes the work
/// - Payment is made from job budget to worker
/// - Budget is deducted from job budget_remaining
/// 
/// # Errors
/// - `PgError::InvalidAmount` if assignment is not in Assigned status
/// - `PgError::InsufficientCredits` if budget is insufficient
pub fn complete_job(
    ctx: Context<CompleteJob>,
) -> Result<()> {
    let job = &mut ctx.accounts.job;
    let assignment = &mut ctx.accounts.assignment;
    let clock = Clock::get()?;
    
    // Verify assignment is in Assigned status
    require!(
        assignment.status == AssignmentStatus::Assigned,
        PgError::InvalidAmount
    );
    
    // Verify job still has budget
    require!(
        job.budget_remaining >= assignment.payment_amount,
        PgError::InsufficientCredits
    );
    
    // Transfer payment from job budget to worker
    // Job PDA is the authority for the budget token account
    let job_giver_bytes = job.job_giver.as_ref();
    let job_id_bytes = job.job_id.to_le_bytes();
    let seeds: &[&[&[u8]]] = &[&[JOB_SEED, job_giver_bytes, &job_id_bytes, &[job.bump]]];
    let cpi_accounts = anchor_spl::token::Transfer {
        from: ctx.accounts.job_budget_token_account.to_account_info(),
        to: ctx.accounts.worker_token_account.to_account_info(),
        authority: job.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        seeds,
    );
    anchor_spl::token::transfer(cpi_ctx, assignment.payment_amount)?;
    
    // Update assignment
    assignment.status = AssignmentStatus::Paid;
    assignment.completed_at = clock.unix_timestamp;
    assignment.payment_made = true;
    
    // Update job state
    job.budget_remaining = job.budget_remaining
        .checked_sub(assignment.payment_amount)
        .ok_or(PgError::Overflow)?;
    
    job.workers_completed = job.workers_completed
        .checked_add(1)
        .ok_or(PgError::Overflow)?;
    
    // If budget is exhausted, close the job
    if job.budget_remaining < job.price_per_worker {
        job.status = JobStatus::Closed;
    }
    
    msg!("Job completed: job={}, worker={}, payment={}, budget_remaining={}", 
         job.key(), ctx.accounts.worker.key(), assignment.payment_amount, job.budget_remaining);
    
    emit!(JobCompleted {
        job: job.key(),
        worker: ctx.accounts.worker.key(),
        assignment: assignment.key(),
        payment_amount: assignment.payment_amount,
        budget_remaining: job.budget_remaining,
        workers_completed: job.workers_completed,
        completed_at: clock.unix_timestamp,
    });
    
    Ok(())
}

/// Cancel job - Job giver cancels the job
/// 
/// REFUND LOGIC:
/// - If workers haven't completed yet, they can't claim payment
/// - Remaining budget is refunded to job giver
/// - Completed workers keep their payment
/// 
/// # Errors
/// - `PgError::Unauthorized` if caller is not the job giver
pub fn cancel_job(
    ctx: Context<CancelJob>,
) -> Result<()> {
    let job = &mut ctx.accounts.job;
    
    // Verify caller is job giver
    require!(
        ctx.accounts.job_giver.key() == job.job_giver,
        PgError::Unauthorized
    );
    
    // Verify job is not already completed or cancelled
    require!(
        job.status == JobStatus::Open || job.status == JobStatus::Closed,
        PgError::InvalidAmount
    );
    
    // Refund remaining budget to job giver
    if job.budget_remaining > 0 {
        let job_giver_bytes = job.job_giver.as_ref();
        let job_id_bytes = job.job_id.to_le_bytes();
        let seeds: &[&[&[u8]]] = &[&[JOB_SEED, job_giver_bytes, &job_id_bytes, &[job.bump]]];
        let cpi_accounts = anchor_spl::token::Transfer {
            from: ctx.accounts.job_budget_token_account.to_account_info(),
            to: ctx.accounts.job_giver_token_account.to_account_info(),
            authority: job.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, job.budget_remaining)?;
    }
    
    // Update job status
    job.status = JobStatus::Cancelled;
    
    let refunded = job.budget_remaining;
    let clock = Clock::get()?;
    
    msg!("Job cancelled: job={}, refunded={}", job.key(), refunded);
    
    emit!(JobCancelled {
        job: job.key(),
        job_giver: job.job_giver,
        refund_amount: refunded,
        workers_taken: job.workers_taken,
        workers_completed: job.workers_completed,
        cancelled_at: clock.unix_timestamp,
    });
    
    Ok(())
}

// ======================================================================
// CONTEXTS
// ======================================================================

#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct CreateJobPosting<'info> {
    #[account(mut)]
    pub job_giver: Signer<'info>,
    
    /// CHECK: Agent registry (to verify agent exists)
    pub agent: Account<'info, AgentRegistry>,
    
    #[account(
        init,
        payer = job_giver,
        space = 8 + std::mem::size_of::<JobPosting>(),
        seeds = [JOB_SEED, job_giver.key().as_ref(), &job_id.to_le_bytes()],
        bump
    )]
    pub job: Account<'info, JobPosting>,
    
    /// CHECK: Job budget token account (holds funds for paying workers)
    /// Derived from job PDA as authority
    #[account(
        init,
        payer = job_giver,
        token::mint = mint,
        token::authority = job,
    )]
    pub job_budget_token_account: Account<'info, anchor_spl::token::TokenAccount>,
    
    #[account(mut)]
    pub job_giver_token_account: Account<'info, anchor_spl::token::TokenAccount>,
    
    /// CHECK: Token mint
    pub mint: AccountInfo<'info>,
    
    pub token_program: Program<'info, anchor_spl::token::Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(assignment_id: u64)]
pub struct TakeJob<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,
    
    #[account(
        mut,
        seeds = [JOB_SEED, job.job_giver.as_ref(), &job.job_id.to_le_bytes()],
        bump = job.bump
    )]
    pub job: Account<'info, JobPosting>,
    
    #[account(
        init,
        payer = worker,
        space = 8 + std::mem::size_of::<WorkerAssignment>(),
        seeds = [JOB_ASSIGNMENT_SEED, job.key().as_ref(), &assignment_id.to_le_bytes()],
        bump
    )]
    pub assignment: Account<'info, WorkerAssignment>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CompleteJob<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,
    
    #[account(
        mut,
        seeds = [JOB_SEED, job.job_giver.as_ref(), &job.job_id.to_le_bytes()],
        bump = job.bump
    )]
    pub job: Account<'info, JobPosting>,
    
    #[account(
        mut,
        seeds = [JOB_ASSIGNMENT_SEED, job.key().as_ref(), &assignment.assignment_id.to_le_bytes()],
        bump = assignment.bump,
        constraint = assignment.worker == worker.key() @ PgError::Unauthorized
    )]
    pub assignment: Account<'info, WorkerAssignment>,
    
    #[account(mut)]
    pub job_budget_token_account: Account<'info, anchor_spl::token::TokenAccount>,
    
    #[account(mut)]
    pub worker_token_account: Account<'info, anchor_spl::token::TokenAccount>,
    
    pub token_program: Program<'info, anchor_spl::token::Token>,
}

#[derive(Accounts)]
pub struct RegisterWorker<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + std::mem::size_of::<WorkerProfile>(),
        seeds = [WORKER_SEED, authority.key().as_ref()],
        bump
    )]
    pub worker_profile: Account<'info, WorkerProfile>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelJob<'info> {
    #[account(mut)]
    pub job_giver: Signer<'info>,
    
    #[account(
        mut,
        seeds = [JOB_SEED, job.job_giver.as_ref(), &job.job_id.to_le_bytes()],
        bump = job.bump,
        constraint = job.job_giver == job_giver.key() @ PgError::Unauthorized
    )]
    pub job: Account<'info, JobPosting>,
    
    #[account(mut)]
    pub job_budget_token_account: Account<'info, anchor_spl::token::TokenAccount>,
    
    #[account(mut)]
    pub job_giver_token_account: Account<'info, anchor_spl::token::TokenAccount>,
    
    pub token_program: Program<'info, anchor_spl::token::Token>,
}

