use anchor_lang::prelude::*;

use crate::{
    IntegrationConfigData, IntegrationUpdateProposed, IntegrationUpdateExecuted,
    InitIntegrationConfig, ProposeIntegrationUpdate, ExecuteIntegrationUpdate,
    CancelIntegrationUpdate, PgError,
};

// ======================================================================
// INTEGRATION CONFIG INSTRUCTIONS (Safe Upgrade Mechanism)
// ======================================================================

/// Initialize integration config (called once at deployment)
/// Stores integration endpoints/keys that can be updated safely
pub fn init_integration_config(
    ctx: Context<InitIntegrationConfig>,
    initial_config: IntegrationConfigData,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    
    config.governance = ctx.accounts.governance.key();
    config.version = 1;
    config.fcm_endpoint = initial_config.fcm_endpoint;
    config.apns_endpoint = initial_config.apns_endpoint;
    config.oracle_endpoint = initial_config.oracle_endpoint;
    config.notification_endpoint = initial_config.notification_endpoint;
    config.data_availability_endpoint = initial_config.data_availability_endpoint;
    config.pending_update = None;
    config.update_proposed_at = 0;
    config.update_unlock_time = 0;
    config.bump = ctx.bumps.config;
    
    Ok(())
}

/// Propose integration update (requires DAO vote + 7-14 day timelock)
/// ONLY integration endpoints can be updated - core logic cannot be changed
pub fn propose_integration_update(
    ctx: Context<ProposeIntegrationUpdate>,
    new_config: IntegrationConfigData,
    timelock_days: u8,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let clock = Clock::get()?;
    
    require!(config.governance == ctx.accounts.governance.key(), PgError::Unauthorized);
    require!(timelock_days >= 7 && timelock_days <= 14, PgError::InvalidTime);
    
    // Validate endpoints (basic sanity checks)
    validate_integration_endpoints(&new_config)?;
    
    // Store proposed update
    config.pending_update = Some(new_config);
    config.update_proposed_at = clock.unix_timestamp;
    config.update_unlock_time = clock.unix_timestamp + (timelock_days as i64 * 24 * 60 * 60);
    
    emit!(IntegrationUpdateProposed {
        config: config.key(),
        proposed_at: config.update_proposed_at,
        unlock_time: config.update_unlock_time,
    });
    
    Ok(())
}

/// Execute integration update (after DAO vote + timelock)
pub fn execute_integration_update(ctx: Context<ExecuteIntegrationUpdate>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let clock = Clock::get()?;
    
    require!(config.governance == ctx.accounts.governance.key(), PgError::Unauthorized);
    
    let proposed = config.pending_update.clone().ok_or(PgError::InvalidAmount)?;
    let timelock_secs = 7 * 24 * 60 * 60; // Minimum 7 days
    
    require!(
        clock.unix_timestamp >= config.update_proposed_at + timelock_secs,
        PgError::TreasuryTimelockActive // Reuse treasury timelock error for consistency
    );
    require!(
        clock.unix_timestamp >= config.update_unlock_time,
        PgError::TreasuryTimelockActive
    );
    
    // Apply update
    config.fcm_endpoint = proposed.fcm_endpoint;
    config.apns_endpoint = proposed.apns_endpoint;
    config.oracle_endpoint = proposed.oracle_endpoint;
    config.notification_endpoint = proposed.notification_endpoint;
    config.data_availability_endpoint = proposed.data_availability_endpoint;
    config.version = config.version.checked_add(1).ok_or(PgError::Overflow)?;
    config.pending_update = None;
    config.update_proposed_at = 0;
    config.update_unlock_time = 0;
    
    emit!(IntegrationUpdateExecuted {
        config: config.key(),
        version: config.version,
    });
    
    Ok(())
}

/// Cancel pending integration update (governance only)
pub fn cancel_integration_update(ctx: Context<CancelIntegrationUpdate>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    
    require!(config.governance == ctx.accounts.governance.key(), PgError::Unauthorized);
    
    config.pending_update = None;
    config.update_proposed_at = 0;
    config.update_unlock_time = 0;
    
    Ok(())
}

// ======================================================================
// HELPER FUNCTIONS
// ======================================================================

/// Validate integration endpoints (basic sanity checks)
fn validate_integration_endpoints(config: &IntegrationConfigData) -> Result<()> {
    // Validate FCM endpoint (if provided)
    if !config.fcm_endpoint.is_empty() {
        require!(
            config.fcm_endpoint.len() <= 200,
            PgError::InvalidAmount
        );
        // Basic URL validation
        require!(
            config.fcm_endpoint.starts_with("https://") || config.fcm_endpoint.starts_with("http://"),
            PgError::InvalidAmount
        );
    }
    
    // Validate APNS endpoint (if provided)
    if !config.apns_endpoint.is_empty() {
        require!(
            config.apns_endpoint.len() <= 200,
            PgError::InvalidAmount
        );
        require!(
            config.apns_endpoint.starts_with("https://") || config.apns_endpoint.starts_with("http://"),
            PgError::InvalidAmount
        );
    }
    
    // Validate oracle endpoint (if provided)
    if !config.oracle_endpoint.is_empty() {
        require!(
            config.oracle_endpoint.len() <= 200,
            PgError::InvalidAmount
        );
        require!(
            config.oracle_endpoint.starts_with("https://"),
            PgError::InvalidAmount
        );
    }
    
    // Validate notification endpoint (if provided)
    if !config.notification_endpoint.is_empty() {
        require!(
            config.notification_endpoint.len() <= 200,
            PgError::InvalidAmount
        );
        require!(
            config.notification_endpoint.starts_with("https://"),
            PgError::InvalidAmount
        );
    }
    
    // Validate data availability endpoint (if provided)
    if !config.data_availability_endpoint.is_empty() {
        require!(
            config.data_availability_endpoint.len() <= 200,
            PgError::InvalidAmount
        );
        require!(
            config.data_availability_endpoint.starts_with("https://") || 
            config.data_availability_endpoint.starts_with("ipfs://") ||
            config.data_availability_endpoint.starts_with("ar://"),
            PgError::InvalidAmount
        );
    }
    
    Ok(())
}

// ======================================================================
// CONTEXTS (Defined in lib.rs to avoid duplication)
// ======================================================================
// Note: Context structs are defined in lib.rs to avoid Anchor macro conflicts

// ======================================================================
// DATA STRUCTS
// ======================================================================
// Note: IntegrationConfigData is defined in lib.rs to avoid duplication

