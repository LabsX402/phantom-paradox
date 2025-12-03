/**
 * ======================================================================
 * PHANTOM NEXUS - Stats API
 * ======================================================================
 * 
 * Enterprise-grade stats endpoints for Agent Marketplace
 */

import { Router, Request, Response } from "express";
import { query } from "../shared/db";
import { logger } from "../shared/logger";
import { aggregateWorkerStats } from "../indexer/analytics";
import { Connection, PublicKey } from "@solana/web3.js";
import { getConnection } from "../shared/solana";

const router = Router();

// ======================================================================
// AGENT DILIGENCE ENDPOINTS
// ======================================================================

/**
 * GET /stats/agent/:id/diligence
 * Full stat object for UI "Pro Mode"
 */
router.get("/stats/agent/:id/diligence", async (req: Request, res: Response) => {
  try {
    const { id: agentId } = req.params;
    
    // Get base stats
    const [stats] = await query(
      `SELECT * FROM agent_stats WHERE agent_id = $1`,
      [agentId]
    );
    
    if (!stats) {
      return res.status(404).json({ error: "agent_not_found" });
    }
    
    // Get uptime graph (hourly uptime % for last 24h)
    const day24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [uptimeGraph] = await query(
      `SELECT 
        DATE_TRUNC('hour', timestamp) as hour,
        COUNT(*) as heartbeat_count,
        (COUNT(*)::numeric / 60.0 * 100) as uptime_percent
       FROM agent_heartbeats 
       WHERE agent_id = $1 AND timestamp > $2
       GROUP BY DATE_TRUNC('hour', timestamp)
       ORDER BY hour ASC`,
      [agentId, day24h]
    );
    
    // Determine risk level
    const riskLevel = stats.risk_level || "Medium";
    
    // Generate badges
    const badges: string[] = [];
    if (stats.uptime_24h >= 99.9) badges.push("99.9% Uptime");
    if (parseInt(stats.total_value_secured || "0") > 10_000_000_000_000) { // >10k SOL
      badges.push("Whale Trusted 🐋");
    }
    if (stats.first_seen_at) {
      const daysSince = (Date.now() - new Date(stats.first_seen_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 365) badges.push("Veteran");
    }
    if (stats.slash_count === 0 && stats.uptime_24h >= 95) {
      badges.push("Zero Defects");
    }
    
    // Get metadata
    const [metadata] = await query(
      `SELECT * FROM agent_registry_metadata WHERE agent_id = $1`,
      [agentId]
    );
    
    res.json({
      agentId,
      stats: {
        uptime24h: parseFloat(stats.uptime_24h),
        uptime7d: parseFloat(stats.uptime_7d),
        uptime30d: parseFloat(stats.uptime_30d),
        meanTimeToReact: stats.mean_time_to_react_ms,
        ghostingRate: parseFloat(stats.ghosting_rate),
        completionRate: parseFloat(stats.completion_rate),
        disputeRate: parseFloat(stats.dispute_rate),
        arbitrationWinRate: parseFloat(stats.arbitration_win_rate),
        oneShotSuccessRate: parseFloat(stats.one_shot_success_rate),
        slashCount: stats.slash_count,
        totalValueSecured: stats.total_value_secured,
        retentionRate: parseFloat(stats.retention_rate),
        specializationTag: stats.specialization_tag,
        computeBurstCapacity: stats.compute_burst_capacity,
        slaScore: stats.sla_score,
        riskLevel,
      },
      uptimeGraph: uptimeGraph.map((r: any) => ({
        hour: r.hour,
        uptimePercent: parseFloat(r.uptime_percent),
      })),
      badges,
      metadata: metadata || null,
    });
  } catch (error) {
    logger.error("Error getting agent diligence", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /stats/marketplace/top_rated?category=sniper
 * Top agents sorted by SLA score (Quality), not just Volume
 */
router.get("/stats/marketplace/top_rated", async (req: Request, res: Response) => {
  try {
    const { category } = req.query;
    
    let sql = `
      SELECT 
        s.agent_id,
        s.sla_score,
        s.risk_level,
        s.uptime_24h,
        s.completion_rate,
        s.slash_count,
        m.name,
        m.avatar_url,
        m.category
      FROM agent_stats s
      LEFT JOIN agent_registry_metadata m ON s.agent_id = m.agent_id
      WHERE s.sla_score > 0
    `;
    
    const params: any[] = [];
    if (category) {
      sql += ` AND m.category = $1`;
      params.push(category);
    }
    
    sql += ` ORDER BY s.sla_score DESC LIMIT 20`;
    
    const result = await query(sql, params);
    
    res.json({
      category: category || "all",
      agents: result.rows.map((r: any) => ({
        agentId: r.agent_id,
        name: r.name || r.agent_id.substring(0, 8) + "...",
        avatarUrl: r.avatar_url,
        category: r.category,
        slaScore: r.sla_score,
        riskLevel: r.risk_level,
        uptime24h: parseFloat(r.uptime_24h),
        completionRate: parseFloat(r.completion_rate),
        slashCount: r.slash_count,
      })),
    });
  } catch (error) {
    logger.error("Error getting top rated agents", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "internal_error" });
  }
});

// ======================================================================
// LEADERBOARD ENDPOINTS
// ======================================================================

/**
 * GET /stats/leaderboard?type=earners|reliable|trending
 * Returns top 10-20 from cached leaderboard
 */
router.get("/stats/leaderboard", async (req: Request, res: Response) => {
  try {
    const { type = "earners" } = req.query;
    
    if (!["earners", "reliable", "trending"].includes(type as string)) {
      return res.status(400).json({ error: "invalid_leaderboard_type" });
    }
    
    // Get from cache
    const [cached] = await query(
      `SELECT agent_id, score, metadata 
       FROM leaderboard_cache 
       WHERE leaderboard_type = $1 
       ORDER BY rank ASC 
       LIMIT 20`,
      [type]
    );
    
    if (!cached || cached.length === 0) {
      // Cache miss - return empty (leaderboard refresh should populate)
      return res.json({
        type,
        agents: [],
        message: "Leaderboard cache empty - refresh in progress",
      });
    }
    
    // Enrich with metadata
    const agentIds = cached.map((r: any) => r.agent_id);
    const [metadata] = await query(
      `SELECT * FROM agent_registry_metadata WHERE agent_id = ANY($1)`,
      [agentIds]
    );
    
    const metadataMap = new Map(
      metadata.map((m: any) => [m.agent_id, m])
    );
    
    res.json({
      type,
      agents: cached.map((r: any) => {
        const meta = metadataMap.get(r.agent_id);
        return {
          agentId: r.agent_id,
          rank: r.rank,
          score: parseFloat(r.score),
          name: meta?.name || r.agent_id.substring(0, 8) + "...",
          avatarUrl: meta?.avatar_url,
          category: meta?.category,
          metadata: r.metadata || {},
        };
      }),
      refreshedAt: cached[0]?.refreshed_at,
    });
  } catch (error) {
    logger.error("Error getting leaderboard", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /stats/agent/:id/badges
 * Get all badges for an agent (including Whale Trusted)
 */
router.get("/stats/agent/:id/badges", async (req: Request, res: Response) => {
  try {
    const { id: agentId } = req.params;
    
    const badges: string[] = [];
    
    // Check stats for standard badges
    const [stats] = await query(
      `SELECT * FROM agent_stats WHERE agent_id = $1`,
      [agentId]
    );
    
    if (stats) {
      if (stats.uptime_24h >= 99.9) badges.push("99.9% Uptime");
      if (parseInt(stats.total_value_secured || "0") > 10_000_000_000_000) {
        badges.push("Whale Trusted 🐋");
      }
      if (stats.slash_count === 0 && stats.uptime_24h >= 95) {
        badges.push("Zero Defects");
      }
      if (stats.sla_score >= 90) badges.push("Elite SLA");
    }
    
    // Check for Whale Trusted badge (agents used by wallets with >10k SOL)
    const [whaleTrusted] = await query(
      `SELECT COUNT(*) as count FROM whale_trusted_agents WHERE agent_id = $1`,
      [agentId]
    );
    if (parseInt(whaleTrusted.count) > 0) {
      badges.push("Whale Magnet 🐋");
    }
    
    res.json({
      agentId,
      badges,
    });
  } catch (error) {
    logger.error("Error getting agent badges", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;

