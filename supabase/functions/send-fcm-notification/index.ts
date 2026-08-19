/**
 * AniPlay — Supabase Edge Function: send-fcm-notification
 * Uses Firebase Cloud Messaging HTTP v1 API (modern, OAuth2-based)
 *
 * Required Supabase Secret (set via CLI or Dashboard):
 *   FIREBASE_SERVICE_ACCOUNT_JSON  → Full JSON content of your Firebase service account key
 *   FIREBASE_PROJECT_ID            → Your Firebase project ID (e.g. "aniplay-abc12")
 *
 * How to get service account JSON:
 *   Firebase Console → Project Settings → Service Accounts → Generate new private key
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Generate a signed JWT for Google OAuth2 using the service account ────────
async function getAccessToken(serviceAccount: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600; // 1 hour

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: expiry,
  };

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const headerB64  = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import the RSA private key from the service account
  const pemKey = serviceAccount.private_key.replace(/\\n/g, '\n');
  const pemBody = pemKey
    .replace('-----BEGIN RSA PRIVATE KEY-----', '')
    .replace('-----END RSA PRIVATE KEY-----', '')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryKey = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBytes = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const jwt = `${signingInput}.${signatureB64}`;

  // Exchange JWT for an OAuth2 access token
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = await tokenResp.json();
  if (!tokenData.access_token) {
    throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`);
  }

  return tokenData.access_token;
}

// ── Main Edge Function Handler ────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Parse Supabase DB Webhook payload ──────────────────────────────────
    const payload = await req.json();
    const record  = payload?.record;

    if (!record) {
      return new Response(JSON.stringify({ error: 'No record in payload' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { target_user_id, actor_name, type, comment_preview, anime_id } = record;

    if (!target_user_id) {
      return new Response(JSON.stringify({ skipped: 'No target_user_id' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Supabase Admin Client — reads FCM token bypassing RLS ─────────────
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('fcm_token')
      .eq('id', target_user_id)
      .maybeSingle();

    if (profileError) {
      console.error('[FCM] Profile lookup error:', profileError.message);
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fcmToken = profile?.fcm_token;
    if (!fcmToken) {
      return new Response(JSON.stringify({ skipped: 'No FCM token for user' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Build notification title + body from type ──────────────────────────
    const actor = actor_name || 'Someone';
    let title = '🔔 AniPlay';
    let body  = 'You have a new notification';

    if (type === 'reply') {
      title = `💬 ${actor} replied to you`;
      body  = comment_preview ? `"${comment_preview}"` : 'Tap to view the reply';
    } else if (type === 'like') {
      title = `❤️ ${actor} liked your comment`;
      body  = comment_preview ? `"${comment_preview}"` : 'Tap to see';
    } else if (type === 'episode') {
      title = '🎬 New Episode Released!';
      body  = comment_preview || 'A new episode from your list is available!';
    }

    // ── Load Firebase Service Account + get OAuth2 access token ───────────
    const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON') ?? '';
    const projectId          = Deno.env.get('FIREBASE_PROJECT_ID') ?? '';

    if (!serviceAccountJson || !projectId) {
      console.error('[FCM] Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID secrets!');
      return new Response(JSON.stringify({ error: 'Firebase secrets not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const serviceAccount = JSON.parse(serviceAccountJson);
    const accessToken    = await getAccessToken(serviceAccount);

    // ── Call FCM HTTP v1 API ───────────────────────────────────────────────
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    const fcmPayload = {
      message: {
        token: fcmToken,
        notification: { title, body },
        android: {
          priority: 'high',                        // bypasses Android Doze Mode
          notification: {
            channel_id:            'aniplay_alerts', // matches Capacitor channel
            notification_priority: 'PRIORITY_HIGH',
            visibility:            'PUBLIC',
            color:                 '#7C3AED',
            icon:                  'ic_stat_name',
            sound:                 'default',
          },
        },
        data: {
          type:         type            || 'general',
          anime_id:     anime_id        ? String(anime_id) : '',
          actor_name:   actor_name      || '',
          click_action: anime_id        ? `/anime/${anime_id}` : '/notifications',
        },
      },
    };

    const fcmResponse = await fetch(fcmUrl, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(fcmPayload),
    });

    const fcmResult = await fcmResponse.json();

    // ── Auto-cleanup stale/unregistered tokens ─────────────────────────────
    if (!fcmResponse.ok) {
      const errCode = fcmResult?.error?.details?.[0]?.errorCode;
      if (errCode === 'UNREGISTERED' || errCode === 'INVALID_ARGUMENT') {
        await supabaseAdmin
          .from('user_profiles')
          .update({ fcm_token: null })
          .eq('id', target_user_id);
        console.log(`[FCM] Cleared stale token for user ${target_user_id}`);
      }
      console.error('[FCM] Send failed:', JSON.stringify(fcmResult));
    } else {
      console.log(`[FCM] ✅ Sent "${type}" notification to user ${target_user_id}`);
    }

    return new Response(JSON.stringify({ success: fcmResponse.ok, fcmResult }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[FCM] Unhandled error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
