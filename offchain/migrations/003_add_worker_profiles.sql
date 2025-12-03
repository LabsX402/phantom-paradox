-- Migration: Add worker profiles and job marketplace tables
-- Created for fiat payout support

-- Worker profiles table
CREATE TABLE IF NOT EXISTS worker_profiles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_pubkey TEXT UNIQUE NOT NULL,
  payout_method TEXT NOT NULL CHECK (payout_method IN ('SOL', 'USDC', 'PAYPAL', 'MPESA', 'UPI', 'ALIPAY')),
  payout_address TEXT NOT NULL,
  bid_price_lamports BIGINT NOT NULL DEFAULT 0,
  bid_price_usd_cents BIGINT NOT NULL DEFAULT 0,
  total_jobs INTEGER NOT NULL DEFAULT 0,
  total_earned BIGINT NOT NULL DEFAULT 0,
  avg_response_time INTEGER NOT NULL DEFAULT 0,
  success_rate_bps INTEGER NOT NULL DEFAULT 10000,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_profiles_user_pubkey ON worker_profiles(user_pubkey);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_payout_method ON worker_profiles(payout_method);

-- Completed jobs table (for tracking fiat payouts)
CREATE TABLE IF NOT EXISTS completed_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  job_pda TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  worker_pubkey TEXT NOT NULL,
  payment_amount_lamports BIGINT NOT NULL,
  payment_amount_usd_cents BIGINT NOT NULL,
  payout_method TEXT NOT NULL,
  fiat_paid BOOLEAN NOT NULL DEFAULT false,
  fiat_paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_completed_jobs_worker ON completed_jobs(worker_pubkey);
CREATE INDEX IF NOT EXISTS idx_completed_jobs_fiat_paid ON completed_jobs(fiat_paid, payout_method);
CREATE INDEX IF NOT EXISTS idx_completed_jobs_payout_method ON completed_jobs(payout_method);

-- Job postings table (for matching)
CREATE TABLE IF NOT EXISTS job_postings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  job_pda TEXT UNIQUE NOT NULL,
  job_giver TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  job_id BIGINT NOT NULL,
  price_per_worker_lamports BIGINT NOT NULL,
  price_per_worker_usd_cents BIGINT NOT NULL,
  max_workers INTEGER NOT NULL,
  workers_taken INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_postings_status ON job_postings(status);
CREATE INDEX IF NOT EXISTS idx_job_postings_agent_id ON job_postings(agent_id);

