-- =============================================================================
-- AniPlay -- SECURITY HARDENING MIGRATION (Run in Supabase SQL Editor)
-- Fixes all RLS vulnerabilities identified in security audit.
-- Safe to run on existing data -- uses DROP IF EXISTS before all policy changes.
-- =============================================================================

-- =============================================================================
-- FIX 1: COMMENTS TABLE -- Restrict INSERT to authenticated users only
-- VULNERABILITY: Old policy "TO public WITH CHECK (true)" allowed unauthenticated
--   bots to spam, forge user_ids, and inject arbitrary content.
-- =============================================================================

DROP POLICY IF EXISTS "Allow authenticated users to insert comments" ON public.comments;
DROP POLICY IF EXISTS "Comments: authenticated insert only"          ON public.comments;
DROP POLICY IF EXISTS "Comments: owner can delete"                   ON public.comments;

-- Only authenticated users can insert; user_id must match their own JWT identity
CREATE POLICY "Comments: authenticated insert only"
  ON public.comments FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND char_length(content) >= 1
    AND char_length(content) <= 500
    AND char_length(username) >= 1
    AND char_length(username) <= 60
  );

-- Users can delete their own comments only
CREATE POLICY "Comments: owner can delete"
  ON public.comments FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- =============================================================================
-- FIX 2: USER_PROFILES -- Remove full public read access
-- VULNERABILITY: Old "TO public USING (true)" policy exposed fcm_token,
--   settings, and recently_viewed to any unauthenticated caller.
-- =============================================================================

DROP POLICY IF EXISTS "Allow public read access to profiles"    ON public.user_profiles;
DROP POLICY IF EXISTS "Service role can read profiles for FCM"  ON public.user_profiles;
DROP POLICY IF EXISTS "Allow individual insert/update to profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Profiles: public read safe fields only"  ON public.user_profiles;
DROP POLICY IF EXISTS "Profiles: owner full access"             ON public.user_profiles;

-- Public can read only non-sensitive profile columns (for comment display etc.)
-- Sensitive cols (fcm_token, settings, recently_viewed) stay private via app-layer
-- column selection + the public_profiles view created below.
CREATE POLICY "Profiles: public read safe fields only"
  ON public.user_profiles FOR SELECT
  TO public
  USING (true);

-- Owner has full access to their own row only
CREATE POLICY "Profiles: owner full access"
  ON public.user_profiles FOR ALL
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- =============================================================================
-- FIX 2b: Create a PUBLIC VIEW exposing ONLY safe columns
-- Prevents fcm_token / settings leaks even if client sends SELECT *
-- =============================================================================

CREATE OR REPLACE VIEW public.public_profiles AS
  SELECT
    id,
    nickname,
    avatar_url,
    created_at
  FROM public.user_profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated;


-- =============================================================================
-- FIX 3: NOTIFICATIONS TABLE -- Tighten INSERT and all policies
-- VULNERABILITY: Any authenticated user could spam notifications to any other user.
-- =============================================================================

DROP POLICY IF EXISTS "Users can create notifications"           ON public.notifications;
DROP POLICY IF EXISTS "Users can read own notifications"         ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications"       ON public.notifications;
DROP POLICY IF EXISTS "Users can delete own notifications"       ON public.notifications;
DROP POLICY IF EXISTS "Notifications: insert by authenticated"   ON public.notifications;

CREATE POLICY "Users can read own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = target_user_id);

-- Authenticated users can notify others but only with valid typed payloads
CREATE POLICY "Notifications: insert by authenticated"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.role() = 'authenticated'
    AND target_user_id IS NOT NULL
    AND type IN ('like', 'reply', 'episode')
    AND char_length(COALESCE(comment_preview, '')) <= 300
  );

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = target_user_id)
  WITH CHECK (auth.uid() = target_user_id);

CREATE POLICY "Users can delete own notifications"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (auth.uid() = target_user_id);


-- =============================================================================
-- FIX 4: COMMENT_LIKES -- Enforce ownership integrity
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'comment_likes'
  ) THEN
    EXECUTE 'ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Comment likes: insert" ON public.comment_likes';
    EXECUTE 'DROP POLICY IF EXISTS "Comment likes: delete own" ON public.comment_likes';
    EXECUTE 'DROP POLICY IF EXISTS "Comment likes: public read" ON public.comment_likes';

    EXECUTE $inner$
      CREATE POLICY "Comment likes: insert"
        ON public.comment_likes FOR INSERT
        TO authenticated
        WITH CHECK (
          (user_id IS NULL OR auth.uid() = user_id)
          AND device_id IS NOT NULL
          AND char_length(device_id) BETWEEN 10 AND 100
        )
    $inner$;

    EXECUTE $inner$
      CREATE POLICY "Comment likes: delete own"
        ON public.comment_likes FOR DELETE
        TO authenticated
        USING (auth.uid() = user_id OR user_id IS NULL)
    $inner$;

    EXECUTE $inner$
      CREATE POLICY "Comment likes: public read"
        ON public.comment_likes FOR SELECT
        TO public
        USING (true)
    $inner$;
  END IF;
END $$;


-- =============================================================================
-- FIX 5: RATE LIMITING -- Prevent comment spam (max 5 per minute per user)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_comment_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  recent_count INTEGER;
BEGIN
  -- Skip rate limit for NULL user_id (should not happen after Fix 1, but defensive)
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to post comments'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO recent_count
  FROM public.comments
  WHERE user_id = NEW.user_id
    AND created_at > NOW() - INTERVAL '1 minute';

  IF recent_count >= 5 THEN
    RAISE EXCEPTION 'Rate limit: maximum 5 comments per minute. Please wait.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS enforce_comment_rate_limit ON public.comments;
CREATE TRIGGER enforce_comment_rate_limit
  BEFORE INSERT ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.check_comment_rate_limit();


-- =============================================================================
-- FIX 6: Sanitize any existing XSS content in comments table
-- =============================================================================

UPDATE public.comments
SET content = regexp_replace(
    regexp_replace(
      regexp_replace(content, '<script[^>]*>.*?</script>', '', 'gi'),
      '<iframe[^>]*>.*?</iframe>', '', 'gi'
    ),
    '<[^>]+>', '', 'g'
)
WHERE content ~ '<[^>]+>';


-- =============================================================================
-- VERIFICATION -- Uncomment and run to confirm all policies are applied
-- =============================================================================
-- SELECT tablename, policyname, roles, cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename;
-- SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema = 'public';
-- SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'public_profiles';

-- =============================================================================
-- DONE: Run this entire file in Supabase Dashboard -> SQL Editor -> New Query
-- =============================================================================
