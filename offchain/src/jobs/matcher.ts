/**
 * Job Matching Service
 * Automatically matches workers to open jobs based on ranking
 * Runs every 30 seconds
 */

import { query } from "../shared/db";
import { getProgram } from "../shared/solana";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { logger } from "../shared/logger";

// Helper to derive job PDA
function deriveJobPda(jobGiver: PublicKey, jobId: number): [PublicKey, number] {
  const jobIdBuffer = Buffer.allocUnsafe(8);
  jobIdBuffer.writeBigUInt64LE(BigInt(jobId), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("job"), jobGiver.toBuffer(), jobIdBuffer],
    getProgram().programId
  );
}

// Helper to derive assignment PDA
function deriveAssignmentPda(job: PublicKey, assignmentId: number): [PublicKey, number] {
  const assignmentIdBuffer = Buffer.allocUnsafe(8);
  assignmentIdBuffer.writeBigUInt64LE(BigInt(assignmentId), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("job_assignment"), job.toBuffer(), assignmentIdBuffer],
    getProgram().programId
  );
}

/**
 * Get all open jobs from database
 */
async function getOpenJobs() {
  const result = await query(
    `SELECT * FROM job_postings 
     WHERE status = 'OPEN' 
     AND (expires_at IS NULL OR expires_at > NOW())
     AND workers_taken < max_workers`
  );
  return result.rows;
}

/**
 * Get all active workers from database
 */
async function getWorkers() {
  const result = await query(
    `SELECT * FROM worker_profiles`
  );
  return result.rows;
}

/**
 * Calculate worker score for ranking
 */
function calculateWorkerScore(worker: any): number {
  const successRate = worker.success_rate_bps / 10000;
  const jobCount = Math.log(worker.total_jobs + 1);
  const responseTime = worker.avg_response_time || 100000;
  const responseScore = 100000 / responseTime; // lower = better
  
  return successRate * jobCount * responseScore;
}

/**
 * Match workers to a job
 */
async function matchWorkersToJob(job: any) {
  const workers = await getWorkers();
  
  // Filter workers by price (must be <= job price)
  const candidates = workers
    .filter((w: any) => {
      // Check if worker's bid price is acceptable
      const priceMatch = 
        (job.price_per_worker_lamports > 0 && w.bid_price_lamports <= job.price_per_worker_lamports) ||
        (job.price_per_worker_usd_cents > 0 && w.bid_price_usd_cents <= job.price_per_worker_usd_cents);
      
      return priceMatch;
    })
    .map((w: any) => ({
      ...w,
      score: calculateWorkerScore(w),
    }))
    .sort((a: any, b: any) => b.score - a.score); // Sort by score descending

  // Get number of workers needed
  const workersNeeded = job.max_workers - job.workers_taken;
  const topWorkers = candidates.slice(0, workersNeeded);

  logger.info(`Matched ${topWorkers.length} workers to job ${job.job_pda}`, {
    jobId: job.job_id,
    workersNeeded,
    candidatesCount: candidates.length,
  });

  return topWorkers;
}

/**
 * Assign job to worker on-chain
 */
async function assignJobToWorker(jobPda: string, workerPubkey: string, assignmentId: number) {
  try {
    const program = getProgram();
    const jobPubkey = new PublicKey(jobPda);
    const workerPubkeyKey = new PublicKey(workerPubkey);
    
    const [assignmentPda] = deriveAssignmentPda(jobPubkey, assignmentId);

    // Call on-chain take_job instruction
    const tx = await program.methods
      .takeJob(new BN(assignmentId))
      .accounts({
        worker: workerPubkeyKey,
        job: jobPubkey,
        assignment: assignmentPda,
        systemProgram: PublicKey.default, // Will be replaced by Anchor
      })
      .rpc();

    logger.info(`Assigned job to worker`, {
      jobPda,
      workerPubkey,
      assignmentId,
      tx,
    });

    return tx;
  } catch (error: any) {
    logger.error(`Failed to assign job to worker`, {
      error,
      jobPda,
      workerPubkey,
      assignmentId,
    });
    throw error;
  }
}

/**
 * Main matching function - runs every 30 seconds
 */
export async function matchJobs() {
  try {
    const openJobs = await getOpenJobs();
    
    if (openJobs.length === 0) {
      logger.debug("No open jobs to match");
      return;
    }

    logger.info(`Matching workers to ${openJobs.length} open jobs`);

    for (const job of openJobs) {
      try {
        const matchedWorkers = await matchWorkersToJob(job);
        
        // Auto-assign top ranked workers
        let assignmentId = job.workers_taken;
        for (const worker of matchedWorkers) {
          try {
            await assignJobToWorker(job.job_pda, worker.user_pubkey, assignmentId);
            
            // Update database
            await query(
              `UPDATE job_postings 
               SET workers_taken = workers_taken + 1 
               WHERE job_pda = $1`,
              [job.job_pda]
            );
            
            assignmentId++;
          } catch (error: any) {
            logger.error(`Failed to assign job to worker ${worker.user_pubkey}`, {
              error,
              jobPda: job.job_pda,
            });
            // Continue with next worker
          }
        }
      } catch (error: any) {
        logger.error(`Failed to match workers to job ${job.job_pda}`, {
          error,
          jobId: job.job_id,
        });
        // Continue with next job
      }
    }
  } catch (error: any) {
    logger.error("Job matching failed", { error });
  }
}

/**
 * Start the job matching service
 * Runs every 30 seconds
 */
export function startJobMatcher() {
  logger.info("Starting job matching service (runs every 30 seconds)");
  
  // Run immediately
  matchJobs();
  
  // Then run every 30 seconds
  setInterval(() => {
    matchJobs();
  }, 30000);
}

