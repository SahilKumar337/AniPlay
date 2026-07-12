-- Supabase Migration: Add nested replies support to comments table
-- RUN THIS IN YOUR SUPABASE SQL EDITOR

-- 1. Add self-referencing foreign key parent_id to support reply hierarchy
ALTER TABLE comments ADD COLUMN parent_id BIGINT REFERENCES comments(id) ON DELETE CASCADE;

-- 2. Create index on parent_id for fast lookup and cascade performance
CREATE INDEX idx_comments_parent_id ON comments(parent_id);
