package com.aniplay.aniplay;

import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
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
        // Build OkHttp with WebView CookieJar
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
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
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
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

    @PluginMethod public void deleteDownload(PluginCall call) { call.resolve(); }

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

    // ── SHARED HELPERS ────────────────────────────────────────────────────────

    void emit(String taskId, int progress, String status, String error) {
        JSObject ev = new JSObject();
        ev.put("taskId", taskId); ev.put("progress", progress); ev.put("status", status);
        if (error != null) ev.put("error", error);
        notifyListeners("downloadProgress", ev);
    }

    // Mux a set of local segment files → single MP4 using FFmpegKit
    File muxConcat(File tempDir, int total, boolean isFmp4, String taskId) throws Exception {
        if (!isFmp4) {
            // For raw TS segments, append them first into combined.ts to ensure FFmpeg can remux it correctly with valid headers
            File combinedTs = new File(tempDir, "combined.ts");
            try (BufferedOutputStream bos = new BufferedOutputStream(new FileOutputStream(combinedTs))) {
                byte[] buffer = new byte[65536];
                for (int i = 0; i < total; i++) {
                    File seg = new File(tempDir, String.format(java.util.Locale.US, "seg_%06d.ts", i));
                    if (seg.exists()) {
                        try (BufferedInputStream bis = new BufferedInputStream(new FileInputStream(seg))) {
                            int read;
                            while ((read = bis.read(buffer)) != -1) {
                                bos.write(buffer, 0, read);
                            }
                        }
                    }
                }
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
                throw new Exception("FFmpeg concat failed (code=" + sess.getReturnCode() + ")");
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
        final boolean isHls;
        final String playlistContent;
        final Context ctx;
        final OfflineDownloader plugin;
        final OkHttpClient http;
        final AtomicInteger lastProg = new AtomicInteger(-1);

        JavaDLTask(String taskId, String animeId, String animeTitle, String episode,
                   String srvUrl, String referer, String cover, String track,
                   String subsJson, boolean isHls, String playlistContent,
                   Context ctx, OfflineDownloader plugin, OkHttpClient http) {
            this.taskId = taskId; this.animeId = animeId; this.animeTitle = animeTitle;
            this.episode = episode; this.srvUrl = srvUrl; this.referer = referer;
            this.cover = cover; this.track = track; this.subsJson = subsJson;
            this.isHls = isHls; this.playlistContent = playlistContent;
            this.ctx = ctx; this.plugin = plugin; this.http = http;
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
            try {
                plugin.emit(taskId, 1, "downloading", null);
                if (isHls) downloadHLS(fileName);
                else downloadMP4Direct(fileName);
                downloadSubtitles(uniqueBaseName);
                plugin.emit(taskId, 100, "completed", null);
            } catch (Exception e) {
                Log.e(TAG, "Download failed for " + taskId, e);
                plugin.emit(taskId, 0, "error", e.getMessage());
            } finally {
                plugin.javaDLs.remove(taskId);
            }
        }

        private void downloadHLS(String fileName) throws Exception {
            String targetUrl = srvUrl;

            // Use pre-fetched playlist from JS if available
            List<String> lines;
            if (playlistContent != null && playlistContent.length() > 20
                && (playlistContent.contains("#EXTM3U") || playlistContent.contains("#EXT-X"))) {
                lines = new ArrayList<>(Arrays.asList(playlistContent.replace("\r\n", "\n").split("\n")));
                Log.d(TAG, "Using JS pre-fetched playlist (" + lines.size() + " lines)");
            } else {
                Log.d(TAG, "Fetching playlist via OkHttp");
                lines = fetchLines(targetUrl);
            }

            // Handle master playlist
            for (String l : lines) {
                if (l.contains("#EXT-X-STREAM-INF")) {
                    String best = pickBestVariant(lines, targetUrl);
                    if (best != null) { targetUrl = best; lines = fetchLines(best); }
                    break;
                }
            }

            // Parse and clean
            String base = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
            String rootProto;
            try { URL u = new URL(targetUrl); rootProto = u.getProtocol() + "://" + u.getHost(); }
            catch (Exception e) { rootProto = "https://"; }

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
                        if (!uri.startsWith("http")) uri = uri.startsWith("/") ? rootProto + uri : base + uri;
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
                            if (!uri.startsWith("http")) uri = uri.startsWith("/") ? rootProto + uri : base + uri;
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
                    String abs = t.startsWith("http") ? t : (t.startsWith("/") ? rootProto + t : base + t);
                    boolean isAd = abs.contains("/ad/") || abs.contains("adserver") || abs.contains("doubleclick");
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
            OfflineDownloader.rmrf(tempDir); tempDir.mkdirs();

            // Stage 2: OkHttp downloads each segment -> FFmpegKit local mux
            plugin.emit(taskId, 2, "downloading", null);
            File segDir = new File(tempDir, "segs"); segDir.mkdirs();

            // Init segment (fMP4)
            if (isFmp4 && initUrl != null) {
                byte[] initData = fetchBytes(initUrl);
                try (FileOutputStream fos = new FileOutputStream(new File(segDir, "init.mp4"))) { fos.write(initData); }
            }

            // Download segments in parallel (2 threads for rate limit protection)
            int total = segUrls.size();
            AtomicInteger done = new AtomicInteger(0);
            AtomicBoolean failed = new AtomicBoolean(false);
            AtomicReference<Exception> failEx = new AtomicReference<>();
            final boolean enc = isEnc; final byte[] fKey = curKey; final List<byte[]> fIVs = segIVs;

            ExecutorService pool = Executors.newFixedThreadPool(6);
            List<Future<?>> futures = new ArrayList<>();
            for (int i = 0; i < total; i++) {
                final int idx = i;
                final String segUrl = segUrls.get(i);
                final byte[] iv = enc && idx < fIVs.size() ? fIVs.get(idx) : null;
                final File segFile = new File(segDir, String.format(java.util.Locale.US, "seg_%06d.%s", idx, isFmp4 ? "m4s" : "ts"));
                futures.add(pool.submit(() -> {
                    if (failed.get()) return;
                    for (int r = 0; r < 10; r++) {
                        try {
                            Request req = buildRequest(segUrl);
                            try (Response resp = http.newCall(req).execute()) {
                                if (!resp.isSuccessful() || resp.body() == null) {
                                    throw new IOException("HTTP " + resp.code() + " for segment " + idx);
                                }
                                if (enc && fKey != null && iv != null) {
                                    byte[] encryptedData = resp.body().bytes();
                                    byte[] decryptedData = aesDecrypt(encryptedData, fKey, iv);
                                    try (FileOutputStream fos = new FileOutputStream(segFile)) {
                                        fos.write(decryptedData);
                                    }
                                } else {
                                    try (InputStream is = resp.body().byteStream();
                                         FileOutputStream fos = new FileOutputStream(segFile)) {
                                        java.io.BufferedInputStream bis = new java.io.BufferedInputStream(is);
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
                                        byte[] buf = new byte[32768];
                                        int read;
                                        while ((read = bis.read(buf)) != -1) {
                                            fos.write(buf, 0, read);
                                        }
                                        fos.flush();
                                    }
                                }
                            }
                            int comp = done.incrementAndGet();
                            int prog = Math.min(90, (int)(comp * 90L / total));
                            int last = lastProg.get();
                            if (prog > last && lastProg.compareAndSet(last, prog)) {
                                plugin.emit(taskId, prog, "downloading", null);
                            }
                            return;
                        } catch (Exception e) {
                            Log.w(TAG, "Segment " + idx + " download failed (attempt " + (r + 1) + "/10): " + e.getMessage());
                            if (r >= 9) { failed.set(true); failEx.set(e); }
                            else { try { Thread.sleep((r + 1) * 1000); } catch (Exception ignored) {} }
                        }
                    }
                }));
            }
            for (Future<?> f : futures) { try { f.get(120, TimeUnit.SECONDS); } catch (Exception e) { failed.set(true); } }
            pool.shutdown();

            if (failed.get()) {
                OfflineDownloader.rmrf(tempDir);
                throw new Exception("Segment download failed: " + (failEx.get() != null ? failEx.get().getMessage() : "unknown"));
            }

            plugin.emit(taskId, 92, "processing", null);
            // Move segments into correct location for muxConcat
            File[] allSegs = segDir.listFiles();
            if (allSegs != null) for (File f : allSegs) f.renameTo(new File(tempDir, f.getName()));

            File muxed = plugin.muxConcat(tempDir, total, isFmp4, taskId);
            plugin.emit(taskId, 97, "processing", null);
            plugin.saveToGallery(muxed, fileName);
            OfflineDownloader.rmrf(tempDir);
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
            Request req = buildRequest(urlStr);
            try (Response resp = http.newCall(req).execute()) {
                if (!resp.isSuccessful() || resp.body() == null) throw new IOException("HTTP " + resp.code() + " for " + urlStr);
                return resp.body().bytes();
            }
        }

        private Request buildRequest(String urlStr) {
            Request.Builder b = new Request.Builder().url(urlStr).get();
            
            String ua;
            try { ua = android.webkit.WebSettings.getDefaultUserAgent(ctx); }
            catch (Exception e) { ua = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"; }
            
            b.header("User-Agent", ua);
            b.header("Accept", "*/*");
            b.header("Accept-Language", "en-US,en;q=0.9");
            if (!referer.isEmpty()) {
                b.header("Referer", referer);
                try { URL ref = new URL(referer); b.header("Origin", ref.getProtocol() + "://" + ref.getHost()); }
                catch (Exception ignored) {}
            }
            
            // Inject merged cookies manually to guarantee transmission
            try {
                StringBuilder sb = new StringBuilder();
                android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
                String c1 = cm.getCookie(urlStr);
                String c2 = referer.isEmpty() ? null : cm.getCookie(referer);
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

        private String pickBestVariant(List<String> lines, String masterUrl) {
            String base = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
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
            if (best.startsWith("http")) return best;
            try {
                if (best.startsWith("/")) { URL u = new URL(masterUrl); return u.getProtocol() + "://" + u.getHost() + best; }
            } catch (Exception ignored) {}
            return base + best;
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

                // Resolve proxied subtitle URLs
                if (subUrl.contains("/api/stream/subtitle?")) {
                    try {
                        Uri uri = Uri.parse(subUrl);
                        String innerUrl = uri.getQueryParameter("url");
                        if (innerUrl != null && !innerUrl.isEmpty()) {
                            subUrl = innerUrl;
                        }
                    } catch (Exception ignored) {}
                }

                // Fetch subtitles with appropriate headers to bypass CDN block
                Request.Builder reqBuilder = new Request.Builder()
                    .url(subUrl)
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36")
                    .header("Accept", "*/*");
                
                if (referer != null && !referer.isEmpty()) {
                    reqBuilder.header("Referer", referer);
                    try {
                        Uri refUri = Uri.parse(referer);
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
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try {
                        ContentValues cv = new ContentValues();
                        cv.put(MediaStore.MediaColumns.DISPLAY_NAME, subName);
                        cv.put(MediaStore.MediaColumns.MIME_TYPE, "text/plain");
                        cv.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/" + folder);
                        Uri uri = ctx.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                        if (uri != null) {
                            try (OutputStream os = ctx.getContentResolver().openOutputStream(uri)) {
                                if (os != null) { os.write(data); os.flush(); }
                            }
                        } else {
                            writeSubtitleFallback(subName, data, folder);
                        }
                    } catch (Exception ex) {
                        Log.w(TAG, "MediaStore subtitle write failed, trying fallback: " + ex.getMessage());
                        writeSubtitleFallback(subName, data, folder);
                    }
                } else {
                    writeSubtitleFallback(subName, data, folder);
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

    private List<InetAddress> resolveDnsOverHttps(String hostname) {
        try {
            OkHttpClient.Builder builder = new OkHttpClient.Builder()
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(5, TimeUnit.SECONDS);
            configureUnsafeSsl(builder);
            OkHttpClient client = builder.build();

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
                                    Log.d("AniPlayDL", "DoH resolved " + hostname + " to " + addresses + " via " + url);
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
