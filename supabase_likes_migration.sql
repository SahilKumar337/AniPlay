-- AniPlay Comment Likes Migration
-- Run this in Supabase SQL Editor (NEW server: mvegjpstqfakfyvqmjaa)
-- 
-- Purpose: Add likes_count column to comments table + atomic RPC functions
-- Egress impact: ZERO — likes_count is fetched as part of existing comment rows
-- Storage: ~4 bytes per comment row (negligible)

-- 1. Add likes_count column (safe if already exists)
ALTER TABLE comments ADD COLUMN IF NOT EXISTS likes_count INTEGER DEFAULT 0 NOT NULL;

-- 2. Update migrated old comments to have 0 likes (already default, just safety)
UPDATE comments SET likes_count = 0 WHERE likes_count IS NULL;

-- 3. Atomic increment (safe for concurrent likes — no race condition)
CREATE OR REPLACE FUNCTION increment_comment_likes(comment_id_param BIGINT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE comments 
  SET likes_count = likes_count + 1 
  WHERE id = comment_id_param;
END;
$$;

-- 4. Atomic decrement (floors at 0, never goes negative)
CREATE OR REPLACE FUNCTION decrement_comment_likes(comment_id_param BIGINT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE comments 
  SET likes_count = GREATEST(0, likes_count - 1) 
  WHERE id = comment_id_param;
END;
$$;

-- 5. Grant execute permissions to anon and authenticated users
GRANT EXECUTE ON FUNCTION increment_comment_likes(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION decrement_comment_likes(BIGINT) TO anon, authenticated;

-- Verify:
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'comments' AND column_name = 'likes_count';
