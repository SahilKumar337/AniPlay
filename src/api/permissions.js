import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const IS_NATIVE = Capacitor.isNativePlatform();

/**
 * Prompt for storage and notification permissions once on first app launch.
 */
export async function requestInitialPermissions() {
  if (!IS_NATIVE) return;
  const alreadyAsked = localStorage.getItem('aniplay_initial_perms_asked');
  if (alreadyAsked) return;
  localStorage.setItem('aniplay_initial_perms_asked', 'true');

  try {
    const OfflineDownloader = registerPlugin('OfflineDownloader');
    await OfflineDownloader?.requestStoragePermissions?.().catch(() => {});
  } catch (_) {}

  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      await LocalNotifications.requestPermissions().catch(() => {});
    }
  } catch (_) {}
}

/**
 * On-demand check and prompt for storage permissions when user initiates a download.
 */
export async function ensureStoragePermission() {
  if (!IS_NATIVE) return true;
  try {
    const OfflineDownloader = registerPlugin('OfflineDownloader');
    const res = await OfflineDownloader?.requestStoragePermissions?.();
    return res?.granted !== false;
  } catch (_) {
    return true;
  }
}

/**
 * On-demand check and prompt for notification permissions when user enables alerts.
 */
export async function ensureNotificationPermission() {
  if (!IS_NATIVE) return true;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'granted') return true;
    const req = await LocalNotifications.requestPermissions();
    return req.display === 'granted';
  } catch (_) {
    return true;
  }
}
