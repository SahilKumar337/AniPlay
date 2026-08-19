-- ═══════════════════════════════════════════════════════════════════════════
-- AniPlay — FCM Push Notifications Migration
-- Run this SQL in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 1: Add fcm_token column to user_profiles (if not already present)
-- This stores each user's unique Firebase Cloud Messaging device token
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS fcm_token TEXT DEFAULT NULL;

-- Step 2: Index for fast lookups when sending notifications
CREATE INDEX IF NOT EXISTS idx_user_profiles_fcm_token
  ON user_profiles(id)
  WHERE fcm_token IS NOT NULL;

-- Step 3: Verify notifications table has the correct columns
-- (If you get an error, your table already has the column — that's fine!)
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS target_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS actor_name TEXT;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'like';

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS comment_preview TEXT;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS anime_id TEXT;

-- Step 4: Index for fast per-user notification fetching
CREATE INDEX IF NOT EXISTS idx_notifications_target_user
  ON notifications(target_user_id, created_at DESC);

-- Step 5: Row Level Security (RLS) — users can only see their OWN notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own notifications
DROP POLICY IF EXISTS "Users can read own notifications" ON notifications;
CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = target_user_id);

-- Allow any authenticated user to INSERT notifications (for sending to others)
DROP POLICY IF EXISTS "Users can create notifications" ON notifications;
CREATE POLICY "Users can create notifications"
  ON notifications FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Allow users to update (mark as read) their own notifications
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = target_user_id);

-- Allow users to delete their own notifications
DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;
CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE
  USING (auth.uid() = target_user_id);

-- Allow service role (Edge Function) to read user_profiles for FCM tokens
DROP POLICY IF EXISTS "Service role can read profiles for FCM" ON user_profiles;
CREATE POLICY "Service role can read profiles for FCM"
  ON user_profiles FOR SELECT
  USING (true);  -- service_role bypasses RLS automatically, this is for anon reads

-- ═══════════════════════════════════════════════════════════════════════════
-- ✅ Done! Now follow the deployment steps in SETUP_GUIDE.md
-- ═══════════════════════════════════════════════════════════════════════════
