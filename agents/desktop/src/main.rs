//! PHANTOM PARADOX DESKTOP AGENT
//! 
//! Full agent for Windows/Mac/Linux
//! - Compute tasks (CPU/GPU)
//! - Relay traffic (VPN/bandwidth)
//! - Verification (Merkle proofs, jury)
//! - Heartbeat reporting

use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::time::interval;
use tracing::{info, warn, error};

mod config;
mod agent;
mod relay;
mod compute;
mod verify;
mod wallet;

// ============== CLI ==============

#[derive(Parser)]
#[command(name = "phantom-agent")]
#[command(about = "Phantom Paradox Desktop Agent - Earn by sharing compute and bandwidth")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
    
    /// Config file path
    #[arg(short, long, default_value = "config.toml")]
    config: PathBuf,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the agent
    Start,
    /// Stop the agent
    Stop,
    /// Show agent status
    Status,
    /// Run capability test
    Test,
    /// Initialize config
    Init,
}

// ============== CONFIG ==============

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentConfig {
    pub wallet_path: PathBuf,
    pub manager_url: String,
    pub rpc_url: String,
    
    pub limits: ResourceLimits,
    pub modes: AgentModes,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResourceLimits {
    pub max_cpu_percent: u8,
    pub max_ram_mb: u32,
    pub max_bandwidth_mbps: u32,
    pub max_daily_data_gb: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentModes {
    pub compute: bool,
    pub relay: bool,
    pub verify: bool,
    pub jury: bool,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            wallet_path: PathBuf::from("wallet.json"),
            manager_url: "https://api.phantomparadox.io".to_string(),
            rpc_url: "https://api.devnet.solana.com".to_string(),
            limits: ResourceLimits {
                max_cpu_percent: 25,
                max_ram_mb: 1024,
                max_bandwidth_mbps: 10,
                max_daily_data_gb: 1,
            },
            modes: AgentModes {
                compute: true,
                relay: true,
                verify: true,
                jury: true,
            },
        }
    }
}

// ============== AGENT STATE ==============

#[derive(Debug, Clone, Serialize)]
pub struct AgentState {
    pub is_running: bool,
    pub wallet_address: Option<String>,
    pub start_time: Option<u64>,
    pub stats: AgentStats,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct AgentStats {
    pub jobs_completed: u64,
    pub bytes_relayed: u64,
    pub compute_cycles: u64,
    pub verifications: u64,
    pub earnings_lamports: u64,
    pub uptime_seconds: u64,
}

// ============== MAIN ==============

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();
    
    let cli = Cli::parse();
    
    match cli.command.unwrap_or(Commands::Start) {
        Commands::Start => start_agent(&cli.config).await?,
        Commands::Stop => stop_agent().await?,
        Commands::Status => show_status().await?,
        Commands::Test => run_test().await?,
        Commands::Init => init_config(&cli.config).await?,
    }
    
    Ok(())
}

// ============== COMMANDS ==============

async fn start_agent(config_path: &PathBuf) -> anyhow::Result<()> {
    info!("Starting Phantom Paradox Agent...");
    
    // Load config
    let config = load_config(config_path)?;
    info!("Config loaded from {:?}", config_path);
    
    // Initialize state
    let mut state = AgentState {
        is_running: true,
        wallet_address: None, // TODO: Load from wallet file
        start_time: Some(std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs()),
        stats: AgentStats::default(),
    };
    
    info!("Agent started with limits: CPU {}%, RAM {} MB, BW {} Mbps",
        config.limits.max_cpu_percent,
        config.limits.max_ram_mb,
        config.limits.max_bandwidth_mbps
    );
    
    // Main loop
    let mut heartbeat_interval = interval(Duration::from_secs(30));
    let mut stats_interval = interval(Duration::from_secs(60));
    
    loop {
        tokio::select! {
            _ = heartbeat_interval.tick() => {
                send_heartbeat(&config, &state).await;
            }
            _ = stats_interval.tick() => {
                update_stats(&mut state);
                info!("Stats: {:?}", state.stats);
            }
            _ = tokio::signal::ctrl_c() => {
                info!("Shutdown signal received");
                break;
            }
        }
    }
    
    info!("Agent stopped");
    Ok(())
}

async fn stop_agent() -> anyhow::Result<()> {
    info!("Stopping agent...");
    // TODO: Send stop signal to running agent
    Ok(())
}

async fn show_status() -> anyhow::Result<()> {
    info!("Agent Status:");
    // TODO: Query running agent status
    println!("Status: Not implemented yet");
    Ok(())
}

async fn run_test() -> anyhow::Result<()> {
    use sysinfo::System;
    
    info!("Running capability test...");
    
    let mut sys = System::new_all();
    sys.refresh_all();
    
    println!("\n=== SYSTEM INFO ===");
    println!("OS: {} {}", System::name().unwrap_or_default(), System::os_version().unwrap_or_default());
    println!("CPU: {} cores", sys.cpus().len());
    println!("RAM: {} MB total", sys.total_memory() / 1024 / 1024);
    println!("RAM Available: {} MB", sys.available_memory() / 1024 / 1024);
    
    println!("\n=== NETWORK TEST ===");
    let start = Instant::now();
    let resp = reqwest::get("https://1.1.1.1/cdn-cgi/trace").await?;
    let latency = start.elapsed().as_millis();
    println!("Cloudflare latency: {} ms", latency);
    
    let start = Instant::now();
    let _ = reqwest::get("https://api.devnet.solana.com").await?;
    let latency = start.elapsed().as_millis();
    println!("Solana Devnet latency: {} ms", latency);
    
    println!("\n=== AGENT GRADE ===");
    let grade = if latency < 100 { "A" } else if latency < 200 { "B" } else { "C" };
    println!("Grade: {}", grade);
    
    Ok(())
}

async fn init_config(config_path: &PathBuf) -> anyhow::Result<()> {
    let config = AgentConfig::default();
    let toml = toml::to_string_pretty(&config)?;
    std::fs::write(config_path, toml)?;
    info!("Config initialized at {:?}", config_path);
    Ok(())
}

// ============== HELPERS ==============

fn load_config(path: &PathBuf) -> anyhow::Result<AgentConfig> {
    if path.exists() {
        let content = std::fs::read_to_string(path)?;
        Ok(toml::from_str(&content)?)
    } else {
        Ok(AgentConfig::default())
    }
}

async fn send_heartbeat(config: &AgentConfig, state: &AgentState) {
    info!("Sending heartbeat...");
    // TODO: Implement real heartbeat to manager
}

fn update_stats(state: &mut AgentState) {
    if let Some(start) = state.start_time {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        state.stats.uptime_seconds = now - start;
    }
}

