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

        if (animeId == null || episode == null || srvUrl == null) {
            call.reject("animeId, episode, and url are required");
            return;
        }

        String taskId = animeId + "_" + episode;
        if (activeDownloads.containsKey(taskId)) {
            call.reject("Download already in progress for this episode");
            return;
        }

        DownloadTask task = new DownloadTask(taskId, animeId, animeTitle, episode, srvUrl, referer, cover, getContext(), this);
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
        if (animeId == null || episode == null) {
            call.reject("animeId and episode are required");
            return;
        }

        String taskId = animeId + "_" + episode;
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
        private Context context;
        private OfflineDownloader plugin;
        private File destDir;

        public DownloadTask(String taskId, String animeId, String animeTitle, String episode, String srvUrl, String referer, String cover, Context context, OfflineDownloader plugin) {
            this.taskId = taskId;
            this.animeId = animeId;
            this.animeTitle = animeTitle;
            this.episode = episode;
            this.srvUrl = srvUrl;
            this.referer = referer;
            this.cover = cover;
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

        private void downloadMP4(File destDir) throws Exception {
            URL url = new URL(srvUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            if (!referer.isEmpty()) {
                conn.setRequestProperty("Referer", referer);
            }
            conn.setRequestProperty("User-Agent", "Mozilla/5.0");
            conn.connect();

            int length = conn.getContentLength();
            InputStream is = new BufferedInputStream(conn.getInputStream());
            File outFile = new File(destDir, "video.enc");
            OutputStream os = new BufferedOutputStream(new FileOutputStream(outFile));

            byte[] data = new byte[8192];
            long total = 0;
            int count;
            int lastProgress = 0;
            while ((count = is.read(data)) != -1) {
                total += count;
                // XOR encrypt
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
                }
            }
            os.flush();
            os.close();
            is.close();
        }

        private void downloadHLS(File destDir) throws Exception {
            // 1. Download m3u8 playlist
            URL url = new URL(srvUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            if (!referer.isEmpty()) {
                conn.setRequestProperty("Referer", referer);
            }
            conn.setRequestProperty("User-Agent", "Mozilla/5.0");
            conn.connect();

            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            List<String> lines = new ArrayList<>();
            List<String> segmentUrls = new ArrayList<>();
            String line;
            String baseUrl = srvUrl.substring(0, srvUrl.lastIndexOf("/") + 1);

            while ((line = reader.readLine()) != null) {
                lines.add(line);
                if (line.trim().endsWith(".ts") || line.contains(".ts?") || (!line.startsWith("#") && !line.trim().isEmpty())) {
                    String segUrl = line.trim();
                    if (!segUrl.startsWith("http")) {
                        segUrl = baseUrl + segUrl;
                    }
                    segmentUrls.add(segUrl);
                }
            }
            reader.close();

            if (segmentUrls.isEmpty()) {
                throw new Exception("No HLS TS segments found in m3u8");
            }

            // 2. Rewrite m3u8 playlist locally
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

            // 3. Download segments sequentially
            int totalSegs = segmentUrls.size();
            long totalBytes = 0;
            for (int i = 0; i < totalSegs; i++) {
                String segUrl = segmentUrls.get(i);
                File segFile = new File(destDir, "segment_" + i + ".enc");
                
                URL sUrl = new URL(segUrl);
                HttpURLConnection sConn = (HttpURLConnection) sUrl.openConnection();
                if (!referer.isEmpty()) {
                    sConn.setRequestProperty("Referer", referer);
                }
                sConn.setRequestProperty("User-Agent", "Mozilla/5.0");
                sConn.connect();

                InputStream sIs = new BufferedInputStream(sConn.getInputStream());
                OutputStream sOs = new BufferedOutputStream(new FileOutputStream(segFile));

                byte[] data = new byte[8192];
                int count;
                long segOffset = 0;
                while ((count = sIs.read(data)) != -1) {
                    // XOR encrypt
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
                String[] parts = relativePath.split("/");
                if (parts.length < 2) {
                    sendError(socket, 400, "Bad Request");
                    return;
                }

                String taskId = parts[0];
                String fileName = parts[1];
                File downloadDir = new File(new File(context.getFilesDir(), "downloads"), taskId);
                
                if (fileName.equals("index.m3u8")) {
                    File file = new File(downloadDir, "index.m3u8");
                    sendFile(socket, file, "application/vnd.apple.mpegurl", false, 0, -1);
                } else if (fileName.startsWith("segment_")) {
                    String encFileName = fileName.replace(".ts", ".enc");
                    File file = new File(downloadDir, encFileName);
                    sendFile(socket, file, "video/mp2t", true, 0, -1);
                } else if (fileName.equals("video.mp4")) {
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
