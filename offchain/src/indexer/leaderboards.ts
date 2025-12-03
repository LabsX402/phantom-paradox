/**
 * ======================================================================
 * PHANTOM NEXUS - Hall of Fame Leaderboards
 * ======================================================================
 * 
 * Three distinct leaderboards:
 * 1. Greed (Top Earners) - Attract builders
 * 2. Trust (Most Reliable) - Attract money
 * 3. Hype (Trending) - Create FOMO
 * 
 * Refreshed every 10 minutes
 */

import { query } from "../shared/db";
import { logger } from "../shared/logger";
import { Connection, PublicKey } from "@solana/web3.js";
import { getConnection } from "../shared/solana";

// ======================================================================
// LEADERBOARD TYPES
// ======================================================================

export type LeaderboardType = "earners" | "reliable" | "trending";

interface LeaderboardEntry {
  agentId: string;
  rank: number;
  score: number;
  metadata?: any;
}

// ======================================================================
// REFRESH FUNCTIONS
// ======================================================================

/**
 * Refresh all leaderboards
 * Run every 10 minutes via cron/scheduler
 */
export async function refreshLeaderboards(): Promise<void> {
  logger.info("[LEADERBOARDS] Refreshing all leaderboards...");
  
  try {
    // Clear old cache
    await query(`DELETE FROM leaderboard_cache`);
    
    // Refresh each leaderboard type
    const earners = await refreshEarnersLeaderboard();
    const reliable = await refreshReliableLeaderboard();
    const trending = await refreshTrendingLeaderboard();
    
    // Store in cache
    await storeLeaderboard("earners", earners);
    await storeLeaderboard("reliable", reliable);
    await storeLeaderboard("trending", trending);
    
    logger.info(`[LEADERBOARDS] Refreshed: ${earners.length} earners, ${reliable.length} reliable, ${trending.length} trending`);
  } catch (error) {
    logger.error("[LEADERBOARDS] Failed to refresh", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Query A: Greed (Top Earners)
 * SELECT agent_id, SUM(royalty_amount) as earnings FROM settled_batches GROUP BY agent_id ORDER BY earnings DESC
 */
async function refreshEarnersLeaderboard(): Promise<LeaderboardEntry[]> {
  // Extract royalty distribution from settled_batches JSONB
  const result = await query(
    `SELECT 
      jsonb_array_elements(royalty_distribution)->>'agent' as agent_id,
      SUM((jsonb_array_elements(royalty_distribution)->>'amount')::bigint) as earnings
     FROM settled_batches
     WHERE settled_at > NOW() - INTERVAL '30 DAYS'
     GROUP BY agent_id
     ORDER BY earnings DESC
     LIMIT 20`
  );
  
  return result.rows.map((row: any, index: number) => ({
    agentId: row.agent_id,
    rank: index + 1,
    score: parseFloat(row.earnings || "0"),
    metadata: {
      earningsLamports: row.earnings,
      earningsSOL: (parseFloat(row.earnings || "0") / 1e9).toFixed(2),
    },
  }));
}

/**
 * Query B: Trust (Most Reliable)
 * SELECT agent_id, uptime_score, slash_count FROM agent_stats WHERE slash_count = 0 ORDER BY uptime_score DESC
 * 
 * CRITICAL: Zero Tolerance - MUST filter out anyone with > 0 slashes
 */
async function refreshReliableLeaderboard(): Promise<LeaderboardEntry[]> {
  const result = await query(
    `SELECT 
      agent_id,
      sla_score,
      uptime_24h,
      completion_rate,
      slash_count
     FROM agent_stats
     WHERE slash_count = 0
     ORDER BY sla_score DESC, uptime_24h DESC
     LIMIT 20`
  );
  
  return result.rows.map((row: any, index: number) => ({
    agentId: row.agent_id,
    rank: index + 1,
    score: row.sla_score,
    metadata: {
      slaScore: row.sla_score,
      uptime24h: parseFloat(row.uptime_24h),
      completionRate: parseFloat(row.completion_rate),
      slashCount: row.slash_count, // Should always be 0
    },
  }));
}

/**
 * Query C: Hype (Trending)
 * SELECT agent_id, COUNT(DISTINCT owner_pubkey) as unique_users FROM trade_intents WHERE created_at > NOW() - INTERVAL '24 HOURS' GROUP BY agent_id ORDER BY unique_users DESC
 * 
 * CRITICAL: Strictly 24h rolling window
 */
async function refreshTrendingLeaderboard(): Promise<LeaderboardEntry[]> {
  const day24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const result = await query(
    `SELECT 
      agent_id,
      COUNT(DISTINCT owner_pubkey) as unique_users,
      COUNT(*) as total_intents
     FROM trade_intents
     WHERE created_at > $1
     AND agent_id IS NOT NULL
     GROUP BY agent_id
     ORDER BY unique_users DESC, total_intents DESC
     LIMIT 20`,
    [day24h]
  );
  
  return result.rows.map((row: any, index: number) => ({
    agentId: row.agent_id,
    rank: index + 1,
    score: parseInt(row.unique_users),
    metadata: {
      uniqueUsers: parseInt(row.unique_users),
      totalIntents: parseInt(row.total_intents),
    },
  }));
}

/**
 * Store leaderboard in cache
 */
async function storeLeaderboard(
  type: LeaderboardType,
  entries: LeaderboardEntry[]
): Promise<void> {
  for (const entry of entries) {
    await query(
      `INSERT INTO leaderboard_cache (leaderboard_type, rank, agent_id, score, metadata, refreshed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (leaderboard_type, rank) DO UPDATE SET
         agent_id = EXCLUDED.agent_id,
         score = EXCLUDED.score,
         metadata = EXCLUDED.metadata,
         refreshed_at = NOW()`,
      [
        type,
        entry.rank,
        entry.agentId,
        entry.score,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      ]
    );
  }
}

// ======================================================================
// WHALE MAGNET DETECTION
// ======================================================================

/**
 * Detect and record Whale Trusted agents
 * Agents used by wallets with >10k SOL balance
 * 
 * Run periodically (e.g., after each batch settlement)
 */
export async function detectWhaleTrustedAgents(): Promise<void> {
  logger.info("[LEADERBOARDS] Detecting whale trusted agents...");
  
  try {
    const connection = getConnection();
    const WHALE_THRESHOLD = 10_000 * 1e9; // 10k SOL in lamports
    
    // Get unique agent-user pairs from recent intents (last 7 days)
    const day7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [agentUsers] = await query(
      `SELECT DISTINCT agent_id, owner_pubkey 
       FROM trade_intents 
       WHERE created_at > $1 
       AND agent_id IS NOT NULL`,
      [day7d]
    );
    
    // Check wallet balances on-chain
    for (const row of agentUsers.rows) {
      try {
        const walletPubkey = new PublicKey(row.owner_pubkey);
        const balance = await connection.getBalance(walletPubkey);
        
        if (balance >= WHALE_THRESHOLD) {
          // This is a whale - record the agent
          const [existing] = await query(
            `SELECT * FROM whale_trusted_agents 
             WHERE agent_id = $1 AND whale_wallet = $2`,
            [row.agent_id, row.owner_pubkey]
          );
          
          if (!existing || existing.length === 0) {
            // Calculate total volume from this whale
            const [volume] = await query(
              `SELECT SUM(amount_lamports::bigint) as total 
               FROM trade_intents 
               WHERE agent_id = $1 AND owner_pubkey = $2`,
              [row.agent_id, row.owner_pubkey]
            );
            
            await query(
              `INSERT INTO whale_trusted_agents (agent_id, whale_wallet, total_volume_lamports)
               VALUES ($1, $2, $3)
               ON CONFLICT (agent_id) DO UPDATE SET
                 total_volume_lamports = EXCLUDED.total_volume_lamports`,
              [
                row.agent_id,
                row.owner_pubkey,
                volume.total?.toString() || "0",
              ]
            );
            
            logger.info(`[LEADERBOARDS] 🐋 Whale detected: Agent ${row.agent_id} trusted by whale ${row.owner_pubkey.substring(0, 8)}...`);
          }
        }
      } catch (error) {
        // Skip invalid pubkeys or RPC errors
        continue;
      }
    }
  } catch (error) {
    logger.error("[LEADERBOARDS] Failed to detect whale trusted agents", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ======================================================================
// SCHEDULER INTEGRATION
// ======================================================================

/**
 * Initialize leaderboard refresh scheduler
 * Call this from your main service
 */
export function startLeaderboardScheduler(intervalMinutes: number = 10): void {
  logger.info(`[LEADERBOARDS] Starting scheduler (refresh every ${intervalMinutes} minutes)`);
  
  // Initial refresh
  refreshLeaderboards().catch(console.error);
  
  // Schedule periodic refresh
  setInterval(() => {
    refreshLeaderboards().catch(console.error);
  }, intervalMinutes * 60 * 1000);
  
  // Also detect whale trusted agents periodically
  setInterval(() => {
    detectWhaleTrustedAgents().catch(console.error);
  }, 60 * 60 * 1000); // Every hour
}

