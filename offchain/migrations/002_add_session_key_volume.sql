-- Migration: Add session key volume tracking and nonce index
-- Created: 2025-01-29
-- Purpose: Fix M-3 (Session Key Volume Persistence) and H-2 (Nonce Replay Protection)

-- Create session_key_volume table for persistent volume tracking
CREATE TABLE IF NOT EXISTS session_key_volume (
  owner_pubkey TEXT NOT NULL,
  session_pubkey TEXT NOT NULL,
  volume_spent TEXT NOT NULL, -- bigint as string
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (owner_pubkey, session_pubkey)
);

CREATE INDEX IF NOT EXISTS idx_session_key_volume_updated ON session_key_volume(updated_at);

-- Add nonce index to trade_intents for nonce replay protection
CREATE INDEX IF NOT EXISTS idx_trade_intents_session_nonce 
ON trade_intents(session_pubkey, nonce) 
WHERE nonce IS NOT NULL;

-- Add comment
COMMENT ON TABLE session_key_volume IS 'Persistent tracking of session key volume limits to prevent bypass on service restart';

