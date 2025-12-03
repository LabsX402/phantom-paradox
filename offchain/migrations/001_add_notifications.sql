-- Migration: Add notifications and user_preferences tables
-- Created: 2025-01-29
-- Purpose: Support user notification system

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('intent_skipped', 'batch_settled', 'batch_failed', 'listing_created', 'auction_settled', 'partial_fill')),
  message TEXT NOT NULL,
  data JSONB,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- Create user_preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  webhook_url TEXT,
  email TEXT,
  push_token TEXT,
  email_enabled BOOLEAN DEFAULT TRUE,
  push_enabled BOOLEAN DEFAULT TRUE,
  webhook_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_email ON user_preferences(email) WHERE email IS NOT NULL;

-- Add comment
COMMENT ON TABLE notifications IS 'User notifications for intents, batches, and listings';
COMMENT ON TABLE user_preferences IS 'User notification preferences and contact information';

