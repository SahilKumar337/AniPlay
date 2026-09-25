import { createClient } from '@supabase/supabase-js';

const supabaseUrl     = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL)     || 'https://mvegjpstqfakfyvqmjaa.supabase.co';
const supabaseAnonKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || 'sb_publishable_x012bKrRN9TDkreJb6sAZg_amEfWIIf';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Persist session in localStorage so getSession() is always local (no network)
    persistSession: true,
    detectSessionInUrl: false,
    // Use PKCE so deep-link auth works correctly on Android
    flowType: 'pkce',
  },
  // Disable Realtime entirely — we don't use it and it generates constant egress
  realtime: { params: { eventsPerSecond: 0 } },
  global: {
    headers: { 'x-client-info': 'aniplay-android' },
  },
});

/* ── getLocalUser ──────────────────────────────────────────────────
   Reads the cached session from localStorage — NO network request.
   Use this in all write helpers instead of supabase.auth.getUser()
   which hits the Supabase auth server every call.
──────────────────────────────────────────────────────────────────── */
async function getLocalUser() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user ?? null;
  } catch (_) {
    return null;
  }
}

// Legacy export — now uses local cache instead of network
export async function getCloudUser() {
  return getLocalUser();
}

/**
 * ── Auth APIs ──
 */
export async function cloudSignUp(email, password, nickname) {
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPassword = (password || '').trim();
  const cleanNick = (nickname || cleanEmail.split('@')[0] || 'User').trim().slice(0, 25);

  if (!cleanEmail || !cleanPassword) throw new Error('Email and password are required.');
  if (cleanPassword.length < 6) throw new Error('Password should be at least 6 characters.');

  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password: cleanPassword,
    options: {
      emailRedirectTo: 'aniplay://auth/callback',
      data: { nickname: cleanNick }
    }
  });
  if (error) throw error;
  return data;
}

export async function cloudSignIn(email, password) {
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPassword = (password || '').trim();
  if (!cleanEmail || !cleanPassword) throw new Error('Email and password are required.');

  let { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password: cleanPassword });

  // Android keyboard autofill often appends trailing whitespace, adds autocapitalization,
  // or changes special characters. Retry with trimmed password if first attempt failed.
  if (error && error.message?.includes('Invalid login credentials')) {
    const rawPw = password || '';
    if (rawPw !== cleanPassword) {
      const retry = await supabase.auth.signInWithPassword({ email: cleanEmail, password: rawPw });
      if (!retry.error) return retry.data;
    }
  }

  if (error) throw error;
  return data;
}

export async function cloudResetPassword(email) {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail) throw new Error('Email address is required.');

  const { data, error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo: 'aniplay://auth/callback'
  });
  if (error) throw error;
  return data;
}

export async function cloudUpdatePassword(newPassword) {
  const cleanPassword = (newPassword || '').trim();
  if (!cleanPassword || cleanPassword.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const { data, error } = await supabase.auth.updateUser({ password: cleanPassword });
  if (error) throw error;
  return data;
}

export async function cloudSignOut() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) console.warn('[Supabase] Remote signOut returned error:', error.message);
  } catch (err) {
    console.warn('[Supabase] Remote signOut failed (likely offline):', err.message);
  } finally {
    // Unconditionally purge all Supabase auth tokens from localStorage and sessionStorage
    // Ensures user is always logged out locally even during network partitions or offline mode.
    try {
      if (typeof localStorage !== 'undefined') {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('sb-') || k.includes('auth-token') || k === 'aniplay_last_sync_at')) {
            localStorage.removeItem(k);
          }
        }
      }
      if (typeof sessionStorage !== 'undefined') {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const k = sessionStorage.key(i);
          if (k && (k.startsWith('sb-') || k.includes('auth-token'))) {
            sessionStorage.removeItem(k);
          }
        }
      }
      // Also purge any cached Capacitor Preferences cloud credentials
      try {
        const { Preferences } = await import('@capacitor/preferences');
        await Preferences.remove({ key: 'aniplay_cloud_credentials' }).catch(() => {});
      } catch (_) {}
    } catch (_) {}
  }
}

/**
 * ── Watchlist ──
 *
 * EGRESS OPTIMIZATION:
 *   • Only select the columns we actually use (not select('*'))
 *   • Accept an optional `since` ISO timestamp → only fetches rows updated
 *     after that time (incremental sync instead of full table download)
 */
export async function fetchCloudWatchlist(since = null) {
  const user = await getLocalUser();
  if (!user) return [];

  let query = supabase
    .from('watchlist')
    .select('anime_id, status, favorite, progress, updated_at')   // ← no select('*')
    .eq('user_id', user.id);

  if (since) {
    query = query.gt('updated_at', since);                         // ← incremental sync
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Sync a single anime's progress (used from AnimePage / player on episode change).
 * Uses local session — no extra auth network call.
 */
export async function syncCloudProgress(animeId, status, favorite, progressObj) {
  const user = await getLocalUser();
  if (!user) return null;

  // Check if row exists (select only 'id' — minimal egress)
  const { data: existing, error: checkError } = await supabase
    .from('watchlist')
    .select('id')
    .eq('user_id', user.id)
    .eq('anime_id', String(animeId))
    .maybeSingle();

  if (checkError) throw checkError;

  const payload = {
    user_id:    user.id,
    anime_id:   String(animeId),
    status:     status || 'watching',
    favorite:   !!favorite,
    // ── EGRESS OPTIMIZATION: store ONLY episode + timestamp, not anime metadata.
    // Anime metadata (title, cover, genres etc.) is stored locally and fetched from AniList.
    // Storing it here was ~450 bytes/row per sync — removed to save bandwidth.
    progress:   { episode: progressObj?.episode ?? null, timestamp: progressObj?.timestamp ?? null },
    updated_at: new Date().toISOString()
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from('watchlist')
      .update(payload)
      .eq('id', existing.id)
      .select('id');              // ← only return id, not full row
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await supabase
      .from('watchlist')
      .insert([payload])
      .select('id');              // ← only return id
    if (error) throw error;
    return data;
  }
}

/**
 * ── One-time bulk backup on app update ──────────────────────────────────────
 *
 * Triggered once per version bump (gated by versionCode in Capacitor Preferences).
 * Algorithm:
 *   1. Fetch only existing anime_ids from Supabase (select 'anime_id' only → minimal egress ~1 byte/row)
 *   2. Diff against local watchlist/progress to find entries NOT yet in cloud
 *   3. Bulk-upsert only the missing rows (writes = free, tiny response egress)
 *
 * EGRESS IMPACT:
 *   • Step 1 read:  ~10 bytes × N rows (e.g. 100 anime → ~1KB egress, once per update)
 *   • Step 3 write: free (uploads are not egress)
 *   • Write responses: ~200 bytes total
 *   Net: ~1–2 KB egress per user per update — completely negligible.
 */
export async function backupLocalDataOnUpdate(watchlist = {}, progress = {}, favorites = {}) {
  const user = await getLocalUser();
  if (!user) return { backed_up: 0, skipped: 0 };

  try {
    // Step 1: Fetch only the anime_ids already in Supabase for this user (minimal egress)
    const { data: existing, error: fetchError } = await supabase
      .from('watchlist')
      .select('anime_id')          // ← only 1 column, ~10 bytes per row
      .eq('user_id', user.id);

    if (fetchError) throw fetchError;

    const existingIds = new Set((existing || []).map(r => String(r.anime_id)));

    // Step 2: Build rows for anime that are NOT yet in Supabase
    const rows = [];
    const allLocalIds = new Set([
      ...Object.keys(watchlist),
      ...Object.keys(progress),
    ]);

    for (const id of allLocalIds) {
      if (existingIds.has(String(id))) continue; // already synced — skip

      const wEntry  = watchlist[id];
      const pEntry  = progress[id];
      const isFav   = !!favorites[id];

      rows.push({
        user_id:    user.id,
        anime_id:   String(id),
        status:     wEntry?.status || 'watching',
        favorite:   isFav,
        progress: {
          episode:   pEntry?.episode  ?? null,
          timestamp: pEntry?.timestamp ?? null,
        },
        updated_at: new Date().toISOString(),
      });
    }

    if (rows.length === 0) {
      console.log('[Backup] All local data already in Supabase — nothing to upload.');
      return { backed_up: 0, skipped: existingIds.size };
    }

    // Step 3: Bulk upsert in chunks of 50 to avoid request size limits
    const CHUNK = 50;
    let uploaded = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error: upsertError } = await supabase
        .from('watchlist')
        .upsert(chunk, { onConflict: 'user_id,anime_id', ignoreDuplicates: true });
      if (upsertError) {
        console.warn('[Backup] Chunk upsert error:', upsertError.message);
      } else {
        uploaded += chunk.length;
      }
    }

    console.log(`[Backup] ✅ Backed up ${uploaded} new entries (${existingIds.size} were already synced)`);
    return { backed_up: uploaded, skipped: existingIds.size };
  } catch (err) {
    console.warn('[Backup] backupLocalDataOnUpdate failed silently:', err.message);
    return { backed_up: 0, skipped: 0 };
  }
}

/**
 * ── User Profile ──
 *
 * EGRESS OPTIMIZATION:
 *   • Separate "lightweight" fetch (settings + nickname only, no recently_viewed)
 *     used on every sync startup — recently_viewed is stored locally, not re-downloaded
 *   • Full fetch (with recently_viewed) only on first install / explicit restore
 */
export async function fetchUserProfile(userId, { includeRecentlyViewed = false } = {}) {
  const cols = includeRecentlyViewed
    ? 'id, nickname, avatar_url, settings, recently_viewed'
    : 'id, nickname, avatar_url, settings';          // ← skip recently_viewed blob normally

  const { data, error } = await supabase
    .from('user_profiles')
    .select(cols)
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createUserProfile(userId, nickname, extraFields = {}) {
  const { error } = await supabase
    .from('user_profiles')
    .upsert({ id: userId, nickname, created_at: new Date().toISOString(), ...extraFields });
  if (error) console.error('[Supabase] Failed to create user profile:', error.message);
}

export async function updateUserNickname(nickname) {
  const user = await getLocalUser();
  if (!user) return;
  const { error } = await supabase
    .from('user_profiles')
    .upsert({ id: user.id, nickname, created_at: new Date().toISOString() });
  if (error) throw error;
}

/**
 * ── Comments ──
 *
 * EGRESS OPTIMIZATION:
 *   • Client-side TTL cache (5 minutes) — popular anime pages won't re-fetch
 *     comments on every navigation back
 *   • Already uses minimal columns (not select('*'))
 */
const _commentCache = new Map(); // key: `${animeId}:${offset}` → { data, count, ts }
const COMMENT_TTL_MS = 15 * 60 * 1000; // 15 min — egress-safe; cache invalidated on new comment post

export async function fetchCloudComments(animeId, offset = 0) {
  const cacheKey = `${animeId}:${offset}`;
  const cached   = _commentCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < COMMENT_TTL_MS) {
    return { data: cached.data, count: cached.count };
  }

  const PAGE_SIZE = 20;
  const { data, count, error } = await supabase
    .from('comments')
    .select('id, username, content, parent_id, created_at, likes_count, user_id', { count: 'estimated' })
    .eq('anime_id', String(animeId))
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) throw error;
  const result = { data: data || [], count: count || 0 };
  _commentCache.set(cacheKey, { ...result, ts: Date.now() });
  return result;
}

export function invalidateCommentCache(animeId) {
  // Clear all cached pages for this anime (called after posting a new comment)
  for (const key of _commentCache.keys()) {
    if (key.startsWith(`${animeId}:`)) _commentCache.delete(key);
  }
}

// Comments are anime-level discussion (episode 0) or episode-specific
export async function postCloudComment(animeId, username, content, parentId = null, episode = 0) {
  const user = await getLocalUser();
  const payload = {
    anime_id:    String(animeId),
    episode:     Number(episode) || 0, // DB has NOT NULL constraint on episode; 0 = general discussion
    username:    username || 'Anonymous',
    content,
    parent_id:   parentId || null,
    user_id:     user?.id || null,
    likes:       0,
    likes_count: 0,
  };

  const { data, error } = await supabase
    .from('comments')
    .insert([payload])
    .select('id, username, content, parent_id, created_at, likes_count, user_id');

  if (error) throw error;
  invalidateCommentCache(animeId);

  // If this is a reply to another comment, notify the parent comment's author
  if (parentId) {
    try {
      const { data: parentComment } = await supabase
        .from('comments')
        .select('user_id, username, content, anime_id')
        .eq('id', parentId)
        .maybeSingle();

      if (parentComment?.user_id && parentComment.user_id !== user?.id) {
        const actorName = username || user?.user_metadata?.username || user?.user_metadata?.name || 'Someone';
        await supabase.from('notifications').insert([{
          target_user_id: parentComment.user_id,
          actor_name: actorName,
          type: 'reply',
          comment_preview: content.slice(0, 100),
          anime_id: String(animeId),
          is_read: false,
        }]);
      }
    } catch (notifErr) {
      console.warn('[Comments] Failed to create reply notification:', notifErr.message);
    }
  }

  return data;
}

/**
 * Toggle like on a comment.
 *
 * Strategy (zero extra READ egress):
 *  - likes_count on the comments row   → shown to all users, already fetched with comment data
 *  - comment_likes table               → records who liked what (tiny writes only, no extra reads)
 *  - localStorage likedComments        → tells current user if THEY already liked (zero egress)
 *
 * isLiking=true  → INSERT into comment_likes + increment likes_count via RPC
 * isLiking=false → DELETE from comment_likes + decrement likes_count via RPC
 */
export async function toggleCommentLike(commentId, isLiking) {
  const user = await getLocalUser();

  // Stable anonymous device ID — persisted in localStorage so the same device
  // can't double-like even without an account.
  let deviceId = localStorage.getItem('aniplay_device_id');
  if (!deviceId) {
    deviceId = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    localStorage.setItem('aniplay_device_id', deviceId);
  }

  if (isLiking) {
    // Record the like (ignoreDuplicates = safe to call multiple times)
    supabase.from('comment_likes').insert([{
      comment_id: commentId,
      user_id:    user?.id   || null,
      device_id:  deviceId,
    }]).then(() => {}).catch(() => {}); // fire-and-forget

    // Notify the comment author that someone liked their comment
    try {
      const { data: targetComment } = await supabase
        .from('comments')
        .select('user_id, content, anime_id')
        .eq('id', commentId)
        .maybeSingle();

      if (targetComment?.user_id && targetComment.user_id !== user?.id) {
        const actorName = user?.user_metadata?.username || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Someone';
        await supabase.from('notifications').insert([{
          target_user_id: targetComment.user_id,
          actor_name: actorName,
          type: 'like',
          comment_preview: (targetComment.content || 'your comment').slice(0, 100),
          anime_id: String(targetComment.anime_id),
          is_read: false,
        }]);
      }
    } catch (notifErr) {
      console.warn('[Comments] Failed to create like notification:', notifErr.message);
    }

    // Atomic increment of likes_count
    const { error } = await supabase.rpc('increment_comment_likes', { comment_id_param: commentId });
    if (error) throw error;
  } else {
    // Remove the like record — match by device_id OR user_id to cover both anon + logged-in
    const q = supabase.from('comment_likes').delete().eq('comment_id', commentId);
    if (user?.id) {
      q.or(`device_id.eq.${deviceId},user_id.eq.${user.id}`);
    } else {
      q.eq('device_id', deviceId);
    }
    q.then(() => {}).catch(() => {}); // fire-and-forget

    // Atomic decrement of likes_count (floors at 0)
    const { error } = await supabase.rpc('decrement_comment_likes', { comment_id_param: commentId });
    if (error) throw error;
  }
}

/**
 * ── Profile field updates ──
 * These write small payloads — no optimization needed beyond local user.
 */

// Throttle gate — write recently_viewed to cloud at most once every 5 minutes.
// Heavy users browse many anime pages; without this, every page visit triggers a DB write.
let _lastRecentlyViewedWrite = 0;
const RECENTLY_VIEWED_WRITE_INTERVAL = 5 * 60 * 1000; // 5 minutes

export async function updateCloudRecentlyViewed(recentlyViewedArray) {
  const user = await getLocalUser();
  if (!user) return;

  // Skip write if we wrote less than 5 minutes ago (local state is always current anyway)
  const now = Date.now();
  if (now - _lastRecentlyViewedWrite < RECENTLY_VIEWED_WRITE_INTERVAL) return;
  _lastRecentlyViewedWrite = now;

  // Store minimal anime stub (id, title, coverImage), episode, and timestamp (~100B per item, ~1.5KB total)
  const slim = (recentlyViewedArray || []).slice(0, 15).map(item => ({
    anime: item?.anime ? {
      id: item.anime.id,
      title: { romaji: item.anime.title?.romaji || item.anime.title?.english || item.anime.title?.native || '' },
      coverImage: { medium: item.anime.coverImage?.medium || item.anime.coverImage?.large || '' },
    } : null,
    episode: item?.episode || 1,
    timestamp: item?.timestamp || 0,
  })).filter(x => x.anime?.id);

  const { error } = await supabase
    .from('user_profiles')
    .update({ recently_viewed: slim })
    .eq('id', user.id);
  if (error) throw error;
}

// Only these 5 settings keys are synced to Supabase — everything else is local-only.
// This cuts settings payload from ~800B to ~120B and prevents local-only prefs (volume,
// subtitle tweaks, etc.) from polluting cross-device sync.
const CLOUD_SETTINGS_KEYS = ['darkMode', 'accentColor', 'autoplay', 'preferredServer', 'subtitleFontSize'];

export async function updateCloudSettings(settingsObj) {
  const user = await getLocalUser();
  if (!user) return;
  // Build a slim object with only the 5 synced keys + updatedAt timestamp
  const slim = {};
  CLOUD_SETTINGS_KEYS.forEach(k => { if (settingsObj[k] !== undefined) slim[k] = settingsObj[k]; });
  slim.updatedAt = settingsObj.updatedAt || Date.now();
  const { error } = await supabase
    .from('user_profiles')
    .update({ settings: slim })
    .eq('id', user.id);
  if (error) throw error;
}

export async function saveAvatarToProfile(avatarValue) {
  const user = await getLocalUser();
  if (!user) return;
  const { error } = await supabase
    .from('user_profiles')
    .update({ avatar_url: avatarValue })
    .eq('id', user.id);
  if (error) throw error;
}

/**
 * ── Notifications ──
 */
export async function createNotification({ targetUserId, actorName, type, commentPreview, animeId }) {
  if (!targetUserId) return;
  try {
    await supabase.from('notifications').insert([{
      user_id:         targetUserId,
      actor_name:      actorName || 'Someone',
      type:            type || 'like',
      comment_preview: commentPreview || null,
      anime_id:        animeId || null,
      read:            false,
      created_at:      new Date().toISOString()
    }]);
  } catch (_) {
    // Silently ignore — notifications table may not exist yet
  }
}
