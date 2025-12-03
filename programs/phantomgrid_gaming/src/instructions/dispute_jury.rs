/**
 * ======================================================================
 * DECENTRALIZED DISPUTE JURY SYSTEM with SML LEARNING
 * ======================================================================
 * 
 * MECHANISM:
 * 1. Dispute raised → 10 random judges selected from DisputeAgent pool
 * 2. Case is ANONYMIZED (remove parties, keep facts)
 * 3. Judges vote within deadline
 * 4. 8/10 consensus → Auto-resolve
 * 5. Less than 8/10 → Escalate to admin
 * 6. SML learns from all verdicts
 * 
 * FEE DISTRIBUTION:
 * - 90% to judges (9% each)
 * - 10% to protocol (SML training fund)
 * 
 * PRIVACY:
 * - Claimant/Respondent identities are HIDDEN from judges
 * - Only job description, deliverables, and evidence shown
 * - Prevents bias and collusion
 */

use anchor_lang::prelude::*;
use crate::error::PgError;

// ======================================================================
// CONSTANTS
// ======================================================================

pub const DISPUTE_JURY_SEED: &[u8] = b"dispute_jury";
pub const JURY_CASE_SEED: &[u8] = b"jury_case";
pub const JURY_VOTE_SEED: &[u8] = b"jury_vote";
pub const SML_TRAINING_SEED: &[u8] = b"sml_training";
pub const DISPUTE_AGENT_SEED: &[u8] = b"dispute_agent";

/// Number of judges per case
pub const JURY_SIZE: u8 = 10;

/// Number of invitations sent per case (first 10 to accept get seats)
pub const INVITATIONS_PER_CASE: u8 = 100;

/// Minimum votes needed for auto-resolution (8/10)
pub const AUTO_RESOLVE_THRESHOLD: u8 = 8;

/// Voting time limit in seconds (30 minutes)
pub const VOTING_TIME_LIMIT_SECS: i64 = 30 * 60;

/// Speed bonus threshold - resolve within 15 mins = max speed bonus
pub const SPEED_BONUS_THRESHOLD_SECS: i64 = 15 * 60;

/// Max speed bonus points (added to accuracy score calculation)
pub const MAX_SPEED_BONUS_POINTS: u16 = 500; // 5% boost

/// Invitation expiry in seconds (5 minutes to claim seat)
pub const INVITATION_EXPIRY_SECS: i64 = 5 * 60;

/// BASE fee share for ALL judges (60% = 6000 bps)
/// Everyone gets this regardless of vote
pub const JUDGE_BASE_FEE_BPS: u16 = 6000;

/// BONUS fee share for MAJORITY judges only (30% = 3000 bps)
/// Split among judges who voted with consensus
pub const JUDGE_BONUS_FEE_BPS: u16 = 3000;

/// Protocol share (10% = 1000 bps)
pub const PROTOCOL_FEE_SHARE_BPS: u16 = 1000;

/// Minimum accuracy to remain active (30% = 3000 bps)
/// Below this, agent is auto-deactivated
pub const MIN_ACCURACY_TO_STAY_ACTIVE: u16 = 3000;

/// Voting deadline in seconds (72 hours)
pub const VOTING_DEADLINE_SECS: i64 = 72 * 3600;

/// Minimum stake to become a Dispute Agent (0.5 SOL)
pub const MIN_DISPUTE_AGENT_STAKE: u64 = 500_000_000;

// ======================================================================
// ACCOUNTS
// ======================================================================

/// Dispute Agent - Users who can be selected as judges
#[account]
pub struct DisputeAgent {
    /// Agent's wallet
    pub authority: Pubkey,
    
    /// Staked amount (minimum 0.5 SOL)
    pub staked_amount: u64,
    
    /// Is this agent active and eligible for selection?
    pub is_active: bool,
    
    /// Total cases judged
    pub total_cases_judged: u64,
    
    /// Cases where agent was in winning majority
    pub cases_in_majority: u64,
    
    /// Total fees earned from judging
    pub total_fees_earned: u64,
    
    /// Accuracy score (0-10000 = 0-100%)
    /// Based on how often judge is in majority
    pub accuracy_score: u16,
    
    /// Speed score (0-10000 = 0-100%)
    /// Based on how fast judge responds to invitations and votes
    pub speed_score: u16,
    
    /// Combined reputation score (accuracy * 0.7 + speed * 0.3)
    /// Used for weighted random selection
    pub reputation_score: u16,
    
    /// Average response time in seconds
    pub avg_response_time_secs: u32,
    
    /// Total invitations received
    pub invitations_received: u64,
    
    /// Invitations accepted (claimed seat)
    pub invitations_accepted: u64,
    
    /// Invitations missed/expired
    pub invitations_missed: u64,
    
    /// Expertise categories (bitmask)
    /// 0x01 = Technical, 0x02 = Design, 0x04 = Writing, etc.
    pub expertise_flags: u64,
    
    /// Last time this agent was selected for a case
    pub last_selected_at: i64,
    
    /// Cooldown: can't be selected again within X hours
    pub selection_cooldown_hours: u8,
    
    /// Registration timestamp
    pub registered_at: i64,
    
    /// Bump seed
    pub bump: u8,
}

/// Jury Invitation - Sent to 100 agents, first 10 to claim get seats
#[account]
pub struct JuryInvitation {
    /// Case this invitation is for
    pub case: Pubkey,
    
    /// Agent who received invitation
    pub agent: Pubkey,
    
    /// Invitation sent timestamp
    pub sent_at: i64,
    
    /// Expiry timestamp
    pub expires_at: i64,
    
    /// Status of invitation
    pub status: InvitationStatus,
    
    /// Seat claimed at (if accepted)
    pub claimed_at: i64,
    
    /// Response time in seconds (for speed rating)
    pub response_time_secs: u32,
    
    /// Bump seed
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum InvitationStatus {
    #[default]
    /// Waiting for response
    Pending,
    /// Agent claimed a seat
    Accepted,
    /// All seats filled, invitation auto-rejected
    SeatsFilled,
    /// Invitation expired
    Expired,
    /// Agent declined
    Declined,
}

/// Jury Case - An anonymized dispute case for jury review
#[account]
pub struct JuryCase {
    /// Unique case ID
    pub case_id: u64,
    
    /// Original dispute reference (hidden from judges)
    pub dispute_ref: Pubkey,
    
    /// Case status
    pub status: JuryCaseStatus,
    
    /// ======================================================================
    /// ANONYMIZED CASE DATA (visible to judges)
    /// ======================================================================
    
    /// Job category (e.g., "AI Development", "Content Writing")
    pub job_category: u16,
    
    /// IPFS hash of anonymized job description
    pub job_description_hash: [u8; 32],
    
    /// IPFS hash of anonymized deliverables/evidence from Party A
    pub party_a_evidence_hash: [u8; 32],
    
    /// IPFS hash of anonymized deliverables/evidence from Party B
    pub party_b_evidence_hash: [u8; 32],
    
    /// Dispute reason category
    pub dispute_category: DisputeCategory,
    
    /// Amount in dispute (in lamports)
    pub disputed_amount: u64,
    
    /// ======================================================================
    /// JURY SELECTION
    /// ======================================================================
    
    /// Selected jury members (10 judges)
    pub jury_members: [Pubkey; 10],
    
    /// How many judges have been assigned
    pub jury_count: u8,
    
    /// Random seed used for jury selection (for verification)
    pub selection_seed: [u8; 32],
    
    /// ======================================================================
    /// VOTING STATE
    /// ======================================================================
    
    /// Votes for Party A (claimant)
    pub votes_for_a: u8,
    
    /// Votes for Party B (respondent)
    pub votes_for_b: u8,
    
    /// Total votes cast
    pub votes_cast: u8,
    
    /// Voting deadline timestamp
    pub voting_deadline: i64,
    
    /// ======================================================================
    /// RESOLUTION
    /// ======================================================================
    
    /// Final verdict (if auto-resolved)
    pub verdict: JuryVerdict,
    
    /// Was this escalated to admin?
    pub escalated_to_admin: bool,
    
    /// Admin's decision (if escalated)
    pub admin_decision: JuryVerdict,
    
    /// Resolution timestamp
    pub resolved_at: i64,
    
    /// ======================================================================
    /// FEES (Consensus-Weighted Distribution)
    /// ======================================================================
    
    /// Total dispute fee collected
    pub total_fee: u64,
    
    /// BASE fee per judge (everyone gets this: total * 60% / 10)
    pub base_fee_per_judge: u64,
    
    /// BONUS pool for majority voters (total * 30%)
    pub bonus_pool: u64,
    
    /// Bonus per majority judge (bonus_pool / majority_count)
    pub bonus_per_majority_judge: u64,
    
    /// Protocol fee (total_fee * 10%)
    pub protocol_fee: u64,
    
    /// Number of judges in majority (for bonus calculation)
    pub majority_count: u8,
    
    /// Whether fees have been distributed
    pub fees_distributed: bool,
    
    /// ======================================================================
    /// SML TRAINING DATA
    /// ======================================================================
    
    /// Has this case been used for SML training?
    pub used_for_training: bool,
    
    /// SML prediction (before judges voted)
    pub sml_predicted_verdict: JuryVerdict,
    
    /// SML confidence (0-100)
    pub sml_confidence: u8,
    
    /// Case created timestamp
    pub created_at: i64,
    
    /// Invitation phase start
    pub invitations_sent_at: i64,
    
    /// Total invitations sent
    pub invitations_sent: u8,
    
    /// Voting started timestamp (when 10 seats filled)
    pub voting_started_at: i64,
    
    /// Voting deadline (30 mins from voting_started_at)
    pub voting_ends_at: i64,
    
    /// Bump seed
    pub bump: u8,
}

// ======================================================================
// EVENTS - For off-chain notification services
// ======================================================================

/// Emitted when jury invitations are sent
/// Off-chain services listen → push to mobile/web/browser
#[event]
pub struct JuryInvitationsSent {
    pub case_id: u64,
    pub case_pubkey: Pubkey,
    pub invitations_count: u8,
    pub invited_agents: Vec<Pubkey>,
    pub expires_at: i64,
    pub disputed_amount: u64,
    pub dispute_category: u8,
}

/// Emitted when a judge claims a seat
#[event]
pub struct JurySeatClaimed {
    pub case_id: u64,
    pub judge: Pubkey,
    pub seat_number: u8,
    pub seats_remaining: u8,
    pub response_time_secs: u32,
}

/// Emitted when all 10 seats filled - voting begins
#[event]
pub struct JuryVotingStarted {
    pub case_id: u64,
    pub case_pubkey: Pubkey,
    pub jury_members: [Pubkey; 10],
    pub voting_ends_at: i64,
    pub disputed_amount: u64,
}

/// Emitted when a vote is cast
#[event]
pub struct JuryVoteCast {
    pub case_id: u64,
    pub judge: Pubkey,
    pub votes_cast: u8,
    pub votes_remaining: u8,
}

/// Emitted when case is resolved
#[event]
pub struct JuryCaseResolved {
    pub case_id: u64,
    pub verdict: u8,
    pub votes_for_a: u8,
    pub votes_for_b: u8,
    pub auto_resolved: bool,
    pub total_fee: u64,
}

/// Emitted for push notification to specific agent
#[event]
pub struct AgentNotification {
    pub agent: Pubkey,
    pub notification_type: u8, // 1=invite, 2=reminder, 3=seat_filled, 4=vote_reminder
    pub case_id: u64,
    pub expires_at: i64,
    pub message_hash: [u8; 32], // IPFS hash of full notification content
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum JuryCaseStatus {
    #[default]
    /// Selecting jury members
    JurySelection,
    /// Jury is voting
    Voting,
    /// Resolved automatically (8/10 consensus)
    AutoResolved,
    /// Escalated to admin (< 8/10 consensus)
    EscalatedToAdmin,
    /// Resolved by admin
    AdminResolved,
    /// Cancelled
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum DisputeCategory {
    #[default]
    /// Work not delivered at all
    NonDelivery,
    /// Work quality below expectations
    QualityIssue,
    /// Work doesn't match job description
    NotAsDescribed,
    /// Late delivery beyond agreed deadline
    LateDelivery,
    /// Communication/responsiveness issues
    CommunicationIssue,
    /// Malicious or harmful content
    MaliciousContent,
    /// Payment dispute
    PaymentDispute,
    /// Other (explained in evidence)
    Other,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum JuryVerdict {
    #[default]
    /// No verdict yet
    Pending,
    /// Party A wins (full refund to claimant)
    PartyAWins,
    /// Party B wins (full payment to respondent)
    PartyBWins,
    /// Split 50/50
    Split,
    /// Partial for A (75% refund)
    PartialA,
    /// Partial for B (75% payment)
    PartialB,
}

/// Individual jury vote
#[account]
pub struct JuryVote {
    /// Case being voted on
    pub case: Pubkey,
    
    /// Judge casting the vote
    pub judge: Pubkey,
    
    /// Vote: true = Party A, false = Party B
    pub vote_for_party_a: bool,
    
    /// Confidence level (1-100)
    pub confidence: u8,
    
    /// IPFS hash of reasoning (anonymized)
    pub reasoning_hash: [u8; 32],
    
    /// Suggested verdict
    pub suggested_verdict: JuryVerdict,
    
    /// Timestamp of vote
    pub voted_at: i64,
    
    /// Was this judge in the majority?
    pub in_majority: bool,
    
    /// Fee earned (set after resolution)
    pub fee_earned: u64,
    
    /// Has judge claimed their fee?
    pub fee_claimed: bool,
    
    /// Bump seed
    pub bump: u8,
}

/// SML Training Record - Data for machine learning
#[account]
pub struct SmlTrainingRecord {
    /// Case reference
    pub case: Pubkey,
    
    /// ======================================================================
    /// FEATURE VECTOR (input to SML)
    /// ======================================================================
    
    /// Job category
    pub job_category: u16,
    
    /// Dispute category
    pub dispute_category: DisputeCategory,
    
    /// Disputed amount tier (0-4: micro, small, medium, large, enterprise)
    pub amount_tier: u8,
    
    /// Evidence quality score Party A (0-100)
    pub evidence_quality_a: u8,
    
    /// Evidence quality score Party B (0-100)
    pub evidence_quality_b: u8,
    
    /// Response time Party A (hours)
    pub response_time_a: u16,
    
    /// Response time Party B (hours)
    pub response_time_b: u16,
    
    /// Prior dispute history Party A (count)
    pub prior_disputes_a: u8,
    
    /// Prior dispute history Party B (count)
    pub prior_disputes_b: u8,
    
    /// ======================================================================
    /// JURY VOTING PATTERN
    /// ======================================================================
    
    /// Individual votes (10 votes, true = A, false = B)
    pub votes: [bool; 10],
    
    /// Confidence levels of each judge
    pub confidences: [u8; 10],
    
    /// ======================================================================
    /// OUTCOME (label for training)
    /// ======================================================================
    
    /// Final verdict
    pub final_verdict: JuryVerdict,
    
    /// Was auto-resolved or admin-resolved?
    pub auto_resolved: bool,
    
    /// Consensus strength (0-100, 80 = 8/10 agreed)
    pub consensus_strength: u8,
    
    /// Created timestamp
    pub created_at: i64,
    
    /// Bump seed
    pub bump: u8,
}

/// Dispute Agent Pool Stats
#[account]
pub struct DisputeAgentPool {
    /// Total registered agents
    pub total_agents: u64,
    
    /// Active agents (eligible for selection)
    pub active_agents: u64,
    
    /// Total staked amount across all agents
    pub total_staked: u64,
    
    /// Total cases processed
    pub total_cases: u64,
    
    /// Cases auto-resolved (8/10 consensus)
    pub auto_resolved_cases: u64,
    
    /// Cases escalated to admin
    pub escalated_cases: u64,
    
    /// Total fees distributed to judges
    pub total_judge_fees: u64,
    
    /// Total fees collected by protocol
    pub total_protocol_fees: u64,
    
    /// SML model version
    pub sml_model_version: u32,
    
    /// SML accuracy (0-10000)
    pub sml_accuracy: u16,
    
    /// Bump seed
    pub bump: u8,
}

// ======================================================================
// INSTRUCTIONS
// ======================================================================

/// Register as a Dispute Agent (requires staking)
pub fn register_dispute_agent(
    ctx: Context<RegisterDisputeAgent>,
    expertise_flags: u64,
    selection_cooldown_hours: u8,
) -> Result<()> {
    let agent = &mut ctx.accounts.dispute_agent;
    let clock = Clock::get()?;
    
    // Verify minimum stake
    let stake = ctx.accounts.stake_account.lamports();
    require!(
        stake >= MIN_DISPUTE_AGENT_STAKE,
        PgError::InsufficientCredits
    );
    
    agent.authority = ctx.accounts.authority.key();
    agent.staked_amount = stake;
    agent.is_active = true;
    agent.total_cases_judged = 0;
    agent.cases_in_majority = 0;
    agent.total_fees_earned = 0;
    agent.accuracy_score = 5000; // Start at 50%
    agent.speed_score = 5000; // Start at 50%
    agent.reputation_score = 5000; // Start at 50%
    agent.avg_response_time_secs = 0;
    agent.invitations_received = 0;
    agent.invitations_accepted = 0;
    agent.invitations_missed = 0;
    agent.expertise_flags = expertise_flags;
    agent.last_selected_at = 0;
    agent.selection_cooldown_hours = selection_cooldown_hours.max(6); // Min 6 hours
    agent.registered_at = clock.unix_timestamp;
    agent.bump = ctx.bumps.dispute_agent;
    
    // Update pool stats
    let pool = &mut ctx.accounts.pool;
    pool.total_agents += 1;
    pool.active_agents += 1;
    pool.total_staked += stake;
    
    msg!("Dispute Agent registered: authority={}, stake={}, expertise={}", 
         agent.authority, stake, expertise_flags);
    
    Ok(())
}

/// Create a jury case from a dispute (anonymized)
pub fn create_jury_case(
    ctx: Context<CreateJuryCase>,
    case_id: u64,
    job_category: u16,
    dispute_category: u8,
    disputed_amount: u64,
    dispute_fee: u64,
    job_description_hash: [u8; 32],
    party_a_evidence_hash: [u8; 32],
    party_b_evidence_hash: [u8; 32],
) -> Result<()> {
    let case = &mut ctx.accounts.jury_case;
    let clock = Clock::get()?;
    
    // Minimum dispute fee: 0.1 SOL
    require!(dispute_fee >= 100_000_000, PgError::InvalidAmount);
    
    case.case_id = case_id;
    case.dispute_ref = ctx.accounts.dispute.key();
    case.status = JuryCaseStatus::JurySelection;
    
    // Anonymized case data
    case.job_category = job_category;
    case.job_description_hash = job_description_hash;
    case.party_a_evidence_hash = party_a_evidence_hash;
    case.party_b_evidence_hash = party_b_evidence_hash;
    case.dispute_category = match dispute_category {
        0 => DisputeCategory::NonDelivery,
        1 => DisputeCategory::QualityIssue,
        2 => DisputeCategory::NotAsDescribed,
        3 => DisputeCategory::LateDelivery,
        4 => DisputeCategory::CommunicationIssue,
        5 => DisputeCategory::MaliciousContent,
        6 => DisputeCategory::PaymentDispute,
        _ => DisputeCategory::Other,
    };
    case.disputed_amount = disputed_amount;
    
    // Initialize jury selection
    case.jury_members = [Pubkey::default(); 10];
    case.jury_count = 0;
    
    // Generate random seed for jury selection
    // In production, use VRF (Switchboard/Chainlink VRF)
    let slot = clock.slot;
    let timestamp = clock.unix_timestamp;
    let mut seed_input = [0u8; 40];
    seed_input[..8].copy_from_slice(&slot.to_le_bytes());
    seed_input[8..16].copy_from_slice(&timestamp.to_le_bytes());
    seed_input[16..48].copy_from_slice(ctx.accounts.dispute.key().as_ref());
    // Simple hash for seed (in production use VRF)
    case.selection_seed = seed_input[..32].try_into().unwrap();
    
    // Initialize voting
    case.votes_for_a = 0;
    case.votes_for_b = 0;
    case.votes_cast = 0;
    case.voting_deadline = clock.unix_timestamp + VOTING_DEADLINE_SECS;
    
    // Initialize resolution
    case.verdict = JuryVerdict::Pending;
    case.escalated_to_admin = false;
    case.admin_decision = JuryVerdict::Pending;
    case.resolved_at = 0;
    
    // Calculate fees (consensus-weighted distribution)
    case.total_fee = dispute_fee;
    
    // Base fee: 60% split among all 10 judges
    let base_total = dispute_fee * u64::from(JUDGE_BASE_FEE_BPS) / 10000;
    case.base_fee_per_judge = base_total / 10;
    
    // Bonus pool: 30% for majority voters (calculated after voting)
    case.bonus_pool = dispute_fee * u64::from(JUDGE_BONUS_FEE_BPS) / 10000;
    case.bonus_per_majority_judge = 0; // Set after resolution
    
    // Protocol: 10%
    case.protocol_fee = dispute_fee * u64::from(PROTOCOL_FEE_SHARE_BPS) / 10000;
    
    case.majority_count = 0; // Set after resolution
    case.fees_distributed = false;
    
    // SML fields
    case.used_for_training = false;
    case.sml_predicted_verdict = JuryVerdict::Pending;
    case.sml_confidence = 0;
    
    case.created_at = clock.unix_timestamp;
    case.invitations_sent_at = 0;
    case.invitations_sent = 0;
    case.voting_started_at = 0;
    case.voting_ends_at = 0;
    case.bump = ctx.bumps.jury_case;
    
    msg!("Jury case created: case_id={}, category={:?}, amount={}, fee={}", 
         case_id, case.dispute_category, disputed_amount, dispute_fee);
    
    Ok(())
}

/// ==========================================================================
/// INVITATION-BASED JURY SELECTION (First-Come-First-Served with Atomic Claiming)
/// ==========================================================================
/// 
/// FLOW:
/// 1. send_jury_invitations() → Sends 100 invites (weighted random by reputation)
/// 2. Off-chain: Mobile/Web/Browser push notifications sent
/// 3. claim_jury_seat() → First 10 to call this get seats (ATOMIC - no race condition)
/// 4. After 10 seats filled → Voting begins (30 min timer)
/// 5. Remaining invitations marked as SeatsFilled
/// 
/// ANTI-RACE CONDITION:
/// - JuryCase.jury_count is incremented ATOMICALLY in each claim transaction
/// - Only one tx can modify JuryCase per Solana slot
/// - If jury_count >= 10 when you claim, you're rejected (seats full)
/// 
/// REPUTATION WEIGHTING:
/// - Higher reputation = higher chance of being invited (not guaranteed seat)
/// - But seat is still first-come-first-served among invitees

/// Send invitations to 100 agents (weighted random by reputation)
pub fn send_jury_invitations(
    ctx: Context<SendJuryInvitations>,
    invited_agents: Vec<Pubkey>,
) -> Result<()> {
    let case = &mut ctx.accounts.jury_case;
    let clock = Clock::get()?;
    
    require!(
        case.status == JuryCaseStatus::JurySelection,
        PgError::InvalidAmount
    );
    require!(case.jury_count == 0, PgError::InvalidAmount); // No seats claimed yet
    require!(
        invited_agents.len() >= JURY_SIZE as usize,
        PgError::InvalidAmount
    );
    require!(
        invited_agents.len() <= INVITATIONS_PER_CASE as usize,
        PgError::InvalidAmount
    );
    
    // Record invitation metadata
    case.invitations_sent_at = clock.unix_timestamp;
    case.invitations_sent = invited_agents.len() as u8;
    
    // Emit event for off-chain notification services
    // They will push to: Mobile App, Web Push, Browser Plugin, Website Dashboard
    emit!(JuryInvitationsSent {
        case_id: case.case_id,
        case_pubkey: case.key(),
        invitations_count: invited_agents.len() as u8,
        invited_agents: invited_agents.clone(),
        expires_at: clock.unix_timestamp + INVITATION_EXPIRY_SECS,
        disputed_amount: case.disputed_amount,
        dispute_category: case.dispute_category as u8,
    });
    
    // Emit individual notifications for each agent
    let notification_hash = case.job_description_hash; // Simplified
    for agent in invited_agents.iter() {
        emit!(AgentNotification {
            agent: *agent,
            notification_type: 1, // 1 = new invitation
            case_id: case.case_id,
            expires_at: clock.unix_timestamp + INVITATION_EXPIRY_SECS,
            message_hash: notification_hash,
        });
    }
    
    msg!("Jury invitations sent: case_id={}, count={}, expires_in={}s", 
         case.case_id, invited_agents.len(), INVITATION_EXPIRY_SECS);
    
    Ok(())
}

/// Claim a jury seat - ATOMIC FIRST-COME-FIRST-SERVED
/// 
/// CRITICAL: This function is ATOMIC. Only one transaction per Solana slot
/// can modify the JuryCase account. This prevents race conditions where
/// 50 people accept simultaneously.
/// 
/// If jury_count >= 10 when your transaction executes, you're rejected.
pub fn claim_jury_seat(
    ctx: Context<ClaimJurySeat>,
) -> Result<()> {
    let case = &mut ctx.accounts.jury_case;
    let agent = &mut ctx.accounts.dispute_agent;
    let invitation = &mut ctx.accounts.jury_invitation;
    let clock = Clock::get()?;
    
    // === CHECK 1: Case is still in selection phase ===
    require!(
        case.status == JuryCaseStatus::JurySelection,
        PgError::InvalidAmount
    );
    
    // === CHECK 2: ATOMIC SEAT AVAILABILITY ===
    // This is the critical race-condition prevention
    // Only proceeds if seats available AT THIS EXACT MOMENT
    require!(
        case.jury_count < JURY_SIZE,
        PgError::InvalidAmount // Error: All seats filled
    );
    
    // === CHECK 3: Invitation is valid ===
    require!(
        invitation.status == InvitationStatus::Pending,
        PgError::InvalidAmount
    );
    require!(
        invitation.agent == agent.authority,
        PgError::Unauthorized
    );
    require!(
        invitation.case == case.key(),
        PgError::InvalidAmount
    );
    
    // === CHECK 4: Invitation not expired ===
    require!(
        clock.unix_timestamp <= invitation.expires_at,
        PgError::InvalidAmount // Error: Invitation expired
    );
    
    // === CHECK 5: Agent is active ===
    require!(agent.is_active, PgError::Unauthorized);
    
    // === CHECK 6: Agent not already on jury ===
    for i in 0..case.jury_count as usize {
        require!(
            case.jury_members[i] != agent.authority,
            PgError::InvalidAmount
        );
    }
    
    // === ATOMIC SEAT CLAIM ===
    let seat_number = case.jury_count;
    case.jury_members[seat_number as usize] = agent.authority;
    case.jury_count += 1; // ATOMIC INCREMENT
    
    // Calculate response time (for speed rating)
    let response_time = (clock.unix_timestamp - case.invitations_sent_at) as u32;
    
    // Update invitation
    invitation.status = InvitationStatus::Accepted;
    invitation.claimed_at = clock.unix_timestamp;
    invitation.response_time_secs = response_time;
    
    // Update agent stats
    agent.last_selected_at = clock.unix_timestamp;
    agent.invitations_accepted += 1;
    
    // Update agent's average response time
    let total_responses = agent.invitations_accepted;
    if total_responses > 1 {
        agent.avg_response_time_secs = 
            ((agent.avg_response_time_secs as u64 * (total_responses - 1) + response_time as u64) 
             / total_responses) as u32;
    } else {
        agent.avg_response_time_secs = response_time;
    }
    
    // Update speed score (faster = higher score)
    // Max score if response < 30 seconds, decreases linearly
    let max_response_for_full_score = 30u32; // 30 seconds
    let min_score_response = 300u32; // 5 minutes
    if response_time <= max_response_for_full_score {
        agent.speed_score = 10000; // Perfect score
    } else if response_time >= min_score_response {
        agent.speed_score = agent.speed_score.saturating_sub(100); // Penalty
    } else {
        // Linear interpolation
        let range = min_score_response - max_response_for_full_score;
        let elapsed = response_time - max_response_for_full_score;
        let penalty = (elapsed as u64 * 5000 / range as u64) as u16;
        agent.speed_score = 10000u16.saturating_sub(penalty);
    }
    
    // Recalculate reputation (70% accuracy + 30% speed)
    agent.reputation_score = 
        (agent.accuracy_score as u32 * 70 / 100 + agent.speed_score as u32 * 30 / 100) as u16;
    
    let seats_remaining = JURY_SIZE - case.jury_count;
    
    // Emit event
    emit!(JurySeatClaimed {
        case_id: case.case_id,
        judge: agent.authority,
        seat_number,
        seats_remaining,
        response_time_secs: response_time,
    });
    
    msg!("🎫 SEAT CLAIMED: case={}, judge={}, seat={}/10, response_time={}s, seats_left={}", 
         case.case_id, agent.authority, seat_number + 1, response_time, seats_remaining);
    
    // === IF JURY COMPLETE, START VOTING ===
    if case.jury_count >= JURY_SIZE {
        case.status = JuryCaseStatus::Voting;
        case.voting_started_at = clock.unix_timestamp;
        case.voting_ends_at = clock.unix_timestamp + VOTING_TIME_LIMIT_SECS; // 30 minutes
        
        emit!(JuryVotingStarted {
            case_id: case.case_id,
            case_pubkey: case.key(),
            jury_members: case.jury_members,
            voting_ends_at: case.voting_ends_at,
            disputed_amount: case.disputed_amount,
        });
        
        msg!("🚀 JURY COMPLETE! Voting started for case {}, deadline in 30 mins", case.case_id);
    }
    
    Ok(())
}

/// Mark invitation as expired/seats-filled (cleanup)
pub fn expire_invitation(
    ctx: Context<ExpireInvitation>,
) -> Result<()> {
    let case = &ctx.accounts.jury_case;
    let invitation = &mut ctx.accounts.jury_invitation;
    let agent = &mut ctx.accounts.dispute_agent;
    let clock = Clock::get()?;
    
    require!(
        invitation.status == InvitationStatus::Pending,
        PgError::InvalidAmount
    );
    
    if case.jury_count >= JURY_SIZE {
        // All seats filled
        invitation.status = InvitationStatus::SeatsFilled;
        msg!("Invitation marked as seats-filled: agent={}", invitation.agent);
    } else if clock.unix_timestamp > invitation.expires_at {
        // Expired
        invitation.status = InvitationStatus::Expired;
        agent.invitations_missed += 1;
        
        // Penalize speed score for missing invitation
        agent.speed_score = agent.speed_score.saturating_sub(200);
        agent.reputation_score = 
            (agent.accuracy_score as u32 * 70 / 100 + agent.speed_score as u32 * 30 / 100) as u16;
        
        msg!("Invitation expired: agent={}, speed_penalty=-200", invitation.agent);
    } else {
        return Err(PgError::InvalidAmount.into());
    }
    
    Ok(())
}

/// Legacy: Direct jury selection (for backward compatibility)
/// In new system, use send_jury_invitations + claim_jury_seat
pub fn select_jury_member(
    ctx: Context<SelectJuryMember>,
) -> Result<()> {
    let case = &mut ctx.accounts.jury_case;
    let agent = &mut ctx.accounts.dispute_agent;
    let clock = Clock::get()?;
    
    require!(
        case.status == JuryCaseStatus::JurySelection,
        PgError::InvalidAmount
    );
    require!(case.jury_count < JURY_SIZE, PgError::InvalidAmount);
    require!(agent.is_active, PgError::Unauthorized);
    
    // Check cooldown
    let cooldown_secs = i64::from(agent.selection_cooldown_hours) * 3600;
    require!(
        clock.unix_timestamp >= agent.last_selected_at + cooldown_secs,
        PgError::InvalidAmount
    );
    
    // Verify agent is not already on this jury
    for i in 0..case.jury_count as usize {
        require!(
            case.jury_members[i] != agent.authority,
            PgError::InvalidAmount
        );
    }
    
    // Add to jury
    let idx = case.jury_count as usize;
    case.jury_members[idx] = agent.authority;
    case.jury_count += 1;
    
    // Update agent
    agent.last_selected_at = clock.unix_timestamp;
    
    // If jury is complete, start voting
    if case.jury_count >= JURY_SIZE {
        case.status = JuryCaseStatus::Voting;
        case.voting_started_at = clock.unix_timestamp;
        case.voting_ends_at = clock.unix_timestamp + VOTING_TIME_LIMIT_SECS;
        msg!("Jury complete! Voting period started for case {}", case.case_id);
    }
    
    msg!("Jury member selected: case={}, judge={}, count={}/10", 
         case.case_id, agent.authority, case.jury_count);
    
    Ok(())
}

/// Cast a vote on a jury case
pub fn cast_jury_vote(
    ctx: Context<CastJuryVote>,
    vote_for_party_a: bool,
    confidence: u8,
    reasoning_hash: [u8; 32],
    suggested_verdict: u8,
) -> Result<()> {
    let case = &mut ctx.accounts.jury_case;
    let vote = &mut ctx.accounts.jury_vote;
    let clock = Clock::get()?;
    
    require!(
        case.status == JuryCaseStatus::Voting,
        PgError::InvalidAmount
    );
    require!(
        clock.unix_timestamp <= case.voting_deadline,
        PgError::InvalidAmount
    );
    
    // Verify judge is on the jury
    let judge = ctx.accounts.judge.key();
    let mut is_jury_member = false;
    for i in 0..case.jury_count as usize {
        if case.jury_members[i] == judge {
            is_jury_member = true;
            break;
        }
    }
    require!(is_jury_member, PgError::Unauthorized);
    
    // Record vote
    vote.case = case.key();
    vote.judge = judge;
    vote.vote_for_party_a = vote_for_party_a;
    vote.confidence = confidence.min(100);
    vote.reasoning_hash = reasoning_hash;
    vote.suggested_verdict = match suggested_verdict {
        1 => JuryVerdict::PartyAWins,
        2 => JuryVerdict::PartyBWins,
        3 => JuryVerdict::Split,
        4 => JuryVerdict::PartialA,
        5 => JuryVerdict::PartialB,
        _ => JuryVerdict::Pending,
    };
    vote.voted_at = clock.unix_timestamp;
    vote.in_majority = false; // Set after resolution
    vote.fee_earned = 0; // Set after resolution
    vote.fee_claimed = false;
    vote.bump = ctx.bumps.jury_vote;
    
    // Update case vote counts
    if vote_for_party_a {
        case.votes_for_a += 1;
    } else {
        case.votes_for_b += 1;
    }
    case.votes_cast += 1;
    
    msg!("Vote cast: case={}, judge={}, for_a={}, votes={}/{}", 
         case.case_id, judge, vote_for_party_a, case.votes_cast, JURY_SIZE);
    
    // Check if we can auto-resolve
    if case.votes_cast >= JURY_SIZE {
        check_and_resolve_case(case)?;
    }
    
    Ok(())
}

/// Check if case can be auto-resolved or needs escalation
fn check_and_resolve_case(case: &mut JuryCase) -> Result<()> {
    let max_votes = case.votes_for_a.max(case.votes_for_b);
    
    // Calculate majority count for bonus distribution
    case.majority_count = max_votes;
    
    // Calculate bonus per majority judge
    if case.majority_count > 0 {
        case.bonus_per_majority_judge = case.bonus_pool / u64::from(case.majority_count);
    }
    
    if max_votes >= AUTO_RESOLVE_THRESHOLD {
        // 8/10 or better - AUTO RESOLVE
        case.status = JuryCaseStatus::AutoResolved;
        case.verdict = if case.votes_for_a >= AUTO_RESOLVE_THRESHOLD {
            JuryVerdict::PartyAWins
        } else {
            JuryVerdict::PartyBWins
        };
        case.resolved_at = Clock::get()?.unix_timestamp;
        
        msg!("Case AUTO-RESOLVED: case_id={}, verdict={:?}, majority={}/10, bonus_per_judge={}", 
             case.case_id, case.verdict, max_votes, case.bonus_per_majority_judge);
    } else {
        // Less than 8/10 - ESCALATE TO ADMIN
        case.status = JuryCaseStatus::EscalatedToAdmin;
        case.escalated_to_admin = true;
        
        msg!("Case ESCALATED to admin: case_id={}, votes=A:{}/B:{}", 
             case.case_id, case.votes_for_a, case.votes_for_b);
    }
    
    Ok(())
}

/// Admin resolves an escalated case
pub fn admin_resolve_case(
    ctx: Context<AdminResolveCase>,
    verdict: u8,
) -> Result<()> {
    let case = &mut ctx.accounts.jury_case;
    let clock = Clock::get()?;
    
    require!(
        case.status == JuryCaseStatus::EscalatedToAdmin,
        PgError::InvalidAmount
    );
    
    case.admin_decision = match verdict {
        1 => JuryVerdict::PartyAWins,
        2 => JuryVerdict::PartyBWins,
        3 => JuryVerdict::Split,
        4 => JuryVerdict::PartialA,
        5 => JuryVerdict::PartialB,
        _ => return Err(PgError::InvalidAmount.into()),
    };
    case.verdict = case.admin_decision;
    case.status = JuryCaseStatus::AdminResolved;
    case.resolved_at = clock.unix_timestamp;
    
    msg!("Case ADMIN-RESOLVED: case_id={}, verdict={:?}", 
         case.case_id, case.verdict);
    
    Ok(())
}

/// Distribute fees to judges after resolution
/// 
/// FEE STRUCTURE:
/// - BASE (60%): Everyone gets this regardless of vote
/// - BONUS (30%): Only majority voters get this
/// - PROTOCOL (10%): Goes to protocol/SML fund
/// 
/// This incentivizes honest voting and penalizes trolls
pub fn distribute_jury_fees(
    ctx: Context<DistributeJuryFees>,
) -> Result<()> {
    let case = &mut ctx.accounts.jury_case;
    let vote = &mut ctx.accounts.jury_vote;
    let agent = &mut ctx.accounts.dispute_agent;
    let pool = &mut ctx.accounts.pool;
    
    require!(
        case.status == JuryCaseStatus::AutoResolved || 
        case.status == JuryCaseStatus::AdminResolved,
        PgError::InvalidAmount
    );
    require!(vote.judge == agent.authority, PgError::Unauthorized);
    require!(!vote.fee_claimed, PgError::InvalidAmount);
    
    // Determine if judge was in majority
    let majority_for_a = case.votes_for_a > case.votes_for_b;
    vote.in_majority = vote.vote_for_party_a == majority_for_a;
    
    // Calculate fee based on consensus
    // BASE: Everyone gets base_fee_per_judge (60% / 10 = 6%)
    // BONUS: Only majority gets bonus_per_majority_judge (30% / majority_count)
    let base_fee = case.base_fee_per_judge;
    let bonus_fee = if vote.in_majority {
        case.bonus_per_majority_judge
    } else {
        0
    };
    
    vote.fee_earned = base_fee + bonus_fee;
    vote.fee_claimed = true;
    
    // Update agent stats
    agent.total_cases_judged += 1;
    if vote.in_majority {
        agent.cases_in_majority += 1;
    }
    agent.total_fees_earned += vote.fee_earned;
    
    // Update accuracy score
    if agent.total_cases_judged > 0 {
        agent.accuracy_score = ((agent.cases_in_majority * 10000) / agent.total_cases_judged) as u16;
    }
    
    // AUTO-DEACTIVATE trolls with very low accuracy (below 30%)
    if agent.total_cases_judged >= 10 && agent.accuracy_score < MIN_ACCURACY_TO_STAY_ACTIVE {
        agent.is_active = false;
        pool.active_agents = pool.active_agents.saturating_sub(1);
        msg!("⚠️ Judge AUTO-DEACTIVATED due to low accuracy: judge={}, accuracy={}%", 
             agent.authority, agent.accuracy_score / 100);
    }
    
    // Update pool stats
    pool.total_judge_fees += vote.fee_earned;
    
    // Transfer fee to judge
    // (In production: actual SOL/token transfer here)
    
    msg!("Jury fee distributed: judge={}, base={}, bonus={}, total={}, in_majority={}, accuracy={}%", 
         agent.authority, base_fee, bonus_fee, vote.fee_earned, vote.in_majority, agent.accuracy_score / 100);
    
    Ok(())
}

/// Record case for SML training
pub fn record_sml_training_data(
    ctx: Context<RecordSmlTraining>,
    evidence_quality_a: u8,
    evidence_quality_b: u8,
    response_time_a: u16,
    response_time_b: u16,
    prior_disputes_a: u8,
    prior_disputes_b: u8,
) -> Result<()> {
    let case = &ctx.accounts.jury_case;
    let record = &mut ctx.accounts.sml_record;
    let clock = Clock::get()?;
    
    require!(
        case.status == JuryCaseStatus::AutoResolved || 
        case.status == JuryCaseStatus::AdminResolved,
        PgError::InvalidAmount
    );
    
    record.case = case.key();
    record.job_category = case.job_category;
    record.dispute_category = case.dispute_category;
    
    // Amount tier (0=micro <0.1, 1=small <1, 2=med <10, 3=large <100, 4=enterprise)
    record.amount_tier = if case.disputed_amount < 100_000_000 { 0 }
        else if case.disputed_amount < 1_000_000_000 { 1 }
        else if case.disputed_amount < 10_000_000_000 { 2 }
        else if case.disputed_amount < 100_000_000_000 { 3 }
        else { 4 };
    
    record.evidence_quality_a = evidence_quality_a;
    record.evidence_quality_b = evidence_quality_b;
    record.response_time_a = response_time_a;
    record.response_time_b = response_time_b;
    record.prior_disputes_a = prior_disputes_a;
    record.prior_disputes_b = prior_disputes_b;
    
    // TODO: Load actual votes from vote accounts
    // For now, derive from case vote counts
    record.votes = [false; 10]; // Would be populated from JuryVote accounts
    record.confidences = [50; 10]; // Would be populated from JuryVote accounts
    
    record.final_verdict = case.verdict;
    record.auto_resolved = case.status == JuryCaseStatus::AutoResolved;
    record.consensus_strength = (case.votes_for_a.max(case.votes_for_b) * 10) as u8;
    record.created_at = clock.unix_timestamp;
    record.bump = ctx.bumps.sml_record;
    
    msg!("SML training data recorded: case={}, verdict={:?}, auto={}", 
         case.case_id, record.final_verdict, record.auto_resolved);
    
    Ok(())
}

// ======================================================================
// CONTEXTS
// ======================================================================

#[derive(Accounts)]
pub struct RegisterDisputeAgent<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// CHECK: Stake account (must have MIN_DISPUTE_AGENT_STAKE lamports)
    #[account(mut)]
    pub stake_account: AccountInfo<'info>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<DisputeAgent>(),
        seeds = [DISPUTE_AGENT_SEED, authority.key().as_ref()],
        bump
    )]
    pub dispute_agent: Account<'info, DisputeAgent>,
    
    #[account(mut)]
    pub pool: Account<'info, DisputeAgentPool>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(case_id: u64)]
pub struct CreateJuryCase<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    
    /// CHECK: Original dispute reference
    pub dispute: AccountInfo<'info>,
    
    #[account(
        init,
        payer = creator,
        space = 8 + std::mem::size_of::<JuryCase>(),
        seeds = [JURY_CASE_SEED, &case_id.to_le_bytes()],
        bump
    )]
    pub jury_case: Account<'info, JuryCase>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SelectJuryMember<'info> {
    #[account(mut)]
    pub selector: Signer<'info>,
    
    #[account(mut)]
    pub jury_case: Account<'info, JuryCase>,
    
    #[account(mut)]
    pub dispute_agent: Account<'info, DisputeAgent>,
}

#[derive(Accounts)]
pub struct CastJuryVote<'info> {
    #[account(mut)]
    pub judge: Signer<'info>,
    
    #[account(mut)]
    pub jury_case: Account<'info, JuryCase>,
    
    #[account(
        init,
        payer = judge,
        space = 8 + std::mem::size_of::<JuryVote>(),
        seeds = [JURY_VOTE_SEED, jury_case.key().as_ref(), judge.key().as_ref()],
        bump
    )]
    pub jury_vote: Account<'info, JuryVote>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminResolveCase<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(mut)]
    pub jury_case: Account<'info, JuryCase>,
    
    /// CHECK: GlobalConfig to verify admin
    pub config: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct DistributeJuryFees<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub jury_case: Account<'info, JuryCase>,
    
    #[account(mut)]
    pub jury_vote: Account<'info, JuryVote>,
    
    #[account(mut)]
    pub dispute_agent: Account<'info, DisputeAgent>,
    
    #[account(mut)]
    pub pool: Account<'info, DisputeAgentPool>,
}

#[derive(Accounts)]
pub struct RecordSmlTraining<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub jury_case: Account<'info, JuryCase>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<SmlTrainingRecord>(),
        seeds = [SML_TRAINING_SEED, jury_case.key().as_ref()],
        bump
    )]
    pub sml_record: Account<'info, SmlTrainingRecord>,
    
    pub system_program: Program<'info, System>,
}

// ======================================================================
// INVITATION-BASED JURY SELECTION CONTEXTS
// ======================================================================

pub const JURY_INVITATION_SEED: &[u8] = b"jury_invitation";

#[derive(Accounts)]
pub struct SendJuryInvitations<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub jury_case: Account<'info, JuryCase>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimJurySeat<'info> {
    /// The agent claiming the seat (must sign)
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// The jury case (MUTEX - atomic updates prevent race conditions)
    #[account(mut)]
    pub jury_case: Account<'info, JuryCase>,
    
    /// The agent's profile
    #[account(
        mut,
        constraint = dispute_agent.authority == authority.key() @ PgError::Unauthorized
    )]
    pub dispute_agent: Account<'info, DisputeAgent>,
    
    /// The invitation for this agent
    #[account(
        mut,
        constraint = jury_invitation.agent == authority.key() @ PgError::Unauthorized,
        constraint = jury_invitation.case == jury_case.key() @ PgError::InvalidAmount
    )]
    pub jury_invitation: Account<'info, JuryInvitation>,
}

#[derive(Accounts)]
pub struct CreateJuryInvitation<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub jury_case: Account<'info, JuryCase>,
    
    /// CHECK: Agent being invited
    pub invited_agent: AccountInfo<'info>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<JuryInvitation>(),
        seeds = [JURY_INVITATION_SEED, jury_case.key().as_ref(), invited_agent.key().as_ref()],
        bump
    )]
    pub jury_invitation: Account<'info, JuryInvitation>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExpireInvitation<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub jury_case: Account<'info, JuryCase>,
    
    #[account(mut)]
    pub jury_invitation: Account<'info, JuryInvitation>,
    
    #[account(
        mut,
        constraint = dispute_agent.authority == jury_invitation.agent @ PgError::Unauthorized
    )]
    pub dispute_agent: Account<'info, DisputeAgent>,
}

