package com.aniplay.aniplay;

import android.Manifest;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.util.Log;

import com.arthenica.ffmpegkit.FFmpegKit;
import com.arthenica.ffmpegkit.FFmpegKitConfig;
import com.arthenica.ffmpegkit.ReturnCode;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.ConnectionPool;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.Dns;
import java.net.InetAddress;
import java.net.UnknownHostException;
import org.json.JSONObject;
import org.json.JSONArray;
import javax.net.ssl.*;
import java.security.cert.CertificateException;

import java.io.*;
import java.net.URL;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

// ─── OfflineDownloader — v2.0 (OkHttp + JS pre-fetch) ───────────────────────
//
//  Download flow:
//    Path A (HLS, JS fetched playlist):
//       1. JS pre-fetches media playlist (CapacitorHttp, full browser auth)
//       2. JS calls initDownload → writeSegment(×N) → finalizeDownload
//          Each segment is base64-encoded binary passed from JS fetch()
//       3. Java muxes local segments → MP4 → Gallery
//
//    Path B (fallback, Java-native HLS download):
//       1. Java fetches playlist via OkHttp (WebView cookie jar synced)
//       2. Java downloads segments in parallel (OkHttp, 4 threads)
//       3. Java muxes local segments → MP4 → Gallery
//
//    Path C (direct MP4):
//       1. OkHttp downloads directly → stream to Gallery

@CapacitorPlugin(name = "OfflineDownloader")
public class OfflineDownloader extends Plugin {
    private static final String TAG = "AniPlayDL";

    // OkHttp client shared across all downloads — syncs cookies with WebView
    private OkHttpClient http;
    private final ExecutorService executor = Executors.newFixedThreadPool(3);

    // JS-driven download state (Path A)
    private final Map<String, JSDownloadState> jsDLs = new ConcurrentHashMap<>();
    // Java-driven download tracking (Path B)
    private final Map<String, JavaDLTask> javaDLs = new ConcurrentHashMap<>();

    @Override
    public void load() {
        super.load();
        // Build OkHttp with WebView CookieJar and custom Dispatcher for multi-threaded downloads
        okhttp3.Dispatcher dispatcher = new okhttp3.Dispatcher();
        dispatcher.setMaxRequests(512);
        dispatcher.setMaxRequestsPerHost(256); // Allow up to 256 concurrent requests to the CDN

        OkHttpClient.Builder builder = new OkHttpClient.Builder()
            .dispatcher(dispatcher)
            .cookieJar(new CookieJar() {
                @Override
                public void saveFromResponse(HttpUrl url, List<Cookie> cookies) {
                    android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
                    for (Cookie c : cookies) cm.setCookie(url.toString(), c.name() + "=" + c.value());
                }
                @Override
                public List<Cookie> loadForRequest(HttpUrl url) {
                    android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
                    String raw = cm.getCookie(url.toString());
                    if (raw == null || raw.isEmpty()) return Collections.emptyList();
                    List<Cookie> list = new ArrayList<>();
                    for (String pair : raw.split(";")) {
                        String t = pair.trim();
                        int eq = t.indexOf('=');
                        if (eq > 0) {
                            list.add(new Cookie.Builder()
                                .name(t.substring(0, eq).trim())
                                .value(t.substring(eq + 1).trim())
                                .domain(url.host())
                                .path("/")
                                .build());
                        }
                    }
                    return list;
                }
            })
            .followRedirects(true)
            .followSslRedirects(true)
            .connectTimeout(10, TimeUnit.SECONDS)   // fail fast on bad connections
            .readTimeout(20, TimeUnit.SECONDS)       // stalled read → fail & retry quickly
            .callTimeout(25, TimeUnit.SECONDS)       // HARD 25s limit per entire HTTP call — prevents trickle-stall hangs
            // 256-connection pool for maximum throughput parallel downloading
            .connectionPool(new ConnectionPool(256, 5, TimeUnit.MINUTES))
            // Enable HTTP/2 for multiplexed CDN speed and HTTP/1.1 fallback
            .protocols(java.util.Arrays.asList(Protocol.HTTP_2, Protocol.HTTP_1_1))
            .dns(new Dns() {
                @Override
                public List<InetAddress> lookup(String hostname) throws UnknownHostException {
                    if (hostname.contains("vivibebe") || hostname.contains("anizara") || hostname.contains("anineko") || hostname.contains("ibyteimg")) {
                        List<InetAddress> ips = resolveDnsOverHttps(hostname);
                        if (ips != null && !ips.isEmpty()) {
                            return ips;
                        }
                    }
                    return Dns.SYSTEM.lookup(hostname);
                }
            });
        configureUnsafeSsl(builder);
        http = builder.build();
        Log.d(TAG, "OfflineDownloader v2.0 loaded (OkHttp + JS pre-fetch)");
    }

    public String getDownloadFolder() {
        try {
            android.content.SharedPreferences prefs = getContext().getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            String settingsJsonStr = prefs.getString("aniplay_settings", null);
            if (settingsJsonStr != null) {
                org.json.JSONObject json = new org.json.JSONObject(settingsJsonStr);
                if (json.has("downloadLocation")) {
                    String loc = json.getString("downloadLocation");
                    if (loc != null && !loc.trim().isEmpty()) {
                        return loc.trim();
                    }
                }
            }
        } catch (Exception ignored) {}
        return "AniPlay";
    }

    // ── PLUGIN METHODS ────────────────────────────────────────────────────────

    // Path B: Java-native download (full HLS + fallback for non-JS)
    @PluginMethod
    public void downloadEpisode(PluginCall call) {
        String animeId    = call.getString("animeId");
        String animeTitle = call.getString("animeTitle");
        String episode    = call.getString("episode");
        String url        = call.getString("url");
        String referer    = call.getString("referer", "");
        String cover      = call.getString("cover", "");
        String track      = call.getString("track", "sub");
        String subsJson   = "";
        try { JSArray s = call.getArray("subtitles"); if (s != null) subsJson = s.toString(); }
        catch (Exception ignored) {}
        String playlistContent = call.getString("playlistContent", "");
        if (playlistContent == null) playlistContent = "";

        if (animeId == null || episode == null || url == null) {
            call.reject("animeId, episode, and url are required"); return;
        }
        String taskId = animeId + "_" + episode + "_" + track;
        if (javaDLs.containsKey(taskId)) { call.reject("Already downloading"); return; }

        boolean isHls = call.getBoolean("isHls", url.contains(".m3u8"));
        JavaDLTask task = new JavaDLTask(taskId, animeId, animeTitle, episode, url,
            referer, cover, track, subsJson, isHls, playlistContent, getContext(), this, http);
        javaDLs.put(taskId, task);
        executor.submit(task);

        call.resolve(new JSObject().put("status", "started"));
    }

    // Path A: JS-driven segment download — init
    @PluginMethod
    public void initDownload(PluginCall call) {
        String taskId    = call.getString("taskId", "dl_" + System.currentTimeMillis());
        String name      = call.getString("outputName", "video.mp4");
        int    total     = call.getInt("total", 0);
        boolean isFmp4   = call.getBoolean("isFmp4", false);

        File tempDir = new File(getContext().getCacheDir(), "jsdl_" + Math.abs(taskId.hashCode()));
        rmrf(tempDir);
        tempDir.mkdirs();

        JSDownloadState s = new JSDownloadState();
        s.outputName = name; s.tempDir = tempDir; s.total = total; s.isFmp4 = isFmp4;
        jsDLs.put(taskId, s);
        Log.d(TAG, "initDownload taskId=" + taskId + " total=" + total + " fmp4=" + isFmp4);
        call.resolve();
    }

    // Path A: JS-driven segment download — write one segment
    @PluginMethod
    public void writeSegment(PluginCall call) {
        String taskId = call.getString("taskId", "");
        int    index  = call.getInt("index", 0);
        String data   = call.getString("data", "");
        String type   = call.getString("type", "ts"); // "ts", "m4s", "init"

        JSDownloadState s = jsDLs.get(taskId);
        if (s == null) { call.reject("Unknown taskId: " + taskId); return; }

        try {
            byte[] bytes = android.util.Base64.decode(data, android.util.Base64.NO_WRAP);
            String fn = index < 0 ? "init.mp4"
                                  : String.format(java.util.Locale.US, "seg_%06d.%s", index, type);
            try (FileOutputStream fos = new FileOutputStream(new File(s.tempDir, fn))) {
                fos.write(bytes);
            }
            if (index >= 0) {
                int done = s.written.incrementAndGet();
                int prog = Math.min(90, (int)(done * 90L / Math.max(1, s.total)));
                emit(taskId, prog, "downloading", null);
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "writeSegment error", e);
            call.reject("Write failed: " + e.getMessage());
        }
    }

    // Path A: JS-driven segment download — mux and save
    @PluginMethod
    public void finalizeDownload(PluginCall call) {
        String taskId  = call.getString("taskId", "");
        boolean isFmp4 = call.getBoolean("isFmp4", false);

        JSDownloadState s = jsDLs.remove(taskId);
        if (s == null) { call.reject("Unknown taskId: " + taskId); return; }
        call.resolve();   // Resolve immediately; completion arrives via downloadProgress event

        final JSDownloadState st = s;
        executor.submit(() -> {
            try {
                emit(taskId, 92, "processing", null);
                File outMp4 = muxConcat(st.tempDir, st.total, isFmp4, taskId);
                emit(taskId, 97, "processing", null);
                saveToGallery(outMp4, st.outputName);
                rmrf(st.tempDir);
                emit(taskId, 100, "completed", null);
            } catch (Exception e) {
                Log.e(TAG, "finalizeDownload error for " + taskId, e);
                rmrf(st.tempDir);
                emit(taskId, 0, "error", e.getMessage());
            }
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        String taskId = call.getString("taskId", "");
        if (taskId.isEmpty()) {
            String animeId = call.getString("animeId", "");
            String ep = call.getString("episode", "");
            String trk = call.getString("track", "sub");
            if (!animeId.isEmpty() && !ep.isEmpty()) {
                taskId = animeId + "_" + ep + "_" + trk;
            }
        }

        Log.d(TAG, "cancelDownload requested for taskId=" + taskId);

        if (!taskId.isEmpty()) {
            JavaDLTask task = javaDLs.remove(taskId);
            if (task != null) {
                task.cancel();
            }
            JSDownloadState jsState = jsDLs.remove(taskId);
            if (jsState != null) {
                rmrf(jsState.tempDir);
            }
            DownloadForegroundService.stopDownload(getContext(), taskId, false, "Download Cancelled");
            emit(taskId, 0, "cancelled", "Cancelled by user");
        }
        call.resolve();
    }

    @PluginMethod
    public void deleteDownload(PluginCall call) {
        cancelDownload(call);
    }

    /**
     * Explicitly request runtime storage permissions from JS.
     */
    @PluginMethod
    public void requestStoragePermissions(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                List<String> perms = new ArrayList<>();
                if (getContext().checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO) != PackageManager.PERMISSION_GRANTED) {
                    perms.add(Manifest.permission.READ_MEDIA_VIDEO);
                }
                if (getContext().checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED) {
                    perms.add(Manifest.permission.READ_MEDIA_IMAGES);
                }
                if (!perms.isEmpty() && getActivity() != null) {
                    getActivity().requestPermissions(perms.toArray(new String[0]), 201);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                List<String> perms = new ArrayList<>();
                if (getContext().checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    perms.add(Manifest.permission.READ_EXTERNAL_STORAGE);
                }
                if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
                    getContext().checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    perms.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
                }
                if (!perms.isEmpty() && getActivity() != null) {
                    getActivity().requestPermissions(perms.toArray(new String[0]), 200);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "requestStoragePermissions error: " + e.getMessage());
        }
        call.resolve();
    }

    /**
     * Find a downloaded episode's filesystem path using a 4-tier lookup strategy:
     *  1. Direct file path (fastest — no MediaStore needed)
     *  2. MediaStore.Downloads (where we actually save files on Android 10+)
     *  3. MediaStore.Video (fallback — some ROMs re-index Downloads as Video)
     *  4. Folder scan (brute force — finds any MP4 matching the title/episode)
     *
     * Returns { filePath, subtitlePath } as absolute filesystem paths.
     * JS side calls Capacitor.convertFileSrc('file://'+path) to get a streamable URL.
     */
    @PluginMethod
    public void getLocalVideoUri(PluginCall call) {
        String displayName = call.getString("displayName");
        if (displayName == null || displayName.isEmpty()) {
            call.reject("displayName is required");
            return;
        }

        android.content.ContentResolver cr = getContext().getContentResolver();
        String filePath = null;
        String subPath  = null;

        String vttName  = displayName.endsWith(".mp4")
            ? displayName.substring(0, displayName.length() - 4) + ".vtt"
            : displayName + ".vtt";
        String basePart = displayName.endsWith(".mp4")
            ? displayName.substring(0, displayName.length() - 4)
            : displayName;

        java.io.File downloadsBase = android.os.Environment.getExternalStoragePublicDirectory(
            android.os.Environment.DIRECTORY_DOWNLOADS);
        String folder = getDownloadFolder();

        // ── Request storage permissions if not already granted ─────────────────
        // Without READ_EXTERNAL_STORAGE (≤API32) or READ_MEDIA_VIDEO (API33+),
        // File.exists() always returns false for Downloads content.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            if (getContext().checkSelfPermission(android.Manifest.permission.READ_MEDIA_VIDEO)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                getActivity().requestPermissions(
                    new String[]{ android.Manifest.permission.READ_MEDIA_VIDEO }, 201);
            }
        } else if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            if (getContext().checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                getActivity().requestPermissions(
                    new String[]{ android.Manifest.permission.READ_EXTERNAL_STORAGE }, 200);
            }
        }

        // ── TIER 1: Direct filesystem path (fastest, no MediaStore needed) ──────
        java.io.File directFile = new java.io.File(downloadsBase, folder + "/" + displayName);
        if (directFile.exists()) {
            filePath = directFile.getAbsolutePath();
            Log.d(TAG, "getLocalVideoUri: TIER1 direct path hit: " + filePath);
        }

        // ── TIER 2: MediaStore.Downloads (this is where saveToGallery inserts on Q+) ──
        if (filePath == null && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            String[] proj = { android.provider.MediaStore.Downloads._ID,
                              android.provider.MediaStore.MediaColumns.DATA,
                              android.provider.MediaStore.MediaColumns.DISPLAY_NAME };
            String sel  = android.provider.MediaStore.MediaColumns.DISPLAY_NAME + " LIKE ?";
            String[] selArgs = { basePart + "%.mp4" };
            try (android.database.Cursor c = cr.query(
                    android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    proj, sel, selArgs,
                    android.provider.MediaStore.MediaColumns.DATE_ADDED + " DESC")) {
                if (c != null && c.moveToFirst()) {
                    int dataIdx = c.getColumnIndex(android.provider.MediaStore.MediaColumns.DATA);
                    if (dataIdx >= 0) filePath = c.getString(dataIdx);
                    if (filePath == null || filePath.isEmpty()) {
                        // DATA null — reconstruct from known folder + display name
                        int nameIdx = c.getColumnIndex(android.provider.MediaStore.MediaColumns.DISPLAY_NAME);
                        String fname = (nameIdx >= 0) ? c.getString(nameIdx) : displayName;
                        java.io.File f = new java.io.File(downloadsBase, folder + "/" + fname);
                        if (f.exists()) filePath = f.getAbsolutePath();
                    }
                    Log.d(TAG, "getLocalVideoUri: TIER2 MediaStore.Downloads hit: " + filePath);
                }
            } catch (Exception e) {
                Log.w(TAG, "getLocalVideoUri: TIER2 failed: " + e.getMessage());
            }
        }

        // ── TIER 3: MediaStore.Video (some ROMs re-index Downloads as Video) ────
        if (filePath == null) {
            String[] proj = { android.provider.MediaStore.Video.Media._ID,
                              android.provider.MediaStore.MediaColumns.DATA,
                              android.provider.MediaStore.MediaColumns.DISPLAY_NAME };
            String sel  = android.provider.MediaStore.MediaColumns.DISPLAY_NAME + " LIKE ?";
            String[] selArgs = { basePart + "%.mp4" };
            try (android.database.Cursor c = cr.query(
                    android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    proj, sel, selArgs,
                    android.provider.MediaStore.MediaColumns.DATE_ADDED + " DESC")) {
                if (c != null && c.moveToFirst()) {
                    int dataIdx = c.getColumnIndex(android.provider.MediaStore.MediaColumns.DATA);
                    if (dataIdx >= 0) filePath = c.getString(dataIdx);
                    if (filePath == null || filePath.isEmpty()) {
                        int nameIdx = c.getColumnIndex(android.provider.MediaStore.MediaColumns.DISPLAY_NAME);
                        String fname = (nameIdx >= 0) ? c.getString(nameIdx) : displayName;
                        java.io.File f = new java.io.File(downloadsBase, folder + "/" + fname);
                        if (f.exists()) filePath = f.getAbsolutePath();
                    }
                    Log.d(TAG, "getLocalVideoUri: TIER3 MediaStore.Video hit: " + filePath);
                }
            } catch (Exception e) {
                Log.w(TAG, "getLocalVideoUri: TIER3 failed: " + e.getMessage());
            }
        }

        // ── TIER 4: Brute-force folder scan (deduplication like Title (1).mp4) ──
        if (filePath == null) {
            java.io.File dir = new java.io.File(downloadsBase, folder);
            if (dir.exists() && dir.isDirectory()) {
                java.io.File[] files = dir.listFiles();
                if (files != null) {
                    for (java.io.File f : files) {
                        if (f.getName().startsWith(basePart) && f.getName().endsWith(".mp4")) {
                            filePath = f.getAbsolutePath();
                            Log.d(TAG, "getLocalVideoUri: TIER4 folder scan hit: " + filePath);
                            break;
                        }
                    }
                }
            }
        }

        // ── Subtitle lookup (VTT / SRT) ──────────────────────────────────────
        // Tier 0: if filePath was found, check if subtitle exists right next to it
        if (filePath != null) {
            String noExt = filePath.lastIndexOf('.') > 0 ? filePath.substring(0, filePath.lastIndexOf('.')) : filePath;
            String[] exts = { ".vtt", ".srt", ".vtt.txt", ".txt", ".ass" };
            for (String ext : exts) {
                java.io.File matchSub = new java.io.File(noExt + ext);
                if (matchSub.exists()) {
                    subPath = matchSub.getAbsolutePath();
                    break;
                }
            }
        }

        // Tier 1: direct path (check both .vtt and legacy .vtt.txt in folder and base)
        if (subPath == null) {
            java.io.File directSub = new java.io.File(downloadsBase, folder + "/" + vttName);
            if (!directSub.exists()) directSub = new java.io.File(downloadsBase, folder + "/" + vttName + ".txt");
            if (!directSub.exists()) directSub = new java.io.File(downloadsBase, vttName);
            if (!directSub.exists()) directSub = new java.io.File(downloadsBase, vttName + ".txt");
            if (directSub.exists()) subPath = directSub.getAbsolutePath();
        }

        // Tier 2: MediaStore.Downloads
        if (subPath == null && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            String[] subProj = { android.provider.MediaStore.Downloads._ID,
                                 android.provider.MediaStore.MediaColumns.DATA };
            try (android.database.Cursor c = cr.query(
                    android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    subProj,
                    android.provider.MediaStore.MediaColumns.DISPLAY_NAME + " = ?",
                    new String[]{ vttName }, null)) {
                if (c != null && c.moveToFirst()) {
                    int dataIdx = c.getColumnIndex(android.provider.MediaStore.MediaColumns.DATA);
                    if (dataIdx >= 0) subPath = c.getString(dataIdx);
                }
            } catch (Exception e) {
                Log.w(TAG, "getLocalVideoUri: subtitle lookup failed: " + e.getMessage());
            }
        }

        // Tier 3: Folder scan fallback matching video base name
        if (subPath == null) {
            java.io.File dir = new java.io.File(downloadsBase, folder);
            if (dir.exists() && dir.isDirectory()) {
                java.io.File[] files = dir.listFiles();
                if (files != null) {
                    for (java.io.File f : files) {
                        String fn = f.getName();
                        if ((fn.endsWith(".vtt") || fn.endsWith(".srt") || fn.endsWith(".vtt.txt"))
                            && (fn.startsWith(basePart) || (filePath != null && fn.startsWith(new java.io.File(filePath).getName().replace(".mp4", ""))))) {
                            subPath = f.getAbsolutePath();
                            Log.d(TAG, "getLocalVideoUri: folder scan subtitle hit: " + subPath);
                            break;
                        }
                    }
                }
            }
        }

        Log.d(TAG, "getLocalVideoUri result → video=" + filePath + " sub=" + subPath);
        JSObject ret = new JSObject();
        if (filePath != null && !filePath.isEmpty()) ret.put("filePath",     filePath);
        if (subPath  != null && !subPath.isEmpty()) {
            ret.put("subtitlePath", subPath);
            try {
                java.io.File subFile = new java.io.File(subPath);
                if (subFile.exists() && subFile.canRead()) {
                    byte[] b = new byte[(int) subFile.length()];
                    try (java.io.FileInputStream fis = new java.io.FileInputStream(subFile)) {
                        fis.read(b);
                    }
                    String subContent = new String(b, java.nio.charset.StandardCharsets.UTF_8);
                    if (subContent.length() > 5) {
                        ret.put("subtitleContent", subContent);
                        Log.d(TAG, "Loaded subtitleContent directly (" + subContent.length() + " chars)");
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed reading subtitleContent via direct file: " + e.getMessage());
            }

            // Fallback via MediaStore ContentResolver if direct file read returned nothing
            if (!ret.has("subtitleContent") && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                try (android.database.Cursor c = cr.query(
                        android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                        new String[]{ android.provider.MediaStore.Downloads._ID },
                        android.provider.MediaStore.MediaColumns.DISPLAY_NAME + " LIKE ?",
                        new String[]{ "%" + basePart + "%.vtt" }, null)) {
                    if (c != null && c.moveToFirst()) {
                        long id = c.getLong(0);
                        android.net.Uri contentUri = android.content.ContentUris.withAppendedId(
                                android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, id);
                        try (java.io.InputStream is = cr.openInputStream(contentUri)) {
                            if (is != null) {
                                java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                                byte[] buf = new byte[8192];
                                int n;
                                while ((n = is.read(buf)) != -1) baos.write(buf, 0, n);
                                String subContent = baos.toString("UTF-8");
                                if (subContent.length() > 5) {
                                    ret.put("subtitleContent", subContent);
                                    Log.d(TAG, "Loaded subtitleContent via ContentResolver (" + subContent.length() + " chars)");
                                }
                            }
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Failed reading subtitleContent via ContentResolver: " + e.getMessage());
                }
            }
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void openDownloadFolder(PluginCall call) {
        String folderName = call.getString("folder", "AniPlay");
        try {
            android.content.Context context = getContext();
            File downloadsDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
            File dir = new File(downloadsDir, folderName);
            if (!dir.exists()) {
                dir.mkdirs();
            }

            android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
            
            // Try modern content provider directory URI for file managers
            Uri uri = Uri.parse("content://com.android.externalstorage.documents/document/primary:Download%2F" + folderName);
            intent.setDataAndType(uri, "vnd.android.document/directory");
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);

            try {
                context.startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                // Fallback 1: Try general Downloads view
                try {
                    android.content.Intent fallback = new android.content.Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS);
                    fallback.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(fallback);
                    call.resolve();
                } catch (Exception ex) {
                    // Fallback 2: Open generic Documents provider root
                    try {
                        android.content.Intent docIntent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
                        docIntent.setDataAndType(Uri.parse("content://com.android.externalstorage.documents/root/primary"), "vnd.android.document/root");
                        docIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(docIntent);
                        call.resolve();
                    } catch (Exception ex2) {
                        call.reject("Could not open file manager: " + ex2.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            call.reject("Error: " + e.getMessage());
        }
    }

    @PluginMethod
    public void exportBackup(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Data is required");
            return;
        }
        try {
            File cacheDir = getContext().getCacheDir();
            String fileName = "aniplay-backup-" + new java.text.SimpleDateFormat("yyyy-MM-dd").format(new java.util.Date()) + ".json";
            File backupFile = new File(cacheDir, fileName);
            
            java.io.FileWriter writer = new java.io.FileWriter(backupFile);
            writer.write(data);
            writer.flush();
            writer.close();

            Uri contentUri = androidx.core.content.FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                backupFile
            );

            android.content.Intent shareIntent = new android.content.Intent(android.content.Intent.ACTION_SEND);
            shareIntent.setType("application/json");
            shareIntent.putExtra(android.content.Intent.EXTRA_STREAM, contentUri);
            shareIntent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            
            android.content.Intent chooser = android.content.Intent.createChooser(shareIntent, "Export Backup");
            chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to export backup: " + e.getMessage());
        }
    }

    @PluginMethod
    public void importBackup(PluginCall call) {
        saveCall(call);
        android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(android.content.Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        startActivityForResult(call, intent, "pickBackupFile");
    }

    @com.getcapacitor.annotation.ActivityCallback
    private void pickBackupFile(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (result.getResultCode() == android.app.Activity.RESULT_OK && result.getData() != null) {
            Uri uri = result.getData().getData();
            if (uri != null) {
                try {
                    java.io.InputStream inputStream = getContext().getContentResolver().openInputStream(uri);
                    java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(inputStream));
                    StringBuilder stringBuilder = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        stringBuilder.append(line);
                    }
                    inputStream.close();
                    
                    JSObject ret = new JSObject();
                    ret.put("data", stringBuilder.toString());
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("Failed to read file: " + e.getMessage());
                }
            } else {
                call.reject("No data returned");
            }
        } else {
            call.reject("User cancelled file selection");
        }
    }

    @PluginMethod
    public void selectDownloadLocation(PluginCall call) {
        saveCall(call);
        android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT_TREE);
        startActivityForResult(call, intent, "pickDirectory");
    }

    @com.getcapacitor.annotation.ActivityCallback
    private void pickDirectory(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (result.getResultCode() == android.app.Activity.RESULT_OK && result.getData() != null) {
            Uri treeUri = result.getData().getData();
            if (treeUri != null) {
                try {
                    int takeFlags = android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION | android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                    getContext().getContentResolver().takePersistableUriPermission(treeUri, takeFlags);
                } catch (Exception ignored) {}

                String docId = null;
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                    docId = android.provider.DocumentsContract.getTreeDocumentId(treeUri);
                }
                
                String relativePath = "";
                if (docId != null) {
                    String[] parts = docId.split(":");
                    if (parts.length > 1) {
                        relativePath = parts[1];
                        if (relativePath.startsWith("Download/")) {
                            relativePath = relativePath.substring("Download/".length());
                        } else if (relativePath.equalsIgnoreCase("Download")) {
                            relativePath = "";
                        }
                    }
                }
                
                if (relativePath.isEmpty()) {
                    String lastSegment = treeUri.getLastPathSegment();
                    if (lastSegment != null) {
                        String[] parts = lastSegment.split(":");
                        relativePath = parts[parts.length - 1];
                    }
                }

                if (relativePath.contains("/")) {
                    relativePath = relativePath.substring(relativePath.lastIndexOf("/") + 1);
                }

                if (relativePath.isEmpty()) {
                    relativePath = "AniPlay";
                }

                JSObject ret = new JSObject();
                ret.put("folderName", relativePath);
                call.resolve(ret);
            } else {
                call.reject("No directory selected");
            }
        } else {
            call.reject("Cancelled");
        }
    }

    @PluginMethod
    public void openExternalDownloader(PluginCall call) {
        String url     = call.getString("url");
        String referer = call.getString("referer", "");
        String title   = call.getString("title", "Video");

        if (url == null) {
            call.reject("url is required");
            return;
        }

        try {
            String pkg = call.getString("package", "");
            android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
            intent.setDataAndType(Uri.parse(url), "video/*");
            
            // Pass standard headers for VLC, MX Player, 1DM, ADM, SPlayer, etc.
            intent.putExtra("title", title);
            if (pkg != null && !pkg.isEmpty()) {
                intent.setPackage(pkg);
            }
            
            // Resolve exact WebView User-Agent
            String ua;
            try { ua = android.webkit.WebSettings.getDefaultUserAgent(getContext()); }
            catch (Exception e) { ua = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"; }

            // Merge cookies from stream URL and referer URL
            StringBuilder sb = new StringBuilder();
            android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
            String c1 = cm.getCookie(url);
            String c2 = referer != null && !referer.isEmpty() ? cm.getCookie(referer) : null;
            if (c1 != null && !c1.isEmpty()) sb.append(c1);
            if (c2 != null && !c2.isEmpty()) {
                if (sb.length() > 0) sb.append("; ");
                sb.append(c2);
            }
            String mergedCookies = sb.toString();

            android.os.Bundle headers = new android.os.Bundle();
            headers.putString("User-Agent", ua);
            if (referer != null && !referer.isEmpty()) {
                headers.putString("Referer", referer);
            }
            if (!mergedCookies.isEmpty()) {
                headers.putString("Cookie", mergedCookies);
            }
            
            intent.putExtra("android.media.intent.extra.HTTP_HEADERS", headers);
            intent.putExtra("headers", headers);

            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            
            try {
                getContext().startActivity(intent);
                call.resolve();
            } catch (android.content.ActivityNotFoundException e) {
                if ("com.hub.splayer".equals(pkg)) {
                    // SPlayer is not installed, redirect to Google Play Store
                    android.content.Intent playStoreIntent = new android.content.Intent(
                        android.content.Intent.ACTION_VIEW, 
                        Uri.parse("market://details?id=com.hub.splayer")
                    );
                    playStoreIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(playStoreIntent);
                    call.resolve();
                } else {
                    call.reject("App not installed: " + pkg);
                }
            }
        } catch (Exception e) {
            call.reject("Failed to launch external downloader: " + e.getMessage());
        }
    }

    void emit(String taskId, int progress, String status, String error) {
        JSObject ev = new JSObject();
        ev.put("taskId", taskId); ev.put("progress", progress); ev.put("status", status);
        if (error != null) ev.put("error", error);
        notifyListeners("downloadProgress", ev);

        try {
            if ("completed".equals(status) || "error".equals(status)) {
                // Handled in task termination
            } else {
                DownloadForegroundService.updateProgress(getContext(), taskId, progress, status);
            }
        } catch (Exception ignored) {}
    }

    // Mux a set of local segment files → single MP4 using FFmpegKit
    File muxConcat(File tempDir, int total, boolean isFmp4, String taskId) throws Exception {
        if (!isFmp4) {
            // For raw TS segments, append them first into combined.ts to ensure FFmpeg can remux it correctly with valid headers
            File combinedTs = new File(tempDir, "combined.ts");
            try (BufferedOutputStream bos = new BufferedOutputStream(new FileOutputStream(combinedTs), 1048576)) {
                byte[] buffer = new byte[1048576]; // 1MB buffer for ultra-fast local merge
                for (int i = 0; i < total; i++) {
                    File seg = new File(tempDir, String.format(java.util.Locale.US, "seg_%06d.ts", i));
                    if (seg.exists()) {
                        try (BufferedInputStream bis = new BufferedInputStream(new FileInputStream(seg), 1048576)) {
                            int read;
                            while ((read = bis.read(buffer)) != -1) {
                                bos.write(buffer, 0, read);
                            }
                        }
                        seg.delete(); // Delete segment immediately to free memory & storage
                    }
                }
                bos.flush();
            }

            File outMp4 = new File(tempDir, "output.mp4");
            
            // Remux the single combined.ts file to output.mp4, writing correct headers and codecs
            com.arthenica.ffmpegkit.FFmpegSession sess = FFmpegKit.executeWithArguments(new String[]{
                "-hide_banner", "-loglevel", "error",
                "-i", combinedTs.getAbsolutePath(),
                "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart",
                "-y", outMp4.getAbsolutePath()
            });

            if (!ReturnCode.isSuccess(sess.getReturnCode())) {
                outMp4.delete();
                sess = FFmpegKit.executeWithArguments(new String[]{
                    "-hide_banner", "-loglevel", "error",
                    "-i", combinedTs.getAbsolutePath(),
                    "-c", "copy", "-movflags", "+faststart",
                    "-y", outMp4.getAbsolutePath()
                });
            }

            combinedTs.delete(); // delete temp combined TS file

            if (!ReturnCode.isSuccess(sess.getReturnCode()) || !outMp4.exists() || outMp4.length() < 50_000) {
                throw new Exception("FFmpeg remux failed (code=" + sess.getReturnCode() + ")");
            }
            Log.d(TAG, "Mux success: " + outMp4.length() + " bytes for taskId=" + taskId);
            return outMp4;
        } else {
            // Original concat demuxer for fMP4 files (which already have correct MP4 headers)
            File concatFile = new File(tempDir, "concat.txt");
            try (BufferedWriter bw = new BufferedWriter(new FileWriter(concatFile))) {
                bw.write("ffconcat version 1.0\n");
                File init = new File(tempDir, "init.mp4");
                if (init.exists()) bw.write("file '" + init.getAbsolutePath() + "'\n");
                for (int i = 0; i < total; i++) {
                    File seg = new File(tempDir, String.format(java.util.Locale.US, "seg_%06d.m4s", i));
                    if (seg.exists()) bw.write("file '" + seg.getAbsolutePath() + "'\n");
                }
            }

            File outMp4 = new File(tempDir, "output.mp4");
            String[] args = buildMuxArgs(concatFile.getAbsolutePath(), outMp4.getAbsolutePath(), true, true);
            com.arthenica.ffmpegkit.FFmpegSession sess = FFmpegKit.executeWithArguments(args);

            if (!ReturnCode.isSuccess(sess.getReturnCode())) {
                outMp4.delete();
                sess = FFmpegKit.executeWithArguments(
                    buildMuxArgs(concatFile.getAbsolutePath(), outMp4.getAbsolutePath(), true, false));
            }

            if (!ReturnCode.isSuccess(sess.getReturnCode()) || !outMp4.exists() || outMp4.length() < 50_000) {
                throw new Exception("FFmpeg mux failed (code=" + sess.getReturnCode() + ")");
            }
            Log.d(TAG, "Mux success: " + outMp4.length() + " bytes for taskId=" + taskId);
            return outMp4;
        }
    }

    private String[] buildMuxArgs(String concatPath, String outPath, boolean isFmp4, boolean withBsf) {
        List<String> a = new ArrayList<>(Arrays.asList(
            "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0",
            "-i", concatPath,
            "-c", "copy"
        ));
        if (withBsf && !isFmp4) { a.add("-bsf:a"); a.add("aac_adtstoasc"); }
        a.add("-movflags"); a.add("+faststart");
        a.add("-y"); a.add(outPath);
        return a.toArray(new String[0]);
    }

    void saveToGallery(File src, String name) throws Exception {
        String folder = getDownloadFolder();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4");
            cv.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/" + folder);
            Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) throw new Exception("MediaStore insert null");
            try (InputStream in  = new BufferedInputStream(new FileInputStream(src));
                 OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new Exception("MediaStore stream null");
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                out.flush();
            }
        } else {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), folder);
            dir.mkdirs();
            File dest = new File(dir, name);
            try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dest)) {
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                out.flush();
            }
            MediaScannerConnection.scanFile(getContext(), new String[]{dest.getAbsolutePath()},
                new String[]{"video/mp4"}, null);
        }
    }

    static void rmrf(File f) {
        if (f == null) return;
        if (f.isDirectory()) { File[] c = f.listFiles(); if (c != null) for (File k : c) rmrf(k); }
        f.delete();
    }

    // ── Inner state classes ───────────────────────────────────────────────────

    private static class JSDownloadState {
        String outputName; File tempDir; int total; boolean isFmp4;
        final AtomicInteger written = new AtomicInteger(0);
    }

    // ── Path B: Java-native HLS download task ─────────────────────────────────

    static class JavaDLTask implements Runnable {
        final String taskId, animeId, animeTitle, episode, srvUrl, referer, cover, track, subsJson;
        final String deviceUA;   // actual device WebView UA — must match embed page UA for CDN token validation
        final String cachedCookie; // pre-resolved cookie to avoid synchronized IPC contention across 16 threads
        final boolean isHls;
        final String playlistContent;
        final Context ctx;
        final OfflineDownloader plugin;
        final OkHttpClient http;
        final AtomicInteger lastProg = new AtomicInteger(0);
        final AtomicBoolean isCancelled = new AtomicBoolean(false);
        private volatile ExecutorService currentPool = null;
        private volatile File currentTempDir = null;
        private final List<okhttp3.Call> activeCalls = new CopyOnWriteArrayList<>();

        public void cancel() {
            isCancelled.set(true);
            for (okhttp3.Call call : activeCalls) {
                try { call.cancel(); } catch (Exception ignored) {}
            }
            activeCalls.clear();
            if (currentPool != null) {
                try { currentPool.shutdownNow(); } catch (Exception ignored) {}
            }
            if (currentTempDir != null) {
                OfflineDownloader.rmrf(currentTempDir);
            }
        }

        JavaDLTask(String taskId, String animeId, String animeTitle, String episode,
                   String srvUrl, String referer, String cover, String track,
                   String subsJson, boolean isHls, String playlistContent,
                   Context ctx, OfflineDownloader plugin, OkHttpClient http) {
            this.taskId = taskId; this.animeId = animeId; this.animeTitle = animeTitle;
            this.episode = episode; this.srvUrl = srvUrl; this.referer = referer;
            this.cover = cover; this.track = track; this.subsJson = subsJson;
            this.isHls = isHls; this.playlistContent = playlistContent;
            this.ctx = ctx; this.plugin = plugin; this.http = http;

            // Resolve the device's actual WebView User-Agent ONCE at construction time.
            String resolvedUA;
            try { resolvedUA = android.webkit.WebSettings.getDefaultUserAgent(ctx); }
            catch (Exception e) { resolvedUA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"; }
            this.deviceUA = resolvedUA;

            // Resolve cookies ONCE so 16 parallel threads don't block each other on Android WebKit IPC
            String resolvedCookie = "";
            try {
                android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
                String c1 = cm.getCookie(srvUrl);
                String c2 = referer != null && !referer.isEmpty() ? cm.getCookie(referer) : null;
                StringBuilder sb = new StringBuilder();
                if (c1 != null && !c1.isEmpty()) sb.append(c1);
                if (c2 != null && !c2.isEmpty()) {
                    if (sb.length() > 0) sb.append("; ");
                    sb.append(c2);
                }
                resolvedCookie = sb.toString();
            } catch (Exception ignored) {}
            this.cachedCookie = resolvedCookie;
        }

        private String getUniqueFileName(String baseName, String extension) {
            String folder = plugin.getDownloadFolder();
            String candidate = baseName + extension;
            Uri contentUri = extension.endsWith(".mp4") ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Files.getContentUri("external");
            String pathColumn = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? MediaStore.MediaColumns.RELATIVE_PATH : MediaStore.MediaColumns.DATA;
            
            boolean exists = false;
            try (android.database.Cursor cursor = ctx.getContentResolver().query(
                contentUri,
                new String[]{ MediaStore.MediaColumns.DISPLAY_NAME },
                MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + pathColumn + " LIKE ?",
                new String[]{ candidate, "%Download/" + folder + "%" },
                null
            )) {
                if (cursor != null) exists = cursor.getCount() > 0;
            } catch (Exception ignored) {}
            
            if (!exists) return baseName;
            
            int idx = 1;
            while (true) {
                candidate = baseName + " (" + idx + ")" + extension;
                exists = false;
                try (android.database.Cursor cursor = ctx.getContentResolver().query(
                    contentUri,
                    new String[]{ MediaStore.MediaColumns.DISPLAY_NAME },
                    MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + pathColumn + " LIKE ?",
                    new String[]{ candidate, "%Download/" + folder + "%" },
                    null
                )) {
                    if (cursor != null) exists = cursor.getCount() > 0;
                } catch (Exception ignored) {}
                
                if (!exists) return baseName + " (" + idx + ")";
                idx++;
            }
        }

        @Override
        public void run() {
            String safe = animeTitle.replaceAll("[\\\\/:*?\"<>|]", "_");
            String base = safe + " - Ep " + episode + " (" + track.toUpperCase() + ")";
            String uniqueBaseName = getUniqueFileName(base, ".mp4");
            String fileName = uniqueBaseName + ".mp4";
            String notifTitle = safe + " - Ep " + episode;
            boolean success = false;
            PowerManager.WakeLock taskWakeLock = null;
            try {
                PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    taskWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AniPlay:TaskWakeLock_" + taskId);
                    taskWakeLock.acquire(4 * 60 * 60 * 1000L);
                }
            } catch (Exception ignored) {}

            try {
                DownloadForegroundService.startDownload(ctx, taskId, notifTitle);
                plugin.emit(taskId, 0, "downloading", null);
                if (isHls) downloadHLS(fileName);
                else downloadMP4Direct(fileName);
                if (isCancelled.get()) {
                    Log.d(TAG, "Task cancelled, skipping completion emit for " + taskId);
                    return;
                }
                downloadSubtitles(uniqueBaseName);
                success = true;
                plugin.emit(taskId, 100, "completed", null);
            } catch (Exception e) {
                if (isCancelled.get()) {
                    Log.d(TAG, "Task cancelled for " + taskId);
                } else {
                    Log.e(TAG, "Download failed for " + taskId, e);
                    plugin.emit(taskId, 0, "error", e.getMessage());
                }
            } finally {
                if (currentTempDir != null && (!success || isCancelled.get())) {
                    OfflineDownloader.rmrf(currentTempDir);
                }
                if (taskWakeLock != null && taskWakeLock.isHeld()) {
                    try { taskWakeLock.release(); } catch (Exception ignored) {}
                }
                DownloadForegroundService.stopDownload(ctx, taskId, success, notifTitle);
                plugin.javaDLs.remove(taskId);
            }
        }

        private static class FetchResult {
            final String finalUrl;
            final List<String> lines;
            FetchResult(String finalUrl, List<String> lines) {
                this.finalUrl = finalUrl;
                this.lines = lines;
            }
        }

        private String resolveUrl(String baseUrl, String relUrl) {
            if (relUrl == null || relUrl.trim().isEmpty()) return relUrl;
            String trimmed = relUrl.trim();
            if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                return trimmed;
            }
            try {
                URL base = new URL(baseUrl);
                URL resolved = new URL(base, trimmed);
                String res = resolved.toString();
                if (base.getQuery() != null && !base.getQuery().isEmpty() && !res.contains("?")) {
                    res = res + "?" + base.getQuery();
                }
                return res;
            } catch (Exception e) {
                String cleanBase = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);
                String res = cleanBase + trimmed;
                try {
                    URL base = new URL(baseUrl);
                    if (base.getQuery() != null && !base.getQuery().isEmpty() && !res.contains("?")) {
                        res = res + "?" + base.getQuery();
                    }
                } catch (Exception ignored) {}
                return res;
            }
        }

        private FetchResult fetchLinesWithUrl(String urlStr) throws Exception {
            Request req = buildRequest(urlStr);
            try (Response resp = http.newCall(req).execute()) {
                if (!resp.isSuccessful() || resp.body() == null) {
                    throw new IOException("HTTP " + resp.code() + " for " + urlStr);
                }
                String finalUrl = resp.request().url().toString();
                byte[] body = resp.body().bytes();
                String text = new String(body, java.nio.charset.StandardCharsets.UTF_8).replace("\uFEFF", "");
                List<String> ls = new ArrayList<>(Arrays.asList(text.split("\\r?\\n")));
                if (!ls.isEmpty()) {
                    String first = ls.get(0).trim();
                    if (!first.startsWith("#EXTM3U") && !first.startsWith("#EXT")) {
                        String preview = first.length() > 80 ? first.substring(0, 80) : first;
                        throw new IOException("Non-M3U8 response: " + preview);
                    }
                }
                Log.d(TAG, "fetchLines " + urlStr + " (final: " + finalUrl + ") → " + ls.size() + " lines");
                return new FetchResult(finalUrl, ls);
            }
        }

        private void downloadHLS(String fileName) throws Exception {
            String targetUrl = srvUrl;
            Log.d(TAG, "=== downloadHLS START ===");
            Log.d(TAG, "srvUrl: " + srvUrl);
            Log.d(TAG, "referer: " + referer);
            Log.d(TAG, "deviceUA: " + deviceUA);
            Log.d(TAG, "playlistContent.length: " + (playlistContent != null ? playlistContent.length() : 0));

            // Use pre-fetched playlist from JS if available
            List<String> lines;
            if (playlistContent != null && playlistContent.length() > 20
                && (playlistContent.contains("#EXTM3U") || playlistContent.contains("#EXT-X"))) {
                lines = new ArrayList<>(Arrays.asList(playlistContent.replace("\r\n", "\n").split("\n")));
                Log.d(TAG, "Using JS pre-fetched playlist (" + lines.size() + " lines)");
            } else {
                Log.d(TAG, "Fetching playlist via OkHttp: " + targetUrl);
                FetchResult res = fetchLinesWithUrl(targetUrl);
                targetUrl = res.finalUrl;
                lines = res.lines;
            }

            // Handle master playlist
            for (String l : lines) {
                if (l.contains("#EXT-X-STREAM-INF")) {
                    String best = pickBestVariant(lines, targetUrl);
                    if (best != null) {
                        Log.d(TAG, "Master playlist selected variant: " + best);
                        FetchResult childRes = fetchLinesWithUrl(best);
                        targetUrl = childRes.finalUrl;
                        lines = childRes.lines;
                    }
                    break;
                }
            }

            List<String> cleanLines = new ArrayList<>();
            List<String> segUrls   = new ArrayList<>();
            List<byte[]> segIVs    = new ArrayList<>();
            double totalDur = 0.0;
            String initUrl = null; boolean isFmp4 = false;
            boolean isEnc = false; byte[] curKey = null; byte[] curIV = null;
            int seqNum = 0; String pendingExtInf = null;

            for (String raw : lines) {
                String t = raw.trim();
                if (t.startsWith("#EXT-X-MEDIA-SEQUENCE")) {
                    try { seqNum = Integer.parseInt(t.split(":")[1].trim()); } catch (Exception ignored) {}
                    cleanLines.add(t);
                } else if (t.startsWith("#EXT-X-MAP")) {
                    isFmp4 = true;
                    String uri = extractAttr(t, "URI");
                    if (uri != null) {
                        uri = uri.replaceAll("^\"|\"$", "");
                        uri = resolveUrl(targetUrl, uri);
                        initUrl = uri;
                        t = "#EXT-X-MAP:URI=\"" + uri + "\"";
                    }
                    cleanLines.add(t);
                } else if (t.startsWith("#EXT-X-KEY")) {
                    String method = extractAttr(t, "METHOD");
                    if ("AES-128".equalsIgnoreCase(method)) {
                        isEnc = true;
                        String uri = extractAttr(t, "URI");
                        if (uri != null) {
                            uri = uri.replaceAll("^\"|\"$", "");
                            uri = resolveUrl(targetUrl, uri);
                            try { curKey = fetchBytes(uri); } catch (Exception ignored) {}
                        }
                        String ivStr = extractAttr(t, "IV");
                        curIV = (ivStr != null && ivStr.startsWith("0x")) ? hex2bytes(ivStr.substring(2)) : null;
                        
                        // Point to local key.bin file in clean.m3u8
                        t = "#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"";
                        if (ivStr != null) {
                            t += ",IV=" + ivStr;
                        }
                    }
                    cleanLines.add(t);
                } else if (t.startsWith("#EXTINF:")) {
                    pendingExtInf = t;
                } else if (!t.isEmpty() && !t.startsWith("#")) {
                    String abs = resolveUrl(targetUrl, t);
                    boolean isAd = abs.contains("adserver")
                                   || abs.contains("doubleclick")
                                   || abs.contains("googlesyndication")
                                   || abs.contains("googleads");
                    if (!isAd) {
                        if (pendingExtInf != null) {
                            cleanLines.add(pendingExtInf);
                            try { totalDur += Double.parseDouble(pendingExtInf.substring(8).split(",")[0].trim()); }
                            catch (Exception ignored) {}
                            pendingExtInf = null;
                        }
                        cleanLines.add(abs); segUrls.add(abs);
                        if (isEnc) {
                            if (curIV != null) { segIVs.add(curIV.clone()); }
                            else { byte[] iv = new byte[16]; int s = seqNum; for (int b = 15; b >= 0; b--) { iv[b] = (byte)(s & 0xFF); s >>= 8; } segIVs.add(iv); }
                        }
                        seqNum++;
                    } else { pendingExtInf = null; }
                } else { cleanLines.add(t); }
            }

            if (segUrls.isEmpty()) throw new Exception("No video segments found in playlist");
            final double dur = totalDur > 0 ? totalDur : 1440.0;
            Log.d(TAG, "Segments: " + segUrls.size() + " fmp4=" + isFmp4 + " enc=" + isEnc);

            // Temp dir
            File tempDir = new File(ctx.getCacheDir(), "dl_" + taskId);
            currentTempDir = tempDir;
            OfflineDownloader.rmrf(tempDir); tempDir.mkdirs();

            // Init segment (fMP4)
            if (isFmp4 && initUrl != null) {
                if (isCancelled.get()) return;
                byte[] initData = fetchBytes(initUrl);
                try (FileOutputStream fos = new FileOutputStream(new File(tempDir, "init.mp4"))) { fos.write(initData); }
            }

            // Download segments in parallel (16 threads for ultra-fast throughput)
            int total = segUrls.size();
            AtomicInteger done = new AtomicInteger(0);
            AtomicBoolean failed = new AtomicBoolean(false);
            AtomicReference<Exception> failEx = new AtomicReference<>();
            final boolean enc = isEnc; final byte[] fKey = curKey; final List<byte[]> fIVs = segIVs;

            ExecutorService pool = Executors.newFixedThreadPool(16); // 16 parallel segment downloads for maximum throughput
            currentPool = pool;
            List<Future<?>> futures = new ArrayList<>();
            for (int i = 0; i < total; i++) {
                final int idx = i;
                final String segUrl = segUrls.get(i);
                final byte[] iv = enc && idx < fIVs.size() ? fIVs.get(idx) : null;
                final File segFile = new File(tempDir, String.format(java.util.Locale.US, "seg_%06d.%s", idx, isFmp4 ? "m4s" : "ts"));
                futures.add(pool.submit(() -> {
                    if (failed.get() || isCancelled.get()) return;
                    for (int r = 0; r < 5; r++) {
                        if (isCancelled.get()) return;
                        try {
                            if (r > 0) {
                                try { Thread.sleep(r * 200L); } catch (InterruptedException ignored) {}
                            }
                            if (isCancelled.get()) return;
                            Request req = (r == 0) ? buildRequest(segUrl) : buildAdaptiveRequest(segUrl, r);
                            okhttp3.Call call = http.newCall(req);
                            activeCalls.add(call);
                            try (Response resp = call.execute()) {
                                activeCalls.remove(call);
                                if (isCancelled.get()) return;
                                int code = resp.code();
                                if (!resp.isSuccessful() || resp.body() == null) {
                                    String bodySnippet = "";
                                    try {
                                        if (resp.body() != null) {
                                            String bodyStr = resp.body().string();
                                            bodySnippet = bodyStr.substring(0, Math.min(100, bodyStr.length())).replaceAll("\\s+", " ");
                                        }
                                    } catch (Exception ignored) {}
                                    String urlShort = segUrl.length() > 70 ? segUrl.substring(0, 70) + "..." : segUrl;
                                    String refShort = referer.length() > 35 ? referer.substring(0, 35) + "..." : referer;
                                    String msg = "HTTP " + code + " | URL: " + urlShort + " | Ref: " + refShort
                                            + (bodySnippet.isEmpty() ? "" : " | Body: " + bodySnippet);
                                    Log.e(TAG, "[Seg" + idx + "/r" + r + "] " + msg);
                                    throw new IOException(msg);
                                }
                                if (enc && fKey != null && iv != null) {
                                    byte[] encryptedData = resp.body().bytes();
                                    byte[] decryptedData = aesDecrypt(encryptedData, fKey, iv);
                                    try (FileOutputStream fos = new FileOutputStream(segFile);
                                         BufferedOutputStream bos = new BufferedOutputStream(fos, 524288)) {
                                        bos.write(decryptedData);
                                        bos.flush();
                                    }
                                } else {
                                    try (InputStream is = resp.body().byteStream();
                                         FileOutputStream fos = new FileOutputStream(segFile);
                                         BufferedOutputStream bos = new BufferedOutputStream(fos, 524288)) {
                                        java.io.BufferedInputStream bis = new java.io.BufferedInputStream(is, 524288);
                                        bis.mark(1024);
                                        byte[] header = new byte[8];
                                        int readHead = bis.read(header);
                                        boolean isPng = readHead == 8
                                            && header[0] == (byte) 0x89 && header[1] == (byte) 0x50
                                            && header[2] == (byte) 0x4e && header[3] == (byte) 0x47
                                            && header[4] == (byte) 0x0d && header[5] == (byte) 0x0a
                                            && header[6] == (byte) 0x1a && header[7] == (byte) 0x0a;
                                        bis.reset();
                                        if (isPng) {
                                            int matchIndex = 0;
                                            byte[] target = new byte[]{ 0x49, 0x45, 0x4e, 0x44 };
                                            while (true) {
                                                int b = bis.read();
                                                if (b == -1) break;
                                                if (b == (target[matchIndex] & 0xFF)) {
                                                    matchIndex++;
                                                    if (matchIndex == 4) {
                                                        bis.skip(4);
                                                        break;
                                                    }
                                                } else {
                                                    matchIndex = (b == (target[0] & 0xFF)) ? 1 : 0;
                                                }
                                            }
                                        }
                                        byte[] buf = new byte[524288]; // 512KB buffer for ultra-fast throughput
                                        int read;
                                        while ((read = bis.read(buf)) != -1) {
                                            bos.write(buf, 0, read);
                                        }
                                        bos.flush();
                                    }
                                }
                            } catch (Exception ex) {
                                activeCalls.remove(call);
                                if (isCancelled.get()) return;
                                throw ex;
                            }
                            if (isCancelled.get()) return;
                            int comp = done.incrementAndGet();
                            int prog = Math.min(90, (int) Math.round((double) comp * 90.0 / total));
                            int last = lastProg.get();
                            while (prog > last) {
                                if (lastProg.compareAndSet(last, prog)) {
                                    plugin.emit(taskId, prog, "downloading", null);
                                    break;
                                }
                                last = lastProg.get();
                            }
                            return;
                        } catch (Exception e) {
                            if (isCancelled.get()) return;
                            Log.w(TAG, "Segment " + idx + " download failed (attempt " + (r + 1) + "/4): " + e.getMessage());
                            if (r >= 3) { failed.set(true); failEx.set(e); }
                            else { try { Thread.sleep(Math.min(600, (r + 1) * 200)); } catch (Exception ignored) {} }
                        }
                    }
                }));
            }
            pool.shutdown();
            try { pool.awaitTermination(15, TimeUnit.MINUTES); } catch (InterruptedException ie) { failed.set(true); }

            if (isCancelled.get()) {
                OfflineDownloader.rmrf(tempDir);
                return;
            }

            if (failed.get()) {
                OfflineDownloader.rmrf(tempDir);
                throw new Exception("Segment download failed: " + (failEx.get() != null ? failEx.get().getMessage() : "unknown"));
            }

            plugin.emit(taskId, 92, "processing", null);
            File muxed = plugin.muxConcat(tempDir, total, isFmp4, taskId);
            if (isCancelled.get()) {
                OfflineDownloader.rmrf(tempDir);
                return;
            }
            plugin.emit(taskId, 97, "processing", null);
            plugin.saveToGallery(muxed, fileName);
            OfflineDownloader.rmrf(tempDir);
        }

        private String pickBestVariant(List<String> lines, String masterUrl) {
            long maxBw = -1; int maxRes = -1; String best = null; String inf = null;
            for (String l : lines) {
                l = l.trim();
                if (l.startsWith("#EXT-X-STREAM-INF")) { inf = l; }
                else if (!l.isEmpty() && !l.startsWith("#") && inf != null) {
                    long bw = 0; int rw = 0;
                    java.util.regex.Matcher m1 = java.util.regex.Pattern.compile("BANDWIDTH=(\\d+)").matcher(inf);
                    if (m1.find()) bw = Long.parseLong(m1.group(1));
                    java.util.regex.Matcher m2 = java.util.regex.Pattern.compile("RESOLUTION=(\\d+)x(\\d+)").matcher(inf);
                    if (m2.find()) rw = Integer.parseInt(m2.group(1));
                    if (rw > maxRes || (rw == maxRes && bw > maxBw)) { maxRes = rw; maxBw = bw; best = l; }
                    inf = null;
                }
            }
            if (best == null) return null;
            return resolveUrl(masterUrl, best);
        }

        private void downloadMP4Direct(String fileName) throws Exception {
            Request req = buildRequest(srvUrl);
            String folder = plugin.getDownloadFolder();
            try (Response resp = http.newCall(req).execute()) {
                if (!resp.isSuccessful() || resp.body() == null) throw new IOException("HTTP " + resp.code());
                InputStream is = resp.body().byteStream();
                long length = resp.body().contentLength();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                    cv.put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4");
                    cv.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/" + folder);
                    Uri uri = ctx.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) throw new Exception("MediaStore insert null");
                    try (OutputStream os = ctx.getContentResolver().openOutputStream(uri)) {
                        if (os == null) throw new Exception("MediaStore stream null");
                        pipe(is, os, length);
                    }
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), folder);
                    dir.mkdirs();
                    File out = new File(dir, fileName);
                    try (OutputStream os = new FileOutputStream(out)) { pipe(is, os, length); }
                    MediaScannerConnection.scanFile(ctx, new String[]{out.getAbsolutePath()}, new String[]{"video/mp4"}, null);
                }
            }
        }

        // ── Helpers ─────────────────────────────────────────────────────────

        private List<String> fetchLines(String urlStr) throws Exception {
            byte[] body = fetchBytes(urlStr);
            String text = new String(body, "UTF-8").replace("\uFEFF", "");
            List<String> ls = new ArrayList<>(Arrays.asList(text.split("\\r?\\n")));
            if (!ls.isEmpty()) {
                String first = ls.get(0).trim();
                if (!first.startsWith("#EXTM3U") && !first.startsWith("#EXT")) {
                    String preview = first.length() > 80 ? first.substring(0, 80) : first;
                    throw new IOException("Non-M3U8 response: " + preview);
                }
            }
            Log.d(TAG, "fetchLines " + urlStr + " → " + ls.size() + " lines");
            return ls;
        }

        byte[] fetchBytes(String urlStr) throws Exception {
            // Use buildRequest (fixed headers matching v1.5.7) — not adaptive.
            // If the CDN requires anineko.to referer, adaptive would fail on retries.
            Request req = buildRequest(urlStr);
            try (Response resp = http.newCall(req).execute()) {
                if (!resp.isSuccessful() || resp.body() == null) {
                    throw new IOException("HTTP " + resp.code() + " for " + urlStr);
                }
                return resp.body().bytes();
            }
        }

        private String getProperReferer(String urlStr, String fallbackRef) {
            if (urlStr == null) return fallbackRef != null ? fallbackRef : "";
            String lower = urlStr.toLowerCase();
            if (lower.contains("megap.shiora") || lower.contains("megaplay") || lower.contains("rabbitstream") || lower.contains("mfast") || lower.contains("megacloud") || lower.contains("rapid-cloud")) {
                return "https://megaplay.buzz/";
            }
            if (lower.contains("akirax.buzz") || lower.contains("vidtube") || lower.contains("vidstream")) {
                return "https://vidtube.site/";
            }
            if (lower.contains("vibevibe.workers.dev") || lower.contains("bibiemb")) {
                return "https://bibiemb.xyz/";
            }
            if (lower.contains("vivibebe")) {
                return "https://vivibebe.site/";
            }
            if (lower.contains("vidplay") || lower.contains("mycloud") || lower.contains("mcloud")) {
                return "https://vidplay.online/";
            }
            if (lower.contains("ibyteimg") || lower.contains("byteimg")) {
                return ""; // Clean hotlink mode for ByteDance CDN
            }
            if (fallbackRef != null && !fallbackRef.isEmpty()) {
                try {
                    URL u = new URL(fallbackRef);
                    return u.getProtocol() + "://" + u.getHost() + "/";
                } catch (Exception e) {
                    return fallbackRef;
                }
            }
            try {
                URL u = new URL(urlStr);
                return u.getProtocol() + "://" + u.getHost() + "/";
            } catch (Exception e) {
                return "";
            }
        }

        /**
         * Fixed-header request builder — matches host-specific CDN requirements.
         */
        private Request buildRequest(String urlStr) {
            Request.Builder b = new Request.Builder().url(urlStr).get();
            b.header("User-Agent", deviceUA);
            b.header("Accept", "*/*");
            b.header("Accept-Language", "en-US,en;q=0.9");
            b.header("Connection", "keep-alive");
            String effRef = getProperReferer(urlStr, referer);
            if (!effRef.isEmpty()) {
                b.header("Referer", effRef);
                try { URL ref = new URL(effRef); b.header("Origin", ref.getProtocol() + "://" + ref.getHost()); }
                catch (Exception ignored) {}
            }
            if (cachedCookie != null && !cachedCookie.isEmpty()) {
                b.header("Cookie", cachedCookie);
            }
            return b.build();
        }

        private Request buildAdaptiveRequest(String urlStr, int attempt) {
            Request.Builder b = new Request.Builder().url(urlStr).get();
            b.header("User-Agent", deviceUA);
            b.header("Accept", "*/*");
            b.header("Accept-Language", "en-US,en;q=0.9");
            b.header("Connection", "keep-alive");

            String properRef = getProperReferer(urlStr, referer);
            String effectiveReferer = "";
            if (attempt == 0) {
                effectiveReferer = properRef;
            } else if (attempt == 1) {
                // attempt 1: Clean direct hotlink mode (no Referer/Origin) - bypasses anti-hotlinking rules
                effectiveReferer = "";
            } else if (attempt == 2) {
                try {
                    URL u = new URL(urlStr);
                    effectiveReferer = u.getProtocol() + "://" + u.getHost() + "/";
                } catch (Exception ignored) {}
            } else if (attempt == 3) {
                if (properRef != null && !properRef.isEmpty()) {
                    effectiveReferer = properRef;
                } else if (referer != null && !referer.isEmpty()) {
                    try {
                        URL u = new URL(referer);
                        effectiveReferer = u.getProtocol() + "://" + u.getHost() + "/";
                    } catch (Exception ignored) {}
                }
            } else {
                effectiveReferer = srvUrl;
            }

            if (effectiveReferer != null && !effectiveReferer.isEmpty()) {
                b.header("Referer", effectiveReferer);
                try { URL ref = new URL(effectiveReferer); b.header("Origin", ref.getProtocol() + "://" + ref.getHost()); }
                catch (Exception ignored) {}
            }

            // Inject cookies from CookieManager
            try {
                StringBuilder sb = new StringBuilder();
                android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
                String c1 = cm.getCookie(urlStr);
                String c2 = (effectiveReferer != null && !effectiveReferer.isEmpty()) ? cm.getCookie(effectiveReferer) : null;
                if (c1 != null && !c1.isEmpty()) sb.append(c1);
                if (c2 != null && !c2.isEmpty()) {
                    if (sb.length() > 0) sb.append("; ");
                    sb.append(c2);
                }
                String cookie = sb.toString();
                if (!cookie.isEmpty()) {
                    b.header("Cookie", cookie);
                }
            } catch (Exception ignored) {}

            return b.build();
        }

        private void pipe(InputStream in, OutputStream out, long total) throws IOException {
            byte[] buf = new byte[65536]; long done = 0; int n; int lastP = 0;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n); done += n;
                if (total > 0) {
                    int p = (int)(done * 95L / total);
                    if (p > lastP) { lastP = p; plugin.emit(taskId, Math.min(p, 95), "downloading", null); }
                }
            }
            out.flush();
        }



        private String extractAttr(String line, String attr) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile(
                attr + "=(?:\"([^\"]*)\"|'([^']*)'|([^,\\s]+))",
                java.util.regex.Pattern.CASE_INSENSITIVE).matcher(line);
            if (m.find()) { for (int g = 1; g <= 3; g++) if (m.group(g) != null) return m.group(g); }
            return null;
        }

        private byte[] hex2bytes(String hex) {
            byte[] d = new byte[hex.length() / 2];
            for (int i = 0; i < hex.length(); i += 2)
                d[i/2] = (byte)((Character.digit(hex.charAt(i), 16) << 4) + Character.digit(hex.charAt(i+1), 16));
            return d;
        }

        private byte[] aesDecrypt(byte[] data, byte[] key, byte[] iv) throws Exception {
            javax.crypto.spec.SecretKeySpec ks = new javax.crypto.spec.SecretKeySpec(key, "AES");
            javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("AES/CBC/NoPadding");
            cipher.init(javax.crypto.Cipher.DECRYPT_MODE, ks, new javax.crypto.spec.IvParameterSpec(iv));
            return cipher.doFinal(data);
        }

        private void downloadSubtitles(String baseName) {
            if (subsJson == null || subsJson.isEmpty()) return;
            String subUrl = null;
            try {
                org.json.JSONArray arr = new org.json.JSONArray(subsJson);
                for (int i = 0; i < arr.length(); i++) {
                    org.json.JSONObject obj = arr.getJSONObject(i);
                    String lang = obj.optString("lang", "").toLowerCase();
                    if (lang.isEmpty()) lang = obj.optString("label", "").toLowerCase();
                    
                    if (lang.contains("english") || lang.contains("eng") || lang.startsWith("en") || lang.isEmpty()) {
                        subUrl = obj.optString("url", "");
                        if (subUrl.isEmpty()) subUrl = obj.optString("file", "");
                        if (!subUrl.isEmpty()) break;
                    }
                }
                if (subUrl == null || subUrl.isEmpty()) {
                    if (arr.length() > 0) {
                        subUrl = arr.getJSONObject(0).optString("url", "");
                        if (subUrl.isEmpty()) subUrl = arr.getJSONObject(0).optString("file", "");
                    }
                }
                if (subUrl == null || subUrl.isEmpty()) return;

                // Resolve protocol relative URLs
                if (subUrl.startsWith("//")) {
                    subUrl = "https:" + subUrl;
                }

                String subReferer = referer;
                // Resolve proxied subtitle URLs or url query params
                if (subUrl.contains("/api/stream/subtitle?") || subUrl.contains("url=")) {
                    try {
                        Uri uri = Uri.parse(subUrl.startsWith("http") ? subUrl : "https://dummy.org" + subUrl);
                        String innerUrl = uri.getQueryParameter("url");
                        if (innerUrl != null && !innerUrl.isEmpty()) {
                            subUrl = innerUrl;
                        }
                        String innerRef = uri.getQueryParameter("referer");
                        if (innerRef != null && !innerRef.isEmpty()) {
                            subReferer = innerRef;
                        }
                    } catch (Exception ignored) {}
                }

                // Fetch subtitles with appropriate headers
                Request.Builder reqBuilder = new Request.Builder()
                    .url(subUrl)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
                    .header("Accept", "*/*");
                
                if (subReferer != null && !subReferer.isEmpty()) {
                    reqBuilder.header("Referer", subReferer);
                    try {
                        Uri refUri = Uri.parse(subReferer);
                        reqBuilder.header("Origin", refUri.getScheme() + "://" + refUri.getHost());
                    } catch (Exception ignored) {}
                }

                Request req = reqBuilder.build();
                byte[] data;
                try (Response resp = http.newCall(req).execute()) {
                    if (!resp.isSuccessful() || resp.body() == null) throw new IOException("HTTP " + resp.code());
                    data = resp.body().bytes();
                }

                String subName = baseName + ".vtt";
                String folder = plugin.getDownloadFolder();

                // Always write directly to disk as primary or fallback
                try {
                    writeSubtitleFallback(subName, data, folder);
                } catch (Exception exDirect) {
                    Log.w(TAG, "Direct subtitle write failed: " + exDirect.getMessage());
                }

                // Also index in MediaStore on Android Q+
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try {
                        ContentValues cv = new ContentValues();
                        cv.put(MediaStore.MediaColumns.DISPLAY_NAME, subName);
                        cv.put(MediaStore.MediaColumns.MIME_TYPE, "text/vtt");
                        cv.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/" + folder);
                        Uri uri = ctx.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                        if (uri != null) {
                            try (OutputStream os = ctx.getContentResolver().openOutputStream(uri)) {
                                if (os != null) { os.write(data); os.flush(); }
                            }
                        }
                    } catch (Exception ex) {
                        Log.w(TAG, "MediaStore subtitle insert failed: " + ex.getMessage());
                    }
                }
            } catch (Exception e) { 
                Log.e(TAG, "Subtitle download failed", e);
                try {
                    StringWriter sw = new StringWriter();
                    e.printStackTrace(new PrintWriter(sw));
                    plugin.writeDiagLog("Subtitle download failed for " + baseName + " / " + subUrl + "\n\nStacktrace:\n" + sw.toString());
                } catch (Exception ignored) {}
            }
        }

        private void writeSubtitleFallback(String subName, byte[] data, String folder) throws Exception {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), folder);
            dir.mkdirs();
            File out = new File(dir, subName);
            try (FileOutputStream fos = new FileOutputStream(out)) { 
                fos.write(data); 
                fos.flush();
            }
        }
    }

    private static final Map<String, List<InetAddress>> dohDnsCache = new ConcurrentHashMap<>();
    private static volatile OkHttpClient dohHttpClient = null;

    private static synchronized OkHttpClient getDohHttpClient() {
        if (dohHttpClient == null) {
            OkHttpClient.Builder builder = new OkHttpClient.Builder()
                .connectTimeout(4, TimeUnit.SECONDS)
                .readTimeout(4, TimeUnit.SECONDS);
            configureUnsafeSsl(builder);
            dohHttpClient = builder.build();
        }
        return dohHttpClient;
    }

    private List<InetAddress> resolveDnsOverHttps(String hostname) {
        List<InetAddress> cached = dohDnsCache.get(hostname);
        if (cached != null && !cached.isEmpty()) {
            return cached;
        }

        try {
            OkHttpClient client = getDohHttpClient();

            String[] providers = {
                "https://cloudflare-dns.com/dns-query?name=" + hostname + "&type=A",
                "https://dns.google/resolve?name=" + hostname + "&type=A",
                "https://1.1.1.1/dns-query?name=" + hostname + "&type=A",
                "https://8.8.8.8/resolve?name=" + hostname + "&type=A"
            };

            for (String url : providers) {
                try {
                    Request req = new Request.Builder()
                        .url(url)
                        .header("Accept", "application/dns-json")
                        .build();

                    try (Response resp = client.newCall(req).execute()) {
                        if (resp.isSuccessful() && resp.body() != null) {
                            String body = resp.body().string();
                            JSONObject json = new JSONObject(body);
                            if (json.has("Answer")) {
                                JSONArray answer = json.getJSONArray("Answer");
                                List<InetAddress> addresses = new ArrayList<>();
                                for (int i = 0; i < answer.length(); i++) {
                                    JSONObject ans = answer.getJSONObject(i);
                                    if (ans.has("type") && ans.getInt("type") == 1) {
                                        String ip = ans.getString("data");
                                        addresses.add(InetAddress.getByName(ip));
                                    }
                                }
                                if (!addresses.isEmpty()) {
                                    dohDnsCache.put(hostname, addresses);
                                    Log.d("AniPlayDL", "DoH resolved and cached " + hostname + " to " + addresses);
                                    return addresses;
                                }
                            }
                        }
                    }
                } catch (Exception e) {
                    Log.w("AniPlayDL", "DoH query failed for provider: " + url + " - " + e.getMessage());
                }
            }
        } catch (Exception e) {
            Log.e("AniPlayDL", "DoH resolution failed", e);
        }
        return null;
    }

    void writeDiagLog(String content) {
        try {
            String logName = "aniplay_diag_" + System.currentTimeMillis() + ".txt";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, logName);
                cv.put(MediaStore.MediaColumns.MIME_TYPE, "text/plain");
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/AniPlay");
                Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri != null) {
                    try (OutputStream os = getContext().getContentResolver().openOutputStream(uri)) {
                        if (os != null) os.write(content.getBytes("UTF-8"));
                    }
                }
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "AniPlay");
                dir.mkdirs();
                File out = new File(dir, logName);
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    fos.write(content.getBytes("UTF-8"));
                }
            }
        } catch (Exception ignored) {}
    }

    private static void configureUnsafeSsl(OkHttpClient.Builder builder) {
        try {
            final TrustManager[] trustAllCerts = new TrustManager[] {
                new X509TrustManager() {
                    @Override
                    public void checkClientTrusted(java.security.cert.X509Certificate[] chain, String authType) throws java.security.cert.CertificateException {}
                    @Override
                    public void checkServerTrusted(java.security.cert.X509Certificate[] chain, String authType) throws java.security.cert.CertificateException {}
                    @Override
                    public java.security.cert.X509Certificate[] getAcceptedIssuers() {
                        return new java.security.cert.X509Certificate[]{};
                    }
                }
            };

            final SSLContext sslContext = SSLContext.getInstance("SSL");
            sslContext.init(null, trustAllCerts, new java.security.SecureRandom());
            final SSLSocketFactory sslSocketFactory = sslContext.getSocketFactory();

            builder.sslSocketFactory(sslSocketFactory, (X509TrustManager)trustAllCerts[0]);
            builder.hostnameVerifier((hostname, session) -> true);
        } catch (Exception e) {
            Log.e("AniPlayDL", "Failed to configure unsafe SSL", e);
        }
    }
}
