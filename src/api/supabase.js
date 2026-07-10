import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://nokasnxvxfjcgwbujefk.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_tsMGzQw8WAJeeYEI5-ybTg_H-1CUF7t';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * ── Helper Cloud Authentication APIs ──
 */

// Sign Up
export async function cloudSignUp(email, password, nickname) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: 'aniplay://auth/callback',
      data: {
        nickname: nickname || email.split('@')[0]
      }
    }
  });
  if (error) throw error;
  return data;
}

// Sign In
export async function cloudSignIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  return data;
}

// Sign Out
export async function cloudSignOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Get Session / Current User
export async function getCloudUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * ── Helper Cloud Watchlist / Progress Sync APIs ──
 */

// Fetch full watchlist & progress for logged in user
export async function fetchCloudWatchlist() {
  const user = await getCloudUser();
  if (!user) return [];
  
  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .eq('user_id', user.id);
    
  if (error) throw error;
  return data || [];
}

// Sync progress for a specific anime
export async function syncCloudProgress(animeId, status, favorite, progressObj) {
  const user = await getCloudUser();
  if (!user) return null;

  // Check if row already exists
  const { data: existing, error: checkError } = await supabase
    .from('watchlist')
    .select('id')
    .eq('user_id', user.id)
    .eq('anime_id', String(animeId))
    .maybeSingle();

  if (checkError) throw checkError;

  const payload = {
    user_id: user.id,
    anime_id: String(animeId),
    status: status || 'watching',
    favorite: !!favorite,
    progress: progressObj || {},
    updated_at: new Date().toISOString()
  };

  if (existing?.id) {
    // Update
    const { data, error } = await supabase
      .from('watchlist')
      .update(payload)
      .eq('id', existing.id)
      .select();
    if (error) throw error;
    return data;
  } else {
    // Insert
    const { data, error } = await supabase
      .from('watchlist')
      .insert([payload])
      .select();
    if (error) throw error;
    return data;
  }
}

/**
 * ── Helper User Profile APIs ──
 */

async function createUserProfile(userId, nickname) {
  const { error } = await supabase
    .from('user_profiles')
    .upsert({
      id: userId,
      nickname,
      created_at: new Date().toISOString()
    });
  if (error) console.error('[Supabase] Failed to create user profile:', error.message);
}

export async function fetchUserProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateUserNickname(nickname) {
  const user = await getCloudUser();
  if (!user) return;
  const { error } = await supabase
    .from('user_profiles')
    .upsert({
      id: user.id,
      nickname,
      created_at: new Date().toISOString()
    });
  if (error) throw error;
}

/**
 * ── Helper Comments APIs (Direct Supabase) ──
 */

export async function fetchCloudComments(animeId, episode) {
  const { data, error } = await supabase
    .from('comments')
    .select(`
      id,
      username,
      content,
      parent_id,
      created_at
    `)
    .eq('anime_id', String(animeId))
    .eq('episode', parseInt(episode, 10))
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function postCloudComment(animeId, episode, username, content, parentId = null) {
  const user = await getCloudUser();
  const payload = {
    anime_id: String(animeId),
    episode: parseInt(episode, 10),
    username: username || 'Anonymous',
    content,
    parent_id: parentId,
    user_id: user?.id || null
  };

  const { data, error } = await supabase
    .from('comments')
    .insert([payload])
    .select();

  if (error) throw error;
  return data;
}

export async function updateCloudRecentlyViewed(recentlyViewedArray) {
  const user = await getCloudUser();
  if (!user) return;
  const { error } = await supabase
    .from('user_profiles')
    .update({ recently_viewed: recentlyViewedArray })
    .eq('id', user.id);
  if (error) throw error;
}

export async function updateCloudSettings(settingsObj) {
  const user = await getCloudUser();
  if (!user) return;
  const { error } = await supabase
    .from('user_profiles')
    .update({ settings: settingsObj })
    .eq('id', user.id);
  if (error) throw error;
}
