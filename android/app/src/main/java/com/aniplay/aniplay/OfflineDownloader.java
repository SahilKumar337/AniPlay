package com.aniplay.aniplay;

import android.content.Context;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "OfflineDownloader")
public class OfflineDownloader extends Plugin {
    private static final String TAG = "OfflineDownloader";
    private static final byte[] XOR_KEY = { 0x4e, 0x65, 0x6b, 0x6f, 0x44, 0x6c, 0x6f, 0x61, 0x64 }; // "NekoDload"
    
    private ExecutorService downloadExecutor = Executors.newFixedThreadPool(2);
    private LocalHttpServer httpServer;
    private Map<String, DownloadTask> activeDownloads = new ConcurrentHashMap<>();

    @Override
    public void load() {
        super.load();
        httpServer = new LocalHttpServer(8081, getContext());
        httpServer.start();
        Log.d(TAG, "OfflineDownloader plugin loaded, HTTP playback server started on port 8081");
    }

    @PluginMethod
    public void downloadEpisode(PluginCall call) {
        String animeId = call.getString("animeId");
        String animeTitle = call.getString("animeTitle");
        String episode = call.getString("episode");
        String srvUrl = call.getString("url");
        String referer = call.getString("referer", "");
        String cover = call.getString("cover", "");
        String track = call.getString("track", "sub");
        
        String subtitlesJson = "";
        try {
            JSArray subs = call.getArray("subtitles");
            if (subs != null) {
                subtitlesJson = subs.toString();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error parsing subtitles array", e);
        }

        if (animeId == null || episode == null || srvUrl == null) {
            call.reject("animeId, episode, and url are required");
            return;
        }

        String taskId = animeId + "_" + episode + "_" + track;
        if (activeDownloads.containsKey(taskId)) {
            call.reject("Download already in progress for this episode");
            return;
        }

        DownloadTask task = new DownloadTask(taskId, animeId, animeTitle, episode, srvUrl, referer, cover, track, subtitlesJson, getContext(), this);
        activeDownloads.put(taskId, task);
        downloadExecutor.submit(task);

        JSObject ret = new JSObject();
        ret.put("status", "started");
        call.resolve(ret);
    }

    @PluginMethod
    public void getDownloadsList(PluginCall call) {
        File downloadsDir = new File(getContext().getFilesDir(), "downloads");
        JSArray arr = new JSArray();
        if (downloadsDir.exists() && downloadsDir.isDirectory()) {
            File[] dirs = downloadsDir.listFiles();
            if (dirs != null) {
                for (File dir : dirs) {
                    if (dir.isDirectory()) {
                        File metadataFile = new File(dir, "metadata.json");
                        if (metadataFile.exists()) {
                            try (BufferedReader reader = new BufferedReader(new FileReader(metadataFile))) {
                                StringBuilder sb = new StringBuilder();
                                String line;
                                while ((line = reader.readLine()) != null) {
                                    sb.append(line);
                                }
                                arr.put(new JSObject(sb.toString()));
                            } catch (Exception e) {
                                Log.e(TAG, "Error reading metadata in " + dir.getName(), e);
                            }
                        }
                    }
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("downloads", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void deleteDownload(PluginCall call) {
        String animeId = call.getString("animeId");
        String episode = call.getString("episode");
        String track = call.getString("track", "sub");
        if (animeId == null || episode == null) {
            call.reject("animeId and episode are required");
            return;
        }

        String taskId = animeId + "_" + episode + "_" + track;
        File downloadDir = new File(new File(getContext().getFilesDir(), "downloads"), taskId);
        if (downloadDir.exists()) {
            deleteRecursive(downloadDir);
            call.resolve();
        } else {
            call.reject("Download not found");
        }
    }

    private void deleteRecursive(File fileOrDirectory) {
        if (fileOrDirectory.isDirectory()) {
            for (File child : fileOrDirectory.listFiles()) {
                deleteRecursive(child);
            }
        }
        fileOrDirectory.delete();
    }

    // Helper class representing an HLS/MP4 download task
    private static class DownloadTask implements Runnable {
        private String taskId;
        private String animeId;
        private String animeTitle;
        private String episode;
        private String srvUrl;
        private String referer;
        private String cover;
        private String track;
        private String subtitlesJson;
        private String localSubtitlesJson = "[]";
        private Context context;
        private OfflineDownloader plugin;
        private File destDir;

        public DownloadTask(String taskId, String animeId, String animeTitle, String episode, String srvUrl, String referer, String cover, String track, String subtitlesJson, Context context, OfflineDownloader plugin) {
            this.taskId = taskId;
            this.animeId = animeId;
            this.animeTitle = animeTitle;
            this.episode = episode;
            this.srvUrl = srvUrl;
            this.referer = referer;
            this.cover = cover;
            this.track = track;
            this.subtitlesJson = subtitlesJson;
            this.context = context;
            this.plugin = plugin;
            this.destDir = new File(new File(context.getFilesDir(), "downloads"), taskId);
        }

        @Override
        public void run() {
            if (!destDir.exists()) {
                destDir.mkdirs();
            }

            try {
                // Initialize metadata
                writeMetadata("downloading", 0, 0);

                if (srvUrl.contains(".m3u8")) {
                    downloadHLS(destDir);
                } else {
                    downloadMP4(destDir);
                }

                // Download subtitle files
                downloadSubtitles(destDir);

                writeMetadata("completed", 100, getDirSize(destDir));
                JSObject progressObj = new JSObject();
                progressObj.put("taskId", taskId);
                progressObj.put("progress", 100);
                progressObj.put("status", "completed");
                plugin.notifyListeners("downloadProgress", progressObj);
            } catch (Exception e) {
                Log.e(TAG, "Download failed: " + taskId, e);
                writeMetadata("error", 0, 0);
                JSObject errObj = new JSObject();
                errObj.put("taskId", taskId);
                errObj.put("error", e.getMessage());
                plugin.notifyListeners("downloadProgress", errObj);
            } finally {
                plugin.activeDownloads.remove(taskId);
            }
        }

        private InputStream getInputStreamWithRedirects(String urlString, String referer) throws Exception {
            String currentUrl = urlString;
            int redirectCount = 0;
            while (redirectCount < 5) {
                URL url = new URL(currentUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                conn.setInstanceFollowRedirects(true);
                if (!referer.isEmpty()) {
                    conn.setRequestProperty("Referer", referer);
                }
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
                
                int status = conn.getResponseCode();
                if (status == HttpURLConnection.HTTP_MOVED_TEMP || status == HttpURLConnection.HTTP_MOVED_PERM || status == 307 || status == 308) {
                    String newUrl = conn.getHeaderField("Location");
                    if (newUrl != null) {
                        if (!newUrl.startsWith("http")) {
                            URL base = new URL(currentUrl);
                            newUrl = base.getProtocol() + "://" + base.getHost() + newUrl;
                        }
                        currentUrl = newUrl;
                        redirectCount++;
                        continue;
                    }
                }
                if (status >= 400) {
                    throw new IOException("Server returned HTTP error code: " + status + " for URL: " + currentUrl);
                }
                return conn.getInputStream();
            }
            throw new IOException("Too many redirects");
        }

        private List<String> fetchPlaylistLines(String urlString, String referer) throws Exception {
            InputStream is = getInputStreamWithRedirects(urlString, referer);
            BufferedReader reader = new BufferedReader(new InputStreamReader(is));
            List<String> lines = new ArrayList<>();
            String line;
            while ((line = reader.readLine()) != null) {
                lines.add(line);
            }
            reader.close();
            is.close();
            return lines;
        }

        private void downloadMP4(File destDir) throws Exception {
            InputStream is = getInputStreamWithRedirects(srvUrl, referer);
            File outFile = new File(destDir, "video.enc");
            OutputStream os = new BufferedOutputStream(new FileOutputStream(outFile));

            byte[] data = new byte[8192];
            long total = 0;
            int count;
            int lastProgress = 0;
            long length = -1;
            try {
                URL url = new URL(srvUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                if (!referer.isEmpty()) {
                    conn.setRequestProperty("Referer", referer);
                }
                conn.setRequestProperty("User-Agent", "Mozilla/5.0");
                conn.setRequestMethod("HEAD");
                length = conn.getContentLength();
                conn.disconnect();
            } catch (Exception e) {}

            while ((count = is.read(data)) != -1) {
                total += count;
                for (int i = 0; i < count; i++) {
                    data[i] = (byte) (data[i] ^ XOR_KEY[(int) ((total - count + i) % XOR_KEY.length)]);
                }
                os.write(data, 0, count);

                if (length > 0) {
                    int progress = (int) (total * 100 / length);
                    if (progress > lastProgress) {
                        lastProgress = progress;
                        writeMetadata("downloading", progress, total);
                        JSObject progressObj = new JSObject();
                        progressObj.put("taskId", taskId);
                        progressObj.put("progress", progress);
                        progressObj.put("status", "downloading");
                        plugin.notifyListeners("downloadProgress", progressObj);
                    }
                } else {
                    if (total % (1024 * 1024) == 0) {
                        writeMetadata("downloading", 50, total);
                        JSObject progressObj = new JSObject();
                        progressObj.put("taskId", taskId);
                        progressObj.put("progress", 50);
                        progressObj.put("status", "downloading");
                        plugin.notifyListeners("downloadProgress", progressObj);
                    }
                }
            }
            os.flush();
            os.close();
            is.close();
        }

        private void downloadHLS(File destDir) throws Exception {
            String targetUrl = srvUrl;
            List<String> lines = fetchPlaylistLines(targetUrl, referer);
            boolean isMaster = false;
            String variantUrl = null;
            
            for (String l : lines) {
                if (l.contains("#EXT-X-STREAM-INF")) {
                    isMaster = true;
                }
                if (isMaster && !l.startsWith("#") && !l.trim().isEmpty()) {
                    variantUrl = l.trim();
                    break;
                }
            }

            if (isMaster && variantUrl != null) {
                Log.d(TAG, "Master playlist detected. Resolving variant: " + variantUrl);
                if (!variantUrl.startsWith("http")) {
                    String baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
                    variantUrl = baseUrl + variantUrl;
                }
                targetUrl = variantUrl;
                lines = fetchPlaylistLines(targetUrl, referer);
            }

            List<String> segmentUrls = new ArrayList<>();
            String baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
            
            for (String line : lines) {
                if (line.trim().endsWith(".ts") || line.contains(".ts?") || (!line.startsWith("#") && !line.trim().isEmpty())) {
                    String segUrl = line.trim();
                    if (!segUrl.startsWith("http")) {
                        if (segUrl.startsWith("/")) {
                            URL u = new URL(targetUrl);
                            String host = u.getProtocol() + "://" + u.getHost();
                            if (u.getPort() != -1) {
                                host += ":" + u.getPort();
                            }
                            segUrl = host + segUrl;
                        } else {
                            segUrl = baseUrl + segUrl;
                        }
                    }
                    segmentUrls.add(segUrl);
                }
            }

            if (segmentUrls.isEmpty()) {
                throw new Exception("No HLS TS segments found in variant m3u8");
            }

            File playlistFile = new File(destDir, "index.m3u8");
            BufferedWriter writer = new BufferedWriter(new FileWriter(playlistFile));
            int segIndex = 0;
            for (String l : lines) {
                if (l.trim().endsWith(".ts") || l.contains(".ts?") || (!l.startsWith("#") && !l.trim().isEmpty())) {
                    writer.write("segment_" + segIndex + ".ts");
                    segIndex++;
                } else {
                    writer.write(l);
                }
                writer.newLine();
            }
            writer.flush();
            writer.close();

            int totalSegs = segmentUrls.size();
            long totalBytes = 0;
            for (int i = 0; i < totalSegs; i++) {
                String segUrl = segmentUrls.get(i);
                File segFile = new File(destDir, "segment_" + i + ".enc");
                
                InputStream sIs = getInputStreamWithRedirects(segUrl, referer);
                OutputStream sOs = new BufferedOutputStream(new FileOutputStream(segFile));

                byte[] data = new byte[8192];
                int count;
                long segOffset = 0;
                while ((count = sIs.read(data)) != -1) {
                    for (int j = 0; j < count; j++) {
                        data[j] = (byte) (data[j] ^ XOR_KEY[(int) ((segOffset + j) % XOR_KEY.length)]);
                    }
                    sOs.write(data, 0, count);
                    segOffset += count;
                    totalBytes += count;
                }
                sOs.flush();
                sOs.close();
                sIs.close();

                int progress = (int) ((i + 1) * 100 / totalSegs);
                writeMetadata("downloading", progress, totalBytes);
                JSObject progressObj = new JSObject();
                progressObj.put("taskId", taskId);
                progressObj.put("progress", progress);
                progressObj.put("status", "downloading");
                plugin.notifyListeners("downloadProgress", progressObj);
            }
        }

        private void writeMetadata(String status, int progress, long size) {
            File metaFile = new File(destDir, "metadata.json");
            try {
                JSObject json = new JSObject();
                json.put("taskId", taskId);
                json.put("animeId", animeId);
                json.put("animeTitle", animeTitle);
                json.put("episode", episode);
                json.put("cover", cover);
                json.put("status", status);
                json.put("progress", progress);
                json.put("size", size);
                json.put("track", track);
                try {
                    json.put("subtitles", new JSArray(localSubtitlesJson));
                } catch (Exception e) {
                    json.put("subtitles", new JSArray());
                }
                json.put("timestamp", System.currentTimeMillis());

                try (FileWriter fw = new FileWriter(metaFile)) {
                    fw.write(json.toString());
                }
            } catch (Exception e) {
                Log.e(TAG, "Error writing metadata", e);
            }
        }

        private long getDirSize(File dir) {
            long size = 0;
            if (dir.exists() && dir.isDirectory()) {
                for (File f : dir.listFiles()) {
                    if (f.isFile()) size += f.length();
                }
            }
            return size;
        }

        private void downloadSubtitles(File destDir) {
            if (subtitlesJson == null || subtitlesJson.isEmpty()) return;
            File subsDir = new File(destDir, "subtitles");
            if (!subsDir.exists()) {
                subsDir.mkdirs();
            }

            try {
                org.json.JSONArray arr = new org.json.JSONArray(subtitlesJson);
                org.json.JSONArray localSubs = new org.json.JSONArray();

                for (int i = 0; i < arr.length(); i++) {
                    org.json.JSONObject sub = arr.getJSONObject(i);
                    String subUrl = sub.optString("url");
                    String lang = sub.optString("lang", "Lang_" + i);
                    
                    if (subUrl == null || subUrl.isEmpty()) continue;

                    try {
                        String cleanLang = lang.replaceAll("[^a-zA-Z0-9_-]", "_");
                        File subFile = new File(subsDir, cleanLang + ".vtt");
                        
                        URL url = new URL(subUrl);
                        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                        conn.setRequestProperty("User-Agent", "Mozilla/5.0");
                        conn.connect();

                        InputStream is = new BufferedInputStream(conn.getInputStream());
                        OutputStream os = new BufferedOutputStream(new FileOutputStream(subFile));

                        byte[] data = new byte[4096];
                        int count;
                        while ((count = is.read(data)) != -1) {
                            os.write(data, 0, count);
                        }
                        os.flush();
                        os.close();
                        is.close();

                        // Add to local subtitles list
                        org.json.JSONObject localSub = new org.json.JSONObject();
                        localSub.put("lang", lang);
                        localSub.put("url", "http://localhost:8081/play/" + taskId + "/subtitles/" + cleanLang + ".vtt");
                        localSubs.put(localSub);

                        Log.d(TAG, "Downloaded subtitle for lang: " + lang);
                    } catch (Exception e) {
                        Log.e(TAG, "Failed to download subtitle: " + subUrl, e);
                    }
                }
                
                this.localSubtitlesJson = localSubs.toString();

            } catch (Exception e) {
                Log.e(TAG, "Error processing subtitles", e);
            }
        }
    }

    // Lightweight ServerSocket-based HTTP Server for seekable decryption playback streaming
    private static class LocalHttpServer implements Runnable {
        private int port;
        private Context context;
        private ServerSocket serverSocket;
        private boolean running = false;

        public LocalHttpServer(int port, Context context) {
            this.port = port;
            this.context = context;
        }

        public void start() {
            if (running) return;
            running = true;
            new Thread(this).start();
        }

        @Override
        public void run() {
            try {
                serverSocket = new ServerSocket(port);
                while (running) {
                    Socket socket = serverSocket.accept();
                    new Thread(() -> handleRequest(socket)).start();
                }
            } catch (Exception e) {
                Log.e(TAG, "Server socket error", e);
            }
        }

        private void handleRequest(Socket socket) {
            try {
                BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream()));
                String requestLine = in.readLine();
                if (requestLine == null) return;

                String[] tokens = requestLine.split(" ");
                if (tokens.length < 2) return;
                String path = tokens[1];

                // Parse headers to locate Range requests
                String rangeHeader = "";
                String line;
                while ((line = in.readLine()) != null && !line.trim().isEmpty()) {
                    if (line.toLowerCase().startsWith("range:")) {
                        rangeHeader = line.substring(6).trim();
                    }
                }

                // Resolve target file
                // Path format: /play/animeId_episode/index.m3u8 or /play/animeId_episode/segment_X.ts or /play/animeId_episode/video.mp4
                if (!path.startsWith("/play/")) {
                    sendError(socket, 404, "Not Found");
                    return;
                }

                String relativePath = path.substring(6);
                int slashIdx = relativePath.indexOf("/");
                if (slashIdx == -1) {
                    sendError(socket, 400, "Bad Request");
                    return;
                }

                String taskId = relativePath.substring(0, slashIdx);
                String subPath = relativePath.substring(slashIdx + 1);
                File downloadDir = new File(new File(context.getFilesDir(), "downloads"), taskId);
                
                if (subPath.equals("index.m3u8")) {
                    File file = new File(downloadDir, "index.m3u8");
                    sendFile(socket, file, "application/vnd.apple.mpegurl", false, 0, -1);
                } else if (subPath.startsWith("segment_")) {
                    String encFileName = subPath.replace(".ts", ".enc");
                    File file = new File(downloadDir, encFileName);
                    sendFile(socket, file, "video/mp2t", true, 0, -1);
                } else if (subPath.equals("video.mp4")) {
                    File file = new File(downloadDir, "video.enc");
                    
                    // Parse Byte Range seeks
                    long startByte = 0;
                    long endByte = -1;
                    if (!rangeHeader.isEmpty() && rangeHeader.startsWith("bytes=")) {
                        String[] rangeParts = rangeHeader.substring(6).split("-");
                        startByte = Long.parseLong(rangeParts[0]);
                        if (rangeParts.length > 1 && !rangeParts[1].isEmpty()) {
                            endByte = Long.parseLong(rangeParts[1]);
                        }
                    }
                    sendFile(socket, file, "video/mp4", true, startByte, endByte);
                } else if (subPath.startsWith("subtitles/")) {
                    File file = new File(downloadDir, subPath);
                    sendFile(socket, file, "text/vtt", false, 0, -1);
                } else {
                    sendError(socket, 404, "Not Found");
                }

            } catch (Exception e) {
                Log.e(TAG, "Request handling error", e);
            } finally {
                try {
                    socket.close();
                } catch (Exception e) {}
            }
        }

        private void sendFile(Socket socket, File file, String contentType, boolean decrypt, long startByte, long endByte) throws IOException {
            if (!file.exists()) {
                sendError(socket, 404, "Not Found");
                return;
            }

            long fileLength = file.length();
            if (endByte == -1 || endByte >= fileLength) {
                endByte = fileLength - 1;
            }
            long contentLength = endByte - startByte + 1;

            OutputStream out = socket.getOutputStream();
            
            // Write HTTP headers
            if (startByte > 0 || endByte < fileLength - 1) {
                out.write("HTTP/1.1 206 Partial Content\r\n".getBytes());
                out.write(("Content-Range: bytes " + startByte + "-" + endByte + "/" + fileLength + "\r\n").getBytes());
            } else {
                out.write("HTTP/1.1 200 OK\r\n".getBytes());
            }
            out.write(("Content-Type: " + contentType + "\r\n").getBytes());
            out.write(("Content-Length: " + contentLength + "\r\n").getBytes());
            out.write("Access-Control-Allow-Origin: *\r\n".getBytes());
            out.write("Connection: close\r\n\r\n".getBytes());

            // Decrypt and stream requested chunks
            try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
                raf.seek(startByte);
                byte[] buffer = new byte[8192];
                long remaining = contentLength;

                while (remaining > 0) {
                    int toRead = (int) Math.min(buffer.length, remaining);
                    int read = raf.read(buffer, 0, toRead);
                    if (read == -1) break;

                    if (decrypt) {
                        for (int i = 0; i < read; i++) {
                            long absoluteOffset = startByte + (contentLength - remaining) + i;
                            buffer[i] = (byte) (buffer[i] ^ XOR_KEY[(int) (absoluteOffset % XOR_KEY.length)]);
                        }
                    }
                    out.write(buffer, 0, read);
                    remaining -= read;
                }
            }
            out.flush();
        }

        private void sendError(Socket socket, int code, String msg) throws IOException {
            OutputStream out = socket.getOutputStream();
            out.write(("HTTP/1.1 " + code + " " + msg + "\r\n").getBytes());
            out.write("Content-Type: text/plain\r\n".getBytes());
            out.write("Content-Length: 0\r\n\r\n".getBytes());
            out.flush();
        }
    }
}
