-- ── AniPlay Notification System Migration ──
-- Run this in your Supabase SQL Editor.
-- Safe to run multiple times — uses IF NOT EXISTS guards.
-- ZERO data loss — only adds new columns/indexes.

-- ══════════════════════════════════════════════════════════════
-- 1. Add 'likes' count column to comments (4 bytes per row)
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS likes INTEGER NOT NULL DEFAULT 0;

-- ══════════════════════════════════════════════════════════════
-- 2. Add 'parent_id' for replies (if not already present)
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS parent_id BIGINT REFERENCES public.comments(id) ON DELETE CASCADE;

-- ══════════════════════════════════════════════════════════════
-- 3. Index for fast parent lookup (reply threads)
-- ══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_comments_parent_id
  ON public.comments(parent_id);

-- ══════════════════════════════════════════════════════════════
-- 4. Add 'notif_last_seen' to user_profiles.settings JSONB
--    (No new table needed — piggybacks on existing JSONB column)
--    Nothing to run here — handled client-side via settings upsert.
-- ══════════════════════════════════════════════════════════════

-- DONE. Your existing data is untouched.
-- New 'likes' column defaults to 0 for all existing comments.
