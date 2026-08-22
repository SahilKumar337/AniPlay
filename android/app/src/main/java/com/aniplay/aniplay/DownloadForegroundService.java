package com.aniplay.aniplay;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import androidx.core.app.NotificationCompat;

import java.util.concurrent.ConcurrentHashMap;

public class DownloadForegroundService extends Service {
    private static final String TAG = "DownloadFGService";
    public static final String CHANNEL_ID = "aniplay_downloads_channel";
    public static final int NOTIFICATION_ID = 9001;

    public static final String ACTION_START = "com.aniplay.aniplay.ACTION_START_DOWNLOAD";
    public static final String ACTION_UPDATE = "com.aniplay.aniplay.ACTION_UPDATE_DOWNLOAD";
    public static final String ACTION_STOP = "com.aniplay.aniplay.ACTION_STOP_DOWNLOAD";

    public static final String EXTRA_TASK_ID = "extra_task_id";
    public static final String EXTRA_TITLE = "extra_title";
    public static final String EXTRA_PROGRESS = "extra_progress";
    public static final String EXTRA_STATUS = "extra_status";

    private static final ConcurrentHashMap<String, DownloadInfo> activeTasks = new ConcurrentHashMap<>();
    private static volatile DownloadForegroundService instance = null;
    private static long lastNotificationUpdateTime = 0;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private NotificationManager notificationManager;

    private static class DownloadInfo {
        String title;
        int progress;
        String status;
        DownloadInfo(String title, int progress, String status) {
            this.title = title;
            this.progress = progress;
            this.status = status;
        }
    }

    public static void startDownload(Context ctx, String taskId, String title) {
        if (ctx == null || taskId == null) return;
        activeTasks.put(taskId, new DownloadInfo(title != null ? title : "Episode", 0, "downloading"));
        
        Intent intent = new Intent(ctx, DownloadForegroundService.class);
        intent.setAction(ACTION_START);
        intent.putExtra(EXTRA_TASK_ID, taskId);
        intent.putExtra(EXTRA_TITLE, title);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent);
            } else {
                ctx.startService(intent);
            }
        } catch (Exception e) {
            Log.w(TAG, "startForegroundService error: " + e.getMessage());
        }
    }

    public static void updateProgress(Context ctx, String taskId, int progress, String status) {
        if (taskId == null) return;
        DownloadInfo info = activeTasks.get(taskId);
        if (info != null) {
            info.progress = progress;
            info.status = status;
        }

        // Fast in-memory update if service is alive (avoids creating Intent objects at 60 FPS)
        DownloadForegroundService s = instance;
        if (s != null) {
            long now = System.currentTimeMillis();
            if (now - lastNotificationUpdateTime >= 350 || progress == 100 || progress == 0) {
                lastNotificationUpdateTime = now;
                s.notifyForegroundState();
            }
            return;
        }

        if (ctx == null) return;
        Intent intent = new Intent(ctx, DownloadForegroundService.class);
        intent.setAction(ACTION_UPDATE);
        intent.putExtra(EXTRA_TASK_ID, taskId);
        intent.putExtra(EXTRA_PROGRESS, progress);
        intent.putExtra(EXTRA_STATUS, status);
        try {
            ctx.startService(intent);
        } catch (Exception ignored) {}
    }

    public static void stopDownload(Context ctx, String taskId, boolean success, String title) {
        if (taskId != null) activeTasks.remove(taskId);

        DownloadForegroundService s = instance;
        if (s != null) {
            if (activeTasks.isEmpty()) {
                s.stopForegroundService();
            } else {
                s.notifyForegroundState();
            }
        } else if (ctx != null) {
            Intent intent = new Intent(ctx, DownloadForegroundService.class);
            intent.setAction(ACTION_STOP);
            intent.putExtra(EXTRA_TASK_ID, taskId);
            try { ctx.startService(intent); } catch (Exception ignored) {}
        }

        // Post completion notification when done
        if (success && ctx != null) {
            try {
                NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    Intent openIntent = new Intent(ctx, MainActivity.class);
                    openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    PendingIntent pi = PendingIntent.getActivity(
                        ctx, (int) System.currentTimeMillis(), openIntent,
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                            ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                            : PendingIntent.FLAG_UPDATE_CURRENT
                    );

                    NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                        .setSmallIcon(R.mipmap.ic_launcher)
                        .setContentTitle("Download Complete 🎉")
                        .setContentText(title != null ? title : "Episode downloaded successfully")
                        .setAutoCancel(true)
                        .setContentIntent(pi)
                        .setPriority(NotificationCompat.PRIORITY_HIGH);

                    nm.notify((int) (System.currentTimeMillis() % 100000), builder.build());
                }
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        createNotificationChannel();

        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AniPlay:DownloadWakeLock");
                wakeLock.acquire(4 * 60 * 60 * 1000L); // 4 hours max safeguard for large batch downloads
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to acquire wake lock: " + e.getMessage());
        }

        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "AniPlay:DownloadWifiLock");
                wifiLock.acquire();
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to acquire wifi lock: " + e.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_STOP.equals(action)) {
                String taskId = intent.getStringExtra(EXTRA_TASK_ID);
                if (taskId != null) activeTasks.remove(taskId);
                if (activeTasks.isEmpty()) {
                    stopForegroundService();
                    return START_NOT_STICKY;
                }
            }
        }

        notifyForegroundState();
        return START_STICKY;
    }

    private void notifyForegroundState() {
        if (activeTasks.isEmpty()) {
            stopForegroundService();
            return;
        }

        Notification notification = buildForegroundNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            if (notificationManager != null) {
                notificationManager.notify(NOTIFICATION_ID, notification);
            }
        }
    }

    private void stopForegroundService() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {}
        stopSelf();
    }

    private Notification buildForegroundNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this, 0, openIntent,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT
        );

        String title = "AniPlay Downloader";
        String content = "Downloading episode...";
        int progress = 0;

        if (!activeTasks.isEmpty()) {
            DownloadInfo first = activeTasks.values().iterator().next();
            if (first.title != null) title = first.title;
            progress = first.progress;
            if ("processing".equals(first.status) || progress >= 90) {
                content = "Saving video to storage... " + progress + "%";
            } else {
                content = "Downloading... " + progress + "%" + (activeTasks.size() > 1 ? " (" + activeTasks.size() + " active)" : "");
            }
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(content)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW);

        if (progress > 0 && progress < 100) {
            builder.setProgress(100, progress, false);
        } else {
            builder.setProgress(100, 0, true);
        }

        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Episode Downloads",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows active video download progress");
            channel.enableVibration(false);
            channel.setShowBadge(false);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception ignored) {}
        }
        if (wifiLock != null && wifiLock.isHeld()) {
            try { wifiLock.release(); } catch (Exception ignored) {}
        }
        super.onDestroy();
    }

    /**
     * Called when user swipes the app away from recent apps.
     * With stopWithTask="false" the service survives, but as an extra safety net
     * we also schedule a restart via AlarmManager so that even if Android force-kills
     * the service, it will come back within 1 second.
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        if (!activeTasks.isEmpty()) {
            Log.d(TAG, "onTaskRemoved: " + activeTasks.size() + " active downloads, scheduling restart");
            Intent restartIntent = new Intent(getApplicationContext(), DownloadForegroundService.class);
            restartIntent.setAction(ACTION_START);
            PendingIntent pi = PendingIntent.getService(
                getApplicationContext(),
                1,
                restartIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    : PendingIntent.FLAG_UPDATE_CURRENT
            );
            try {
                AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                if (am != null) {
                    am.setAndAllowWhileIdle(
                        AlarmManager.ELAPSED_REALTIME_WAKEUP,
                        SystemClock.elapsedRealtime() + 1000, // restart in 1s
                        pi
                    );
                }
            } catch (Exception e) {
                Log.w(TAG, "onTaskRemoved restart scheduling failed: " + e.getMessage());
            }
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
