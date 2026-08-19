import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { Preferences } from '@capacitor/preferences';
import { supabase } from './supabase';

const IS_NATIVE = Capacitor.isNativePlatform();

/**
 * ── Channel Initialization (Android 8.0+) ────────────────────────────────
 */
export async function setupNotificationChannels() {
  if (!IS_NATIVE) return;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      await LocalNotifications.requestPermissions();
    }

    await LocalNotifications.createChannel({
      id: 'aniplay_alerts',
      name: 'AniPlay Alerts',
      description: 'Episode release alerts and community replies',
      importance: 5, // High
      visibility: 1, // Public on lockscreen
      sound: 'notification_sound.mp3',
      vibration: true,
      lights: true,
      lightColor: '#7C3AED',
    });
    console.log('[NativeNotifications] Channel created: aniplay_alerts');
  } catch (e) {
    console.warn('[NativeNotifications] Channel setup warning:', e.message);
  }
}

/**
 * ── Save Notification to LocalStorage for In-App Display (0 Supabase Egress) ──
 */
export async function saveEpisodeNotificationInApp({ title, body, animeId, episode, airingAtMs }) {
  const animeIdStr = String(animeId);
  const notifObj = {
    id: `ep_${animeIdStr}_${episode}_${Date.now()}`,
    actor_name: 'AniPlay',
    type: 'episode',
    comment_preview: body || `Episode ${episode} is now available to watch!`,
    anime_id: animeIdStr,
    is_read: false,
    created_at: airingAtMs ? new Date(airingAtMs).toISOString() : new Date().toISOString(),
  };

  // Saved 100% in LocalStorage (ZERO Supabase DB storage & ZERO Egress)
  try {
    const raw = localStorage.getItem('aniplay_local_notifications') || '[]';
    const list = JSON.parse(raw);
    const exists = list.some(n => n.anime_id === animeIdStr && n.comment_preview === notifObj.comment_preview);
    if (!exists) {
      list.unshift(notifObj);
      localStorage.setItem('aniplay_local_notifications', JSON.stringify(list.slice(0, 50)));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aniplay_unread_notifications_updated'));
      }
    }
  } catch (_) {}
}

/**
 * ── Show Native System Status Bar Banner ──────────────────────────────────
 */
export async function triggerNativeBanner({ title, body, animeId, episode, extraData = {} }) {
  if (!title || !body) return;

  // Always save in-app notification first so the Notifications page is updated
  if (animeId) {
    saveEpisodeNotificationInApp({ title, body, animeId, episode }).catch(() => {});
  }

  if (!IS_NATIVE) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/icon.png' });
    }
    return;
  }

  try {
    const id = Math.floor(Math.random() * 2147483647);
    await LocalNotifications.schedule({
      notifications: [
        {
          title,
          body,
          id,
          schedule: { at: new Date(Date.now() + 100) },
          channelId: 'aniplay_alerts',
          smallIcon: 'ic_stat_name',
          iconColor: '#7C3AED',
          extra: {
            animeId: animeId ? String(animeId) : null,
            episode: episode ? Number(episode) : null,
            ...extraData,
          },
        },
      ],
    });
  } catch (e) {
    console.warn('[NativeNotifications] Trigger banner error:', e.message);
  }
}

/**
 * ── Safe FCM Push Token Registration & Listener setup ────────────────────
 */
export async function initPushNotifications(userId, navigateCallback) {
  if (!IS_NATIVE) return;

  try {
    await setupNotificationChannels();

    const handleTap = (extra) => {
      if (!navigateCallback || !extra) return;
      if (extra.animeId && extra.episode) {
        navigateCallback(`/watch/${extra.animeId}/${extra.episode}`);
      } else if (extra.animeId) {
        navigateCallback(`/anime/${extra.animeId}`);
      } else if (extra.type === 'reply' || extra.type === 'like') {
        navigateCallback('/notifications');
      }
    };

    try {
      LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        handleTap(action?.notification?.extra);
      });
    } catch (_) {}
  } catch (e) {
    console.warn('[LocalNotifications] Setup warning:', e.message);
  }

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm?.receive !== 'granted') {
      perm = await PushNotifications.requestPermissions();
    }

    if (perm?.receive === 'granted') {
      try {
        PushNotifications.addListener('registration', async (token) => {
          if (userId && token?.value) {
            try {
              await supabase
                .from('user_profiles')
                .update({ fcm_token: token.value })
                .eq('id', userId);
            } catch (_) {}
          }
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          triggerNativeBanner({
            title: notification?.title || 'AniPlay Notification',
            body: notification?.body || '',
            animeId: notification?.data?.animeId,
            episode: notification?.data?.episode,
            extraData: notification?.data,
          });
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          if (navigateCallback && action?.notification?.data) {
            const extra = action.notification.data;
            if (extra.animeId && extra.episode) navigateCallback(`/watch/${extra.animeId}/${extra.episode}`);
            else if (extra.animeId) navigateCallback(`/anime/${extra.animeId}`);
            else navigateCallback('/notifications');
          }
        });

        await PushNotifications.register();
      } catch (fcmErr) {
        console.warn('[PushNotifications] Listener warning:', fcmErr.message);
      }
    }
  } catch (e) {
    console.warn('[PushNotifications] FCM setup skipped safely:', e.message);
  }
}

/**
 * ── Pre-Schedule Native Android Alarms & Trigger Episode Release Banners ──
 * Deduplicated: Never schedules or pops duplicate banners for the same episode.
 */
export async function checkAndTriggerEpisodeAlerts(airingList = [], watchlist = {}, progress = {}) {
  if (!Array.isArray(airingList) || airingList.length === 0) return;

  const watchedIds = new Set(Object.keys(watchlist || {}));
  const now = Date.now();

  let pendingIds = new Set();
  if (IS_NATIVE) {
    try {
      const pending = await LocalNotifications.getPending();
      pendingIds = new Set(pending.notifications.map(n => n.id));
    } catch (_) {}
  }

  for (const item of airingList) {
    const anime = item.media || item;
    if (!anime?.id) continue;

    const animeIdStr = String(anime.id);
    if (!watchedIds.has(animeIdStr)) continue;

    const nextEp = anime.nextAiringEpisode || (item.airingAt ? { airingAt: item.airingAt, episode: item.episode } : null);
    if (!nextEp || !nextEp.airingAt || !nextEp.episode) continue;

    // SKIP if user has ALREADY WATCHED this episode or beyond
    const userWatchedEp = progress?.[animeIdStr]?.episode || progress?.[anime.id]?.episode || 0;
    if (userWatchedEp >= Number(nextEp.episode)) {
      continue;
    }

    const airTimeMs = nextEp.airingAt * 1000;
    const diffMs = airTimeMs - now;
    const title = anime.title?.romaji || anime.title?.english || anime.title?.native || 'Anime';
    const notifId = (Number(anime.id) * 1000 + Number(nextEp.episode)) % 2147483647;

    const scheduledKey = `scheduled_ep_${anime.id}_${nextEp.episode}`;
    const notifiedKey  = `notified_ep_${anime.id}_${nextEp.episode}`;

    // Use Capacitor Preferences instead of volatile localStorage
    const [hasScheduled, hasNotified] = await Promise.all([
      Preferences.get({ key: scheduledKey }),
      Preferences.get({ key: notifiedKey })
    ]);

    // CASE 1: Episode is in the future (Pre-schedule Native Android OS Alarm in advance)
    if (diffMs > 0 && diffMs < 7 * 24 * 3600 * 1000) {
      if (!hasScheduled.value && !hasNotified.value && !pendingIds.has(notifId)) {
        await Preferences.set({ key: scheduledKey, value: 'true' });
        await Preferences.set({ key: notifiedKey, value: 'true' });

        if (IS_NATIVE) {
          try {
            await LocalNotifications.schedule({
              notifications: [
                {
                  title: `🎬 New Episode Released!`,
                  body: `Episode ${nextEp.episode} of ${title} is now available to watch!`,
                  id: notifId,
                  schedule: { at: new Date(airTimeMs), allowWhileIdle: true },
                  channelId: 'aniplay_alerts',
                  smallIcon: 'ic_stat_name',
                  iconColor: '#7C3AED',
                  extra: {
                    animeId: String(anime.id),
                    episode: Number(nextEp.episode),
                  },
                },
              ],
            });
            console.log(`[NativeNotifications] Scheduled future alarm for ${title} Ep ${nextEp.episode} at ${new Date(airTimeMs).toLocaleTimeString()}`);
          } catch (e) {
            console.warn('[NativeNotifications] Pre-schedule error:', e.message);
          }
        }
      }
    }

    // CASE 2: Episode aired very recently (within last 2 hours only) and wasn't notified/scheduled yet
    else if (diffMs <= 0 && diffMs > -2 * 3600 * 1000) {
      if (!hasNotified.value && !hasScheduled.value) {
        await Preferences.set({ key: notifiedKey, value: 'true' });
        await Preferences.set({ key: scheduledKey, value: 'true' });
        triggerNativeBanner({
          title: `🎬 New Episode Released!`,
          body: `Episode ${nextEp.episode} of ${title} is now available to watch!`,
          animeId: anime.id,
          episode: nextEp.episode,
        });
      }
    }
  }
}
