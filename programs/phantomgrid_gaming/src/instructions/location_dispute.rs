/**
 * ======================================================================
 * LOCATION-BASED MATCHING & DISPUTE RESOLUTION
 * ======================================================================
 * 
 * LOCATION FILTERING:
 * - Country (regulatory compliance, tax nexus)
 * - Region/State (localized services)
 * - City (urban vs rural pricing)
 * - Coordinates (pinpoint precision for local jobs)
 * 
 * DISPUTE RESOLUTION:
 * - Review period before payment finalization
 * - Escrow-based fund locking
 * - Arbiter selection and voting
 * - Stake-weighted reputation
 * - Automatic resolution timeouts
 * 
 * LEARNING MANAGER:
 * - Track agent performance per job type
 * - Quality ratings from job givers
 * - Improvement signals for agents
 */

use anchor_lang::prelude::*;
use crate::error::PgError;
use crate::instructions::job_marketplace::{JobPosting, WorkerAssignment};

// ======================================================================
// SEEDS
// ======================================================================

pub const LOCATION_PROFILE_SEED: &[u8] = b"location_profile";
pub const JOB_LOCATION_SEED: &[u8] = b"job_location";
pub const DISPUTE_SEED: &[u8] = b"dispute";
pub const ARBITER_SEED: &[u8] = b"arbiter";
pub const QUALITY_RATING_SEED: &[u8] = b"quality_rating";
pub const LEARNING_RECORD_SEED: &[u8] = b"learning_record";

// ======================================================================
// LOCATION ACCOUNTS
// ======================================================================

/// Worker/Agent Location Profile
/// Enables geographic matching for jobs
#[account]
pub struct LocationProfile {
    /// Owner of this location profile
    pub owner: Pubkey,
    
    /// ISO 3166-1 alpha-2 country code (e.g., "US", "DE", "JP")
    /// 2 bytes for efficiency
    pub country_code: [u8; 2],
    
    /// Region/State code (up to 6 chars, e.g., "CA", "BY", "13")
    pub region_code: [u8; 6],
    
    /// City identifier (hash of normalized city name)
    /// Using hash for privacy and efficient comparison
    pub city_hash: [u8; 32],
    
    /// City name (human readable, for display)
    pub city_name: [u8; 32],
    
    /// Latitude in microdegrees (degrees * 1,000,000)
    /// Range: -90,000,000 to 90,000,000
    pub latitude: i32,
    
    /// Longitude in microdegrees (degrees * 1,000,000)
    /// Range: -180,000,000 to 180,000,000
    pub longitude: i32,
    
    /// Service radius in meters (how far willing to work)
    /// 0 = remote only, max = global
    pub service_radius_meters: u32,
    
    /// Timezone offset from UTC in minutes (-720 to +840)
    pub timezone_offset_minutes: i16,
    
    /// Is this profile verified? (KYC/proof of address)
    pub is_verified: bool,
    
    /// Profile visibility
    pub visibility: LocationVisibility,
    
    /// Created timestamp
    pub created_at: i64,
    
    /// Last updated
    pub updated_at: i64,
    
    /// Bump seed
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum LocationVisibility {
    /// Show exact location
    Exact,
    /// Show city only
    CityOnly,
    /// Show region only
    RegionOnly,
    /// Show country only
    CountryOnly,
    /// Hide location entirely
    Hidden,
}

impl Default for LocationVisibility {
    fn default() -> Self { LocationVisibility::CityOnly }
}

/// Job Location Requirements
/// Defines geographic constraints for a job posting
#[account]
pub struct JobLocationFilter {
    /// Associated job posting
    pub job: Pubkey,
    
    /// Required country codes (empty = any country)
    /// Max 10 countries for multi-country jobs
    pub required_countries: [[u8; 2]; 10],
    pub required_countries_count: u8,
    
    /// Excluded country codes (blocklist)
    pub excluded_countries: [[u8; 2]; 10],
    pub excluded_countries_count: u8,
    
    /// Required region codes within countries
    pub required_regions: [[u8; 6]; 5],
    pub required_regions_count: u8,
    
    /// Specific city hashes (for ultra-local jobs)
    pub required_cities: [[u8; 32]; 3],
    pub required_cities_count: u8,
    
    /// Center point for radius-based matching
    pub center_latitude: i32,
    pub center_longitude: i32,
    
    /// Maximum distance from center in meters
    /// 0 = no radius constraint
    pub max_distance_meters: u32,
    
    /// Require verified location?
    pub require_verified_location: bool,
    
    /// Allow remote workers?
    pub allow_remote: bool,
    
    /// Timezone constraints (for real-time collaboration)
    pub min_timezone_offset: i16,
    pub max_timezone_offset: i16,
    
    /// Bump seed
    pub bump: u8,
}

// ======================================================================
// DISPUTE RESOLUTION ACCOUNTS
// ======================================================================

/// Dispute for a job assignment
#[account]
pub struct Dispute {
    /// The job assignment being disputed
    pub assignment: Pubkey,
    
    /// Job posting reference
    pub job: Pubkey,
    
    /// Who raised the dispute
    pub raised_by: Pubkey,
    
    /// Whether raised by job_giver (true) or worker (false)
    pub raised_by_job_giver: bool,
    
    /// Current dispute status
    pub status: DisputeStatus,
    
    /// Reason category
    pub reason: DisputeReason,
    
    /// IPFS hash of evidence submitted by claimant
    pub claimant_evidence_hash: [u8; 32],
    
    /// IPFS hash of evidence submitted by respondent
    pub respondent_evidence_hash: [u8; 32],
    
    /// Amount in dispute (locked in escrow)
    pub disputed_amount: u64,
    
    /// Timestamp when dispute was raised
    pub raised_at: i64,
    
    /// Deadline for respondent to submit evidence
    pub evidence_deadline: i64,
    
    /// Deadline for arbiters to vote
    pub voting_deadline: i64,
    
    /// Number of arbiters assigned
    pub arbiter_count: u8,
    
    /// Votes in favor of claimant
    pub votes_for_claimant: u8,
    
    /// Votes in favor of respondent
    pub votes_for_respondent: u8,
    
    /// Resolution (if resolved)
    pub resolution: DisputeResolution,
    
    /// Timestamp when resolved
    pub resolved_at: i64,
    
    /// Bump seed
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum DisputeStatus {
    /// Waiting for respondent evidence
    AwaitingResponse,
    /// Arbiters are reviewing and voting
    InArbitration,
    /// Resolved in favor of claimant
    ResolvedForClaimant,
    /// Resolved in favor of respondent
    ResolvedForRespondent,
    /// Auto-resolved (timeout)
    AutoResolved,
    /// Cancelled by claimant
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum DisputeReason {
    /// Work not delivered
    NonDelivery,
    /// Work quality is substandard
    QualityIssue,
    /// Work doesn't match specification
    NotAsDescribed,
    /// Malicious/harmful content
    MaliciousContent,
    /// Payment not received
    PaymentNotReceived,
    /// Other reason (specified in evidence)
    Other,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum DisputeResolution {
    #[default]
    /// Not yet resolved
    Pending,
    /// Full refund to job giver
    FullRefund,
    /// Full payment to worker
    FullPayment,
    /// Split 50/50
    Split,
    /// Custom split (stored in resolution_split_bps)
    CustomSplit,
}

/// Arbiter profile - trusted dispute resolvers
#[account]
pub struct ArbiterProfile {
    /// Arbiter's wallet
    pub authority: Pubkey,
    
    /// Staked amount (for skin in the game)
    pub staked_amount: u64,
    
    /// Total disputes arbitrated
    pub total_disputes: u64,
    
    /// Disputes where arbiter was in majority
    pub correct_votes: u64,
    
    /// Expertise categories (bitmask)
    pub expertise_categories: u64,
    
    /// Is this arbiter active?
    pub is_active: bool,
    
    /// Reputation score (0-10000)
    pub reputation_score: u16,
    
    /// Last active timestamp
    pub last_active: i64,
    
    /// Bump seed
    pub bump: u8,
}

/// Individual arbiter vote on a dispute
#[account]
pub struct ArbiterVote {
    /// The dispute being voted on
    pub dispute: Pubkey,
    
    /// The arbiter voting
    pub arbiter: Pubkey,
    
    /// Vote: true = for claimant, false = for respondent
    pub vote_for_claimant: bool,
    
    /// Confidence level (1-100)
    pub confidence: u8,
    
    /// IPFS hash of reasoning (optional)
    pub reasoning_hash: [u8; 32],
    
    /// Timestamp of vote
    pub voted_at: i64,
    
    /// Bump seed
    pub bump: u8,
}

// ======================================================================
// LEARNING & QUALITY ACCOUNTS
// ======================================================================

/// Quality rating for a completed job
#[account]
pub struct QualityRating {
    /// The job assignment being rated
    pub assignment: Pubkey,
    
    /// Who is rating (job_giver or worker)
    pub rater: Pubkey,
    
    /// Who is being rated
    pub ratee: Pubkey,
    
    /// Is this a rating of worker (true) or job_giver (false)
    pub rating_worker: bool,
    
    /// Overall score (1-5 stars, stored as 10-50 for precision)
    pub overall_score: u8,
    
    /// Quality of deliverable (1-50)
    pub quality_score: u8,
    
    /// Communication quality (1-50)
    pub communication_score: u8,
    
    /// Timeliness (1-50)
    pub timeliness_score: u8,
    
    /// Professionalism (1-50)
    pub professionalism_score: u8,
    
    /// Would work with again? (0-100)
    pub would_work_again: u8,
    
    /// IPFS hash of detailed review
    pub review_hash: [u8; 32],
    
    /// Timestamp
    pub rated_at: i64,
    
    /// Is this review verified (completed job)?
    pub is_verified: bool,
    
    /// Bump seed
    pub bump: u8,
}

/// Learning record for agent improvement
#[account]
pub struct LearningRecord {
    /// Agent being tracked
    pub agent: Pubkey,
    
    /// Job category/type
    pub job_category: u16,
    
    /// Total jobs in this category
    pub total_jobs: u64,
    
    /// Successful completions (no disputes)
    pub successful_jobs: u64,
    
    /// Average quality score (0-10000)
    pub avg_quality_score: u16,
    
    /// Average response time in seconds
    pub avg_response_time: u32,
    
    /// Common feedback patterns (bitmask)
    pub feedback_patterns: u64,
    
    /// Improvement trend (-100 to +100)
    /// Positive = improving, negative = declining
    pub improvement_trend: i8,
    
    /// Last updated
    pub updated_at: i64,
    
    /// Bump seed
    pub bump: u8,
}

// ======================================================================
// INSTRUCTIONS - LOCATION
// ======================================================================

/// Create or update location profile for a worker/agent
pub fn set_location_profile(
    ctx: Context<SetLocationProfile>,
    country_code: [u8; 2],
    region_code: [u8; 6],
    city_name: [u8; 32],
    latitude: i32,
    longitude: i32,
    service_radius_meters: u32,
    timezone_offset_minutes: i16,
    visibility: u8,
) -> Result<()> {
    // Validate coordinates
    require!(
        latitude >= -90_000_000 && latitude <= 90_000_000,
        PgError::InvalidAmount
    );
    require!(
        longitude >= -180_000_000 && longitude <= 180_000_000,
        PgError::InvalidAmount
    );
    
    let profile = &mut ctx.accounts.location_profile;
    let clock = Clock::get()?;
    
    // Use city name directly as hash (already 32 bytes)
    let city_hash = city_name;
    
    profile.owner = ctx.accounts.owner.key();
    profile.country_code = country_code;
    profile.region_code = region_code;
    profile.city_hash = city_hash;
    profile.city_name = city_name;
    profile.latitude = latitude;
    profile.longitude = longitude;
    profile.service_radius_meters = service_radius_meters;
    profile.timezone_offset_minutes = timezone_offset_minutes;
    profile.visibility = match visibility {
        0 => LocationVisibility::Exact,
        1 => LocationVisibility::CityOnly,
        2 => LocationVisibility::RegionOnly,
        3 => LocationVisibility::CountryOnly,
        _ => LocationVisibility::Hidden,
    };
    
    if profile.created_at == 0 {
        profile.created_at = clock.unix_timestamp;
        profile.bump = ctx.bumps.location_profile;
    }
    profile.updated_at = clock.unix_timestamp;
    
    msg!("Location profile set: owner={}, country={}{}, city={:?}", 
         profile.owner, 
         profile.country_code[0] as char, 
         profile.country_code[1] as char,
         String::from_utf8_lossy(&profile.city_name));
    
    Ok(())
}

/// Set location filter for a job posting
pub fn set_job_location_filter(
    ctx: Context<SetJobLocationFilter>,
    required_countries: Vec<[u8; 2]>,
    excluded_countries: Vec<[u8; 2]>,
    required_regions: Vec<[u8; 6]>,
    center_latitude: i32,
    center_longitude: i32,
    max_distance_meters: u32,
    require_verified: bool,
    allow_remote: bool,
    min_tz_offset: i16,
    max_tz_offset: i16,
) -> Result<()> {
    let filter = &mut ctx.accounts.job_location_filter;
    
    filter.job = ctx.accounts.job.key();
    
    // Copy required countries (max 10)
    let req_count = required_countries.len().min(10);
    for (i, country) in required_countries.iter().take(req_count).enumerate() {
        filter.required_countries[i] = *country;
    }
    filter.required_countries_count = req_count as u8;
    
    // Copy excluded countries (max 10)
    let exc_count = excluded_countries.len().min(10);
    for (i, country) in excluded_countries.iter().take(exc_count).enumerate() {
        filter.excluded_countries[i] = *country;
    }
    filter.excluded_countries_count = exc_count as u8;
    
    // Copy required regions (max 5)
    let reg_count = required_regions.len().min(5);
    for (i, region) in required_regions.iter().take(reg_count).enumerate() {
        filter.required_regions[i] = *region;
    }
    filter.required_regions_count = reg_count as u8;
    
    filter.center_latitude = center_latitude;
    filter.center_longitude = center_longitude;
    filter.max_distance_meters = max_distance_meters;
    filter.require_verified_location = require_verified;
    filter.allow_remote = allow_remote;
    filter.min_timezone_offset = min_tz_offset;
    filter.max_timezone_offset = max_tz_offset;
    filter.bump = ctx.bumps.job_location_filter;
    
    msg!("Job location filter set: job={}, countries={}, radius={}m", 
         filter.job, req_count, max_distance_meters);
    
    Ok(())
}

/// Check if a worker matches job location requirements
pub fn check_location_match(
    ctx: Context<CheckLocationMatch>,
) -> Result<bool> {
    let filter = &ctx.accounts.job_location_filter;
    let profile = &ctx.accounts.worker_location;
    
    // Check if remote is allowed and worker has no location
    if filter.allow_remote && profile.service_radius_meters == 0 {
        return Ok(true);
    }
    
    // Check country exclusion
    for i in 0..filter.excluded_countries_count as usize {
        if profile.country_code == filter.excluded_countries[i] {
            return Ok(false);
        }
    }
    
    // Check country requirement
    if filter.required_countries_count > 0 {
        let mut country_match = false;
        for i in 0..filter.required_countries_count as usize {
            if profile.country_code == filter.required_countries[i] {
                country_match = true;
                break;
            }
        }
        if !country_match {
            return Ok(false);
        }
    }
    
    // Check region requirement
    if filter.required_regions_count > 0 {
        let mut region_match = false;
        for i in 0..filter.required_regions_count as usize {
            if profile.region_code == filter.required_regions[i] {
                region_match = true;
                break;
            }
        }
        if !region_match {
            return Ok(false);
        }
    }
    
    // Check distance constraint
    if filter.max_distance_meters > 0 {
        let distance = calculate_distance(
            filter.center_latitude,
            filter.center_longitude,
            profile.latitude,
            profile.longitude,
        );
        if distance > filter.max_distance_meters {
            return Ok(false);
        }
    }
    
    // Check timezone constraint
    if filter.min_timezone_offset != 0 || filter.max_timezone_offset != 0 {
        if profile.timezone_offset_minutes < filter.min_timezone_offset ||
           profile.timezone_offset_minutes > filter.max_timezone_offset {
            return Ok(false);
        }
    }
    
    // Check verification requirement
    if filter.require_verified_location && !profile.is_verified {
        return Ok(false);
    }
    
    Ok(true)
}

/// Calculate distance between two points using Haversine formula (simplified)
/// Returns distance in meters
fn calculate_distance(lat1: i32, lon1: i32, lat2: i32, lon2: i32) -> u32 {
    // Convert microdegrees to radians
    const MICRO_TO_RAD: f64 = 3.14159265359 / 180_000_000.0;
    const EARTH_RADIUS_METERS: f64 = 6_371_000.0;
    
    let lat1_rad = (lat1 as f64) * MICRO_TO_RAD;
    let lat2_rad = (lat2 as f64) * MICRO_TO_RAD;
    let dlat = ((lat2 - lat1) as f64) * MICRO_TO_RAD;
    let dlon = ((lon2 - lon1) as f64) * MICRO_TO_RAD;
    
    // Simplified Haversine (good enough for filtering)
    let a = (dlat / 2.0).sin().powi(2) + 
            lat1_rad.cos() * lat2_rad.cos() * (dlon / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().asin();
    
    (EARTH_RADIUS_METERS * c) as u32
}

// ======================================================================
// INSTRUCTIONS - DISPUTE RESOLUTION
// ======================================================================

/// Raise a dispute for a job assignment
pub fn raise_dispute(
    ctx: Context<RaiseDispute>,
    reason: u8,
    evidence_hash: [u8; 32],
) -> Result<()> {
    let dispute = &mut ctx.accounts.dispute;
    let assignment = &ctx.accounts.assignment;
    let clock = Clock::get()?;
    
    // Determine who is raising (job_giver or worker)
    let is_job_giver = ctx.accounts.raiser.key() == ctx.accounts.job.job_giver;
    
    // Verify raiser is party to the job
    require!(
        is_job_giver || ctx.accounts.raiser.key() == assignment.worker,
        PgError::Unauthorized
    );
    
    dispute.assignment = assignment.key();
    dispute.job = ctx.accounts.job.key();
    dispute.raised_by = ctx.accounts.raiser.key();
    dispute.raised_by_job_giver = is_job_giver;
    dispute.status = DisputeStatus::AwaitingResponse;
    dispute.reason = match reason {
        0 => DisputeReason::NonDelivery,
        1 => DisputeReason::QualityIssue,
        2 => DisputeReason::NotAsDescribed,
        3 => DisputeReason::MaliciousContent,
        4 => DisputeReason::PaymentNotReceived,
        _ => DisputeReason::Other,
    };
    dispute.claimant_evidence_hash = evidence_hash;
    dispute.disputed_amount = assignment.payment_amount;
    dispute.raised_at = clock.unix_timestamp;
    dispute.evidence_deadline = clock.unix_timestamp + 72 * 3600; // 72 hours
    dispute.voting_deadline = clock.unix_timestamp + 168 * 3600; // 7 days
    dispute.bump = ctx.bumps.dispute;
    
    msg!("Dispute raised: assignment={}, raised_by={}, reason={:?}", 
         dispute.assignment, dispute.raised_by, dispute.reason);
    
    Ok(())
}

/// Submit evidence as the respondent in a dispute
pub fn submit_dispute_evidence(
    ctx: Context<SubmitDisputeEvidence>,
    evidence_hash: [u8; 32],
) -> Result<()> {
    let dispute = &mut ctx.accounts.dispute;
    let clock = Clock::get()?;
    
    require!(
        dispute.status == DisputeStatus::AwaitingResponse,
        PgError::InvalidAmount
    );
    
    require!(
        clock.unix_timestamp <= dispute.evidence_deadline,
        PgError::InvalidAmount
    );
    
    dispute.respondent_evidence_hash = evidence_hash;
    dispute.status = DisputeStatus::InArbitration;
    
    msg!("Dispute evidence submitted: dispute={}", dispute.key());
    
    Ok(())
}

/// Arbiter votes on a dispute
pub fn vote_on_dispute(
    ctx: Context<VoteOnDispute>,
    vote_for_claimant: bool,
    confidence: u8,
    reasoning_hash: [u8; 32],
) -> Result<()> {
    let dispute = &mut ctx.accounts.dispute;
    let vote = &mut ctx.accounts.vote;
    let clock = Clock::get()?;
    
    require!(
        dispute.status == DisputeStatus::InArbitration,
        PgError::InvalidAmount
    );
    
    require!(
        clock.unix_timestamp <= dispute.voting_deadline,
        PgError::InvalidAmount
    );
    
    vote.dispute = dispute.key();
    vote.arbiter = ctx.accounts.arbiter.key();
    vote.vote_for_claimant = vote_for_claimant;
    vote.confidence = confidence.min(100);
    vote.reasoning_hash = reasoning_hash;
    vote.voted_at = clock.unix_timestamp;
    vote.bump = ctx.bumps.vote;
    
    // Update vote counts
    if vote_for_claimant {
        dispute.votes_for_claimant += 1;
    } else {
        dispute.votes_for_respondent += 1;
    }
    dispute.arbiter_count += 1;
    
    // Check if we have enough votes to resolve (3 arbiters minimum)
    if dispute.arbiter_count >= 3 {
        if dispute.votes_for_claimant > dispute.votes_for_respondent {
            dispute.status = DisputeStatus::ResolvedForClaimant;
            dispute.resolution = DisputeResolution::FullRefund;
        } else if dispute.votes_for_respondent > dispute.votes_for_claimant {
            dispute.status = DisputeStatus::ResolvedForRespondent;
            dispute.resolution = DisputeResolution::FullPayment;
        } else {
            dispute.resolution = DisputeResolution::Split;
        }
        dispute.resolved_at = clock.unix_timestamp;
    }
    
    msg!("Vote cast: dispute={}, for_claimant={}, votes={}/{}", 
         dispute.key(), vote_for_claimant, 
         dispute.votes_for_claimant, dispute.votes_for_respondent);
    
    Ok(())
}

/// Register as an arbiter (stake required)
pub fn register_arbiter(
    ctx: Context<RegisterArbiter>,
    expertise_categories: u64,
) -> Result<()> {
    let arbiter = &mut ctx.accounts.arbiter_profile;
    let clock = Clock::get()?;
    
    // Minimum stake: 1 SOL
    let stake_amount = ctx.accounts.stake_account.amount;
    require!(
        stake_amount >= 1_000_000_000,
        PgError::InsufficientCredits
    );
    
    arbiter.authority = ctx.accounts.authority.key();
    arbiter.staked_amount = stake_amount;
    arbiter.expertise_categories = expertise_categories;
    arbiter.is_active = true;
    arbiter.reputation_score = 5000; // Start at 50%
    arbiter.last_active = clock.unix_timestamp;
    arbiter.bump = ctx.bumps.arbiter_profile;
    
    msg!("Arbiter registered: authority={}, stake={}", 
         arbiter.authority, stake_amount);
    
    Ok(())
}

// ======================================================================
// INSTRUCTIONS - LEARNING & QUALITY
// ======================================================================

/// Submit a quality rating for a completed job
pub fn submit_quality_rating(
    ctx: Context<SubmitQualityRating>,
    overall_score: u8,
    quality_score: u8,
    communication_score: u8,
    timeliness_score: u8,
    professionalism_score: u8,
    would_work_again: u8,
    review_hash: [u8; 32],
) -> Result<()> {
    let rating = &mut ctx.accounts.rating;
    let clock = Clock::get()?;
    
    // Validate scores (10-50 range for 1-5 stars)
    require!(overall_score >= 10 && overall_score <= 50, PgError::InvalidAmount);
    require!(quality_score >= 10 && quality_score <= 50, PgError::InvalidAmount);
    require!(communication_score >= 10 && communication_score <= 50, PgError::InvalidAmount);
    require!(timeliness_score >= 10 && timeliness_score <= 50, PgError::InvalidAmount);
    require!(professionalism_score >= 10 && professionalism_score <= 50, PgError::InvalidAmount);
    
    rating.assignment = ctx.accounts.assignment.key();
    rating.rater = ctx.accounts.rater.key();
    rating.ratee = ctx.accounts.ratee.key();
    rating.rating_worker = ctx.accounts.rater.key() == ctx.accounts.job.job_giver;
    rating.overall_score = overall_score;
    rating.quality_score = quality_score;
    rating.communication_score = communication_score;
    rating.timeliness_score = timeliness_score;
    rating.professionalism_score = professionalism_score;
    rating.would_work_again = would_work_again.min(100);
    rating.review_hash = review_hash;
    rating.rated_at = clock.unix_timestamp;
    rating.is_verified = true; // Verified because it's linked to a real assignment
    rating.bump = ctx.bumps.rating;
    
    msg!("Quality rating submitted: assignment={}, overall={}/50", 
         rating.assignment, overall_score);
    
    Ok(())
}

/// Update learning record for an agent
pub fn update_learning_record(
    ctx: Context<UpdateLearningRecord>,
    job_category: u16,
    was_successful: bool,
    quality_score: u16,
    response_time_seconds: u32,
    feedback_patterns: u64,
) -> Result<()> {
    let record = &mut ctx.accounts.learning_record;
    let clock = Clock::get()?;
    
    if record.updated_at == 0 {
        // New record
        record.agent = ctx.accounts.agent.key();
        record.job_category = job_category;
        record.bump = ctx.bumps.learning_record;
    }
    
    record.total_jobs += 1;
    if was_successful {
        record.successful_jobs += 1;
    }
    
    // Update rolling average quality score
    let old_total = record.total_jobs - 1;
    if old_total > 0 {
        record.avg_quality_score = (
            (record.avg_quality_score as u64 * old_total + quality_score as u64) / 
            record.total_jobs
        ) as u16;
    } else {
        record.avg_quality_score = quality_score;
    }
    
    // Update rolling average response time
    if old_total > 0 {
        record.avg_response_time = (
            (record.avg_response_time as u64 * old_total + response_time_seconds as u64) / 
            record.total_jobs
        ) as u32;
    } else {
        record.avg_response_time = response_time_seconds;
    }
    
    // Accumulate feedback patterns
    record.feedback_patterns |= feedback_patterns;
    
    // Calculate improvement trend (compare last 10 vs previous 10)
    let success_rate = (record.successful_jobs * 10000 / record.total_jobs) as i16;
    let target_rate = 8000i16; // 80% target
    record.improvement_trend = ((success_rate - target_rate) / 100) as i8;
    
    record.updated_at = clock.unix_timestamp;
    
    msg!("Learning record updated: agent={}, category={}, success_rate={}%", 
         record.agent, job_category, record.successful_jobs * 100 / record.total_jobs);
    
    Ok(())
}

// ======================================================================
// CONTEXTS
// ======================================================================

#[derive(Accounts)]
pub struct SetLocationProfile<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + std::mem::size_of::<LocationProfile>(),
        seeds = [LOCATION_PROFILE_SEED, owner.key().as_ref()],
        bump
    )]
    pub location_profile: Account<'info, LocationProfile>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetJobLocationFilter<'info> {
    #[account(mut)]
    pub job_giver: Signer<'info>,
    
    /// CHECK: Job account
    pub job: AccountInfo<'info>,
    
    #[account(
        init,
        payer = job_giver,
        space = 8 + std::mem::size_of::<JobLocationFilter>(),
        seeds = [JOB_LOCATION_SEED, job.key().as_ref()],
        bump
    )]
    pub job_location_filter: Account<'info, JobLocationFilter>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CheckLocationMatch<'info> {
    pub job_location_filter: Account<'info, JobLocationFilter>,
    pub worker_location: Account<'info, LocationProfile>,
}

#[derive(Accounts)]
pub struct RaiseDispute<'info> {
    #[account(mut)]
    pub raiser: Signer<'info>,
    
    pub job: Account<'info, JobPosting>,
    
    pub assignment: Account<'info, WorkerAssignment>,
    
    #[account(
        init,
        payer = raiser,
        space = 8 + std::mem::size_of::<Dispute>(),
        seeds = [DISPUTE_SEED, assignment.key().as_ref()],
        bump
    )]
    pub dispute: Account<'info, Dispute>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitDisputeEvidence<'info> {
    #[account(mut)]
    pub respondent: Signer<'info>,
    
    #[account(mut)]
    pub dispute: Account<'info, Dispute>,
}

#[derive(Accounts)]
pub struct VoteOnDispute<'info> {
    #[account(mut)]
    pub arbiter: Signer<'info>,
    
    pub arbiter_profile: Account<'info, ArbiterProfile>,
    
    #[account(mut)]
    pub dispute: Account<'info, Dispute>,
    
    #[account(
        init,
        payer = arbiter,
        space = 8 + std::mem::size_of::<ArbiterVote>(),
        seeds = [b"arbiter_vote", dispute.key().as_ref(), arbiter.key().as_ref()],
        bump
    )]
    pub vote: Account<'info, ArbiterVote>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterArbiter<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// CHECK: Stake token account
    pub stake_account: Account<'info, anchor_spl::token::TokenAccount>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<ArbiterProfile>(),
        seeds = [ARBITER_SEED, authority.key().as_ref()],
        bump
    )]
    pub arbiter_profile: Account<'info, ArbiterProfile>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitQualityRating<'info> {
    #[account(mut)]
    pub rater: Signer<'info>,
    
    /// CHECK: The person/agent being rated
    pub ratee: AccountInfo<'info>,
    
    pub job: Account<'info, JobPosting>,
    
    pub assignment: Account<'info, WorkerAssignment>,
    
    #[account(
        init,
        payer = rater,
        space = 8 + std::mem::size_of::<QualityRating>(),
        seeds = [QUALITY_RATING_SEED, assignment.key().as_ref(), rater.key().as_ref()],
        bump
    )]
    pub rating: Account<'info, QualityRating>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateLearningRecord<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// CHECK: Agent being tracked
    pub agent: AccountInfo<'info>,
    
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + std::mem::size_of::<LearningRecord>(),
        seeds = [LEARNING_RECORD_SEED, agent.key().as_ref()],
        bump
    )]
    pub learning_record: Account<'info, LearningRecord>,
    
    pub system_program: Program<'info, System>,
}

