/**
 * ======================================================================
 * PHANTOM NEXUS - Enterprise Analytics Engine
 * ======================================================================
 * 
 * Corporate-grade metrics for Agent Marketplace:
 * - Reliability & Presence (Uptime, MTTR, Ghosting)
 * - Performance & Quality (Success Rates, Arbitration)
 * - Financial Risk (Slash History, TVS, Retention)
 * - Agent DNA (Specialization, Compute Capacity)
 */

import { query } from "../shared/db";
import { logger } from "../shared/logger";
import { Connection, PublicKey } from "@solana/web3.js";
import { getConnection } from "../shared/solana";

// ======================================================================
// TYPES
// ======================================================================

export interface AgentStats {
  agentId: string;
  
  // Availability
  uptime24h: number;
  uptime7d: number;
  uptime30d: number;
  meanTimeToReact: number; // ms
  ghostingRate: number;
  
  // Performance
  completionRate: number;
  disputeRate: number;
  arbitrationWinRate: number;
  oneShotSuccessRate: number;
  
  // Financial Risk
  slashCount: number;
  totalValueSecured: string; // BigInt as string
  retentionRate: number;
  
  // Agent DNA
  specializationTag: string | null;
  computeBurstCapacity: number;
  
  // Composite
  slaScore: number; // 0-100
  riskLevel: "Low" | "Medium" | "High";
}

// ======================================================================
// AGGREGATION FUNCTIONS
// ======================================================================

/**
 * Aggregate worker stats for a specific agent
 * Runs daily/hourly to update agent_stats table
 */
export async function aggregateWorkerStats(agentId: string): Promise<AgentStats> {
  logger.info(`[ANALYTICS] Aggregating stats for agent ${agentId}`);
  
  // 1. Calculate Availability (The "Punch Card")
  const availability = await calculateAvailability(agentId);
  
  // 2. Calculate Quality (The "Skill")
  const quality = await calculateQuality(agentId);
  
  // 3. Calculate Financial Risk
  const risk = await calculateFinancialRisk(agentId);
  
  // 4. Calculate Agent DNA
  const dna = await calculateAgentDNA(agentId);
  
  // 5. Calculate SLA Score (Composite)
  const slaScore = calculateSLAScore(availability, quality, risk);
  
  // 6. Determine Risk Level
  const riskLevel = determineRiskLevel(risk.slashCount, availability.uptime24h);
  
  // 7. Store in database
  const stats: AgentStats = {
    agentId,
    ...availability,
    ...quality,
    ...risk,
    ...dna,
    slaScore,
    riskLevel,
  };
  
  await upsertAgentStats(stats);
  
  return stats;
}

/**
 * Calculate Availability Metrics
 */
async function calculateAvailability(agentId: string): Promise<{
  uptime24h: number;
  uptime7d: number;
  uptime30d: number;
  meanTimeToReact: number;
  ghostingRate: number;
}> {
  const now = new Date();
  const day24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const day7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  // Calculate uptime for each period
  // Expected heartbeats: 1 per minute = 1440 per day
  const expected24h = 24 * 60; // 1440 minutes
  const expected7d = 7 * 24 * 60;
  const expected30d = 30 * 24 * 60;
  
  // Count actual heartbeats
  const [heartbeats24h] = await query(
    `SELECT COUNT(*) as count FROM agent_heartbeats 
     WHERE agent_id = $1 AND timestamp > $2`,
    [agentId, day24h]
  );
  const [heartbeats7d] = await query(
    `SELECT COUNT(*) as count FROM agent_heartbeats 
     WHERE agent_id = $1 AND timestamp > $2`,
    [agentId, day7d]
  );
  const [heartbeats30d] = await query(
    `SELECT COUNT(*) as count FROM agent_heartbeats 
     WHERE agent_id = $1 AND timestamp > $2`,
    [agentId, day30d]
  );
  
  const uptime24h = Math.min(100, (parseInt(heartbeats24h.count) / expected24h) * 100);
  const uptime7d = Math.min(100, (parseInt(heartbeats7d.count) / expected7d) * 100);
  const uptime30d = Math.min(100, (parseInt(heartbeats30d.count) / expected30d) * 100);
  
  // Calculate Mean Time to React (MTTR)
  // Average time between job assignment and acceptance
  const [mttrResult] = await query(
    `SELECT AVG(EXTRACT(EPOCH FROM (accepted_at - assigned_at)) * 1000) as avg_ms
     FROM job_history 
     WHERE agent_id = $1 AND accepted_at IS NOT NULL AND assigned_at IS NOT NULL
     AND assigned_at > $2`,
    [agentId, day30d]
  );
  const meanTimeToReact = Math.round(parseFloat(mttrResult.avg_ms || "0"));
  
  // Calculate Ghosting Rate
  // Jobs accepted but never completed (no completed_at, not cancelled)
  const [ghostedResult] = await query(
    `SELECT COUNT(*) as count FROM job_history 
     WHERE agent_id = $1 
     AND accepted_at IS NOT NULL 
     AND completed_at IS NULL 
     AND status != 'cancelled'
     AND assigned_at > $2`,
    [agentId, day30d]
  );
  const [totalAccepted] = await query(
    `SELECT COUNT(*) as count FROM job_history 
     WHERE agent_id = $1 
     AND accepted_at IS NOT NULL
     AND assigned_at > $2`,
    [agentId, day30d]
  );
  const ghostingRate = totalAccepted.count > 0 
    ? (parseInt(ghostedResult.count) / parseInt(totalAccepted.count)) * 100 
    : 0;
  
  return {
    uptime24h,
    uptime7d,
    uptime30d,
    meanTimeToReact,
    ghostingRate,
  };
}

/**
 * Calculate Quality Metrics
 */
async function calculateQuality(agentId: string): Promise<{
  completionRate: number;
  disputeRate: number;
  arbitrationWinRate: number;
  oneShotSuccessRate: number;
}> {
  const day30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  // Completion Rate
  const [totalAssigned] = await query(
    `SELECT COUNT(*) as count FROM job_history 
     WHERE agent_id = $1 AND assigned_at > $2`,
    [agentId, day30d]
  );
  const [completed] = await query(
    `SELECT COUNT(*) as count FROM job_history 
     WHERE agent_id = $1 AND status = 'completed' AND assigned_at > $2`,
    [agentId, day30d]
  );
  const completionRate = totalAssigned.count > 0
    ? (parseInt(completed.count) / parseInt(totalAssigned.count)) * 100
    : 0;
  
  // Dispute Rate
  const [disputed] = await query(
    `SELECT COUNT(*) as count FROM job_history 
     WHERE agent_id = $1 AND status = 'disputed' AND assigned_at > $2`,
    [agentId, day30d]
  );
  const disputeRate = completed.count > 0
    ? (parseInt(disputed.count) / parseInt(completed.count)) * 100
    : 0;
  
  // Arbitration Win Rate
  const [totalDisputes] = await query(
    `SELECT COUNT(*) as count FROM job_history 
     WHERE agent_id = $1 AND status = 'disputed' AND arbitration_result IS NOT NULL AND assigned_at > $2`,
    [agentId, day30d]
  );
  const [wins] = await query(
    `SELECT COUNT(*) as count FROM job_history 
     WHERE agent_id = $1 AND arbitration_result = 'agent_win' AND assigned_at > $2`,
    [agentId, day30d]
  );
  const arbitrationWinRate = totalDisputes.count > 0
    ? (parseInt(wins.count) / parseInt(totalDisputes.count)) * 100
    : 0;
  
  // One-Shot Success Rate (completed without disputes)
  const [oneShot] = await query(
    `SELECT COUNT(*) as count FROM job_history 
     WHERE agent_id = $1 AND status = 'completed' AND status != 'disputed' AND assigned_at > $2`,
    [agentId, day30d]
  );
  const oneShotSuccessRate = completed.count > 0
    ? (parseInt(oneShot.count) / parseInt(completed.count)) * 100
    : 0;
  
  return {
    completionRate,
    disputeRate,
    arbitrationWinRate,
    oneShotSuccessRate,
  };
}

/**
 * Calculate Financial Risk Metrics
 */
async function calculateFinancialRisk(agentId: string): Promise<{
  slashCount: number;
  totalValueSecured: string;
  retentionRate: number;
}> {
  // Slash Count (immutable - never decreases)
  const [slashResult] = await query(
    `SELECT COUNT(*) as count FROM job_history 
     WHERE agent_id = $1 AND slashed = true`,
    [agentId]
  );
  const slashCount = parseInt(slashResult.count);
  
  // Total Value Secured (TVS)
  const [tvsResult] = await query(
    `SELECT SUM(value_lamports::bigint) as total FROM job_history 
     WHERE agent_id = $1 AND status = 'completed'`,
    [agentId]
  );
  const totalValueSecured = tvsResult.total?.toString() || "0";
  
  // Retention Rate (% of job creators who hire more than once)
  const [uniqueClients] = await query(
    `SELECT COUNT(DISTINCT owner_pubkey) as count FROM job_history 
     WHERE agent_id = $1`,
    [agentId]
  );
  const [repeatClients] = await query(
    `SELECT COUNT(DISTINCT owner_pubkey) as count FROM (
      SELECT owner_pubkey FROM job_history 
      WHERE agent_id = $1 
      GROUP BY owner_pubkey 
      HAVING COUNT(*) > 1
    ) as repeaters`,
    [agentId]
  );
  const retentionRate = uniqueClients.count > 0
    ? (parseInt(repeatClients.count) / parseInt(uniqueClients.count)) * 100
    : 0;
  
  return {
    slashCount,
    totalValueSecured,
    retentionRate,
  };
}

/**
 * Calculate Agent DNA (Specialization, Compute Capacity)
 */
async function calculateAgentDNA(agentId: string): Promise<{
  specializationTag: string | null;
  computeBurstCapacity: number;
}> {
  // Get specialization from metadata (or infer from job types)
  const [metadata] = await query(
    `SELECT category FROM agent_registry_metadata WHERE agent_id = $1`,
    [agentId]
  );
  const specializationTag = metadata?.category || null;
  
  // Compute Burst Capacity (Peak TPS in last 24h)
  // Count jobs completed per hour, find peak
  const day24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [peakResult] = await query(
    `SELECT MAX(job_count) as peak FROM (
      SELECT COUNT(*) as job_count 
      FROM job_history 
      WHERE agent_id = $1 AND completed_at > $2
      GROUP BY DATE_TRUNC('hour', completed_at)
    ) as hourly`,
    [agentId, day24h]
  );
  const computeBurstCapacity = parseInt(peakResult.peak || "0");
  
  return {
    specializationTag,
    computeBurstCapacity,
  };
}

/**
 * Calculate SLA Score (Composite 0-100)
 * 40% Uptime, 40% Completion Rate, 20% Volume
 * -50 points per slash
 */
function calculateSLAScore(
  availability: { uptime24h: number },
  quality: { completionRate: number },
  risk: { slashCount: number }
): number {
  const uptimeScore = availability.uptime24h * 0.4;
  const completionScore = quality.completionRate * 0.4;
  const volumeScore = Math.min(100, risk.totalValueSecured ? 20 : 0); // Simplified
  
  let score = uptimeScore + completionScore + volumeScore;
  
  // Critical Deductor: -50 per slash
  score -= risk.slashCount * 50;
  
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Determine Risk Level
 */
function determineRiskLevel(slashCount: number, uptime24h: number): "Low" | "Medium" | "High" {
  if (slashCount > 0) return "High";
  if (uptime24h < 90) return "Medium";
  return "Low";
}

/**
 * Upsert agent stats to database
 */
async function upsertAgentStats(stats: AgentStats): Promise<void> {
  await query(
    `INSERT INTO agent_stats (
      agent_id, uptime_24h, uptime_7d, uptime_30d, mean_time_to_react_ms, ghosting_rate,
      completion_rate, dispute_rate, arbitration_win_rate, one_shot_success_rate,
      slash_count, total_value_secured, retention_rate,
      specialization_tag, compute_burst_capacity,
      sla_score, risk_level, last_updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW()
    )
    ON CONFLICT (agent_id) DO UPDATE SET
      uptime_24h = EXCLUDED.uptime_24h,
      uptime_7d = EXCLUDED.uptime_7d,
      uptime_30d = EXCLUDED.uptime_30d,
      mean_time_to_react_ms = EXCLUDED.mean_time_to_react_ms,
      ghosting_rate = EXCLUDED.ghosting_rate,
      completion_rate = EXCLUDED.completion_rate,
      dispute_rate = EXCLUDED.dispute_rate,
      arbitration_win_rate = EXCLUDED.arbitration_win_rate,
      one_shot_success_rate = EXCLUDED.one_shot_success_rate,
      slash_count = EXCLUDED.slash_count,
      total_value_secured = EXCLUDED.total_value_secured,
      retention_rate = EXCLUDED.retention_rate,
      specialization_tag = EXCLUDED.specialization_tag,
      compute_burst_capacity = EXCLUDED.compute_burst_capacity,
      sla_score = EXCLUDED.sla_score,
      risk_level = EXCLUDED.risk_level,
      last_updated_at = NOW()`,
    [
      stats.agentId,
      stats.uptime24h,
      stats.uptime7d,
      stats.uptime30d,
      stats.meanTimeToReact,
      stats.ghostingRate,
      stats.completionRate,
      stats.disputeRate,
      stats.arbitrationWinRate,
      stats.oneShotSuccessRate,
      stats.slashCount,
      stats.totalValueSecured,
      stats.retentionRate,
      stats.specializationTag,
      stats.computeBurstCapacity,
      stats.slaScore,
      stats.riskLevel,
    ]
  );
  
  logger.info(`[ANALYTICS] Updated stats for agent ${stats.agentId} - SLA: ${stats.slaScore}, Risk: ${stats.riskLevel}`);
}

/**
 * Record a heartbeat (called by mobile bridge /agent/status endpoint)
 */
export async function recordHeartbeat(agentId: string, jobId?: string, metadata?: any): Promise<void> {
  await query(
    `INSERT INTO agent_heartbeats (agent_id, job_id, metadata) VALUES ($1, $2, $3)`,
    [agentId, jobId || null, metadata ? JSON.stringify(metadata) : null]
  );
}

/**
 * Record a job assignment/completion
 */
export async function recordJob(
  jobId: string,
  agentId: string,
  ownerPubkey: string,
  jobType: string,
  valueLamports: string
): Promise<void> {
  await query(
    `INSERT INTO job_history (job_id, agent_id, owner_pubkey, job_type, status, value_lamports, assigned_at)
     VALUES ($1, $2, $3, $4, 'assigned', $5, NOW())
     ON CONFLICT (job_id) DO NOTHING`,
    [jobId, agentId, ownerPubkey, jobType, valueLamports]
  );
}

/**
 * Update job status
 */
export async function updateJobStatus(
  jobId: string,
  status: "accepted" | "completed" | "failed" | "cancelled" | "disputed",
  timestamp?: Date
): Promise<void> {
  const updateFields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;
  
  if (status === "accepted") {
    updateFields.push(`accepted_at = $${paramCount++}`);
    values.push(timestamp || new Date());
  } else if (status === "completed") {
    updateFields.push(`completed_at = $${paramCount++}`);
    values.push(timestamp || new Date());
  } else if (status === "disputed") {
    updateFields.push(`disputed_at = $${paramCount++}`);
    values.push(timestamp || new Date());
  }
  
  updateFields.push(`status = $${paramCount++}`);
  values.push(status);
  values.push(jobId);
  
  await query(
    `UPDATE job_history SET ${updateFields.join(", ")} WHERE job_id = $${paramCount}`,
    values
  );
}

