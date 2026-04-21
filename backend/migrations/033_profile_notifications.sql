-- Create profile_notifications table
CREATE TABLE IF NOT EXISTS profile_notifications (
    id TEXT PRIMARY KEY,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    title TEXT,
    body TEXT,
    type TEXT,
    channel TEXT,
    metadata JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_profile_notifications_recipient_id ON profile_notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_profile_notifications_created_at ON profile_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_notifications_unread ON profile_notifications(recipient_id) WHERE is_read = FALSE;
