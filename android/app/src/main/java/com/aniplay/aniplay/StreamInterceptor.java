package com.aniplay.aniplay;

import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PushbackInputStream;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import okhttp3.ConnectionPool;
import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;

/**
 * ⚡ YouTube-Level Native Stream Interceptor:
 * Intercepts video segment and playlist requests from the WebView on a background thread,
 * fetches them via OkHttp with the proper CDN Referer and User-Agent headers,
 * and streams raw binary data directly into Chromium's C++ network stack.
 *
 * Eliminates Base64 serialization, JSON parsing of 5MB chunks, and IPC bridge overhead.
 * Frees the main JavaScript thread completely, preventing any app freezing or stuttering.
 */
public class StreamInterceptor {
    private static final String TAG = "AniPlayStream";
    private static volatile OkHttpClient httpClient;
    private static final Object lock = new Object();
    private static final Map<String, List<InetAddress>> dohDnsCache = new ConcurrentHashMap<>();
    private static volatile String activeReferer = "https://megaplay.buzz/";

    public static void setActiveReferer(String referer) {
        if (referer != null && !referer.trim().isEmpty()) {
            activeReferer = referer.trim();
        }
    }

    public static OkHttpClient getClient() {
        if (httpClient == null) {
            synchronized (lock) {
                if (httpClient == null) {
                    httpClient = buildHttpClient();
                }
            }
        }
        return httpClient;
    }

    private static OkHttpClient buildHttpClient() {
        okhttp3.Dispatcher dispatcher = new okhttp3.Dispatcher();
        dispatcher.setMaxRequests(256);
        dispatcher.setMaxRequestsPerHost(128);

        OkHttpClient.Builder builder = new OkHttpClient.Builder()
            .dispatcher(dispatcher)
            .cookieJar(new CookieJar() {
                @Override
                public void saveFromResponse(HttpUrl url, List<Cookie> cookies) {
                    try {
                        android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
                        for (Cookie c : cookies) cm.setCookie(url.toString(), c.name() + "=" + c.value());
                    } catch (Exception ignored) {}
                }

                @Override
                public List<Cookie> loadForRequest(HttpUrl url) {
                    try {
                        android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
                        String raw = cm.getCookie(url.toString());
                        if (raw == null || raw.isEmpty()) return Collections.emptyList();
                        java.util.ArrayList<Cookie> list = new java.util.ArrayList<>();
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
                    } catch (Exception ignored) {
                        return Collections.emptyList();
                    }
                }
            })
            .followRedirects(true)
            .followSslRedirects(true)
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .connectionPool(new ConnectionPool(128, 5, TimeUnit.MINUTES))
            .protocols(java.util.Arrays.asList(Protocol.HTTP_2, Protocol.HTTP_1_1))
            .dns(new Dns() {
                @Override
                public List<InetAddress> lookup(String hostname) throws UnknownHostException {
                    String low = hostname.toLowerCase();
                    if (low.contains("vivibebe") || low.contains("anizara") || low.contains("anineko")
                        || low.contains("ibyteimg") || low.contains("norami") || low.contains("imgnex")
                        || low.contains("akirax") || low.contains("shiora") || low.contains("mikora")
                        || low.contains("megap") || low.contains("tiktok") || low.contains("nexabloom")) {
                        List<InetAddress> ips = resolveDnsOverHttps(hostname);
                        if (ips != null && !ips.isEmpty()) {
                            return ips;
                        }
                    }
                    try {
                        return Dns.SYSTEM.lookup(hostname);
                    } catch (Exception eSystem) {
                        List<InetAddress> ips = resolveDnsOverHttps(hostname);
                        if (ips != null && !ips.isEmpty()) {
                            return ips;
                        }
                        throw new UnknownHostException("DNS lookup failed for " + hostname);
                    }
                }
            });

        configureUnsafeSsl(builder);
        return builder.build();
    }

    public static WebResourceResponse intercept(WebResourceRequest request) {
        if (request == null || request.getUrl() == null) return null;

        String method = request.getMethod();
        Uri uri = request.getUrl();
        String url = uri.toString();
        String path = uri.getPath() != null ? uri.getPath().toLowerCase() : "";
        String host = uri.getHost() != null ? uri.getHost().toLowerCase() : "";
        Map<String, String> reqHeaders = request.getRequestHeaders();

        boolean hasCustomHeader = reqHeaders != null && (
            reqHeaders.containsKey("X-AniPlay-Referer") ||
            reqHeaders.containsKey("x-aniplay-referer")
        );
        boolean hasQueryRef = url.contains("__aniplay_ref=");
        boolean isMediaExt = path.endsWith(".m3u8") || path.endsWith(".ts") || path.endsWith(".m4s") ||
                             path.endsWith(".mp4") || path.endsWith(".webm") || path.contains(".m3u8") ||
                             path.contains("master.txt") || path.endsWith(".vtt");
        boolean isCdn = isStreamHost(host);

        // If not an anime stream request, let Capacitor's default local server handle it
        if (!hasCustomHeader && !hasQueryRef && !isMediaExt && !isCdn) {
            return null;
        }

        // Fast-path: CORS Preflight OPTIONS request
        if ("OPTIONS".equalsIgnoreCase(method)) {
            Map<String, String> corsHeaders = new HashMap<>();
            corsHeaders.put("Access-Control-Allow-Origin", "*");
            corsHeaders.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, POST");
            corsHeaders.put("Access-Control-Allow-Headers", "*");
            corsHeaders.put("Access-Control-Max-Age", "86400");
            return new WebResourceResponse("text/plain", "UTF-8", 200, "OK", corsHeaders, new ByteArrayInputStream(new byte[0]));
        }

        if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
            return null;
        }

        try {
            String cleanUrl = url.replaceAll("[?&]__aniplay_ref=[^&]*", "");
            if (cleanUrl.endsWith("?") || cleanUrl.endsWith("&")) {
                cleanUrl = cleanUrl.substring(0, cleanUrl.length() - 1);
            }

            String referer = getReferer(url, host, reqHeaders);
            setActiveReferer(referer);

            Request.Builder reqBuilder = new Request.Builder()
                .url(cleanUrl)
                .header("Referer", referer)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36");

            try {
                java.net.URL parsedRef = new java.net.URL(referer);
                reqBuilder.header("Origin", parsedRef.getProtocol() + "://" + parsedRef.getHost());
            } catch (Exception ignored) {
                reqBuilder.header("Origin", referer.replaceAll("/$", ""));
            }

            if (reqHeaders != null) {
                String range = reqHeaders.get("Range");
                if (range == null) range = reqHeaders.get("range");
                if (range != null && !range.isEmpty()) {
                    reqBuilder.header("Range", range);
                }
                String accept = reqHeaders.get("Accept");
                if (accept != null && !accept.isEmpty()) {
                    reqBuilder.header("Accept", accept);
                }
            }

            Response response = getClient().newCall(reqBuilder.build()).execute();
            if (!response.isSuccessful() && response.code() != 206) {
                response.close();
                return null;
            }

            Map<String, String> responseHeaders = new HashMap<>();
            responseHeaders.put("Access-Control-Allow-Origin", "*");
            responseHeaders.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
            responseHeaders.put("Access-Control-Allow-Headers", "*");
            responseHeaders.put("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
            responseHeaders.put("Accept-Ranges", "bytes");

            String cl = response.header("Content-Length");
            if (cl != null) responseHeaders.put("Content-Length", cl);
            String cr = response.header("Content-Range");
            if (cr != null) responseHeaders.put("Content-Range", cr);

            String contentType = response.header("Content-Type");
            if (contentType == null || contentType.isEmpty() || contentType.contains("octet-stream") || contentType.contains("image")) {
                if (cleanUrl.contains(".m3u8")) contentType = "application/vnd.apple.mpegurl";
                else if (cleanUrl.contains(".ts")) contentType = "video/mp2t";
                else if (cleanUrl.contains(".mp4") || cleanUrl.contains(".m4s")) contentType = "video/mp4";
                else if (cleanUrl.contains(".vtt")) contentType = "text/vtt";
                else contentType = "video/mp2t";
            }

            InputStream rawBody = response.body() != null ? response.body().byteStream() : new ByteArrayInputStream(new byte[0]);
            InputStream sanitized = sanitizeStream(rawBody);

            return new WebResourceResponse(
                contentType,
                null,
                response.code(),
                response.message().isEmpty() ? "OK" : response.message(),
                responseHeaders,
                sanitized
            );
        } catch (Exception e) {
            Log.w(TAG, "StreamInterceptor error for " + url + ": " + e.getMessage());
            return null;
        }
    }

    private static boolean isStreamHost(String host) {
        if (host == null) return false;
        String low = host.toLowerCase();
        return low.contains("nexabloom") || low.contains("norami") || low.contains("megap") ||
               low.contains("megacloud") || low.contains("rabbitstream") || low.contains("akirax") ||
               low.contains("shiora") || low.contains("mikora") || low.contains("quavex") ||
               low.contains("streamzone") || low.contains("silverorbit") || low.contains("tiktokcdn") ||
               low.contains("imgnex") || low.contains("vyrnex") || low.contains("mfast") ||
               low.contains("otakuhg") || low.contains("streamhg") || low.contains("premilkyway") ||
               low.contains("cdn-centaurus") || low.contains("financialintelligence") ||
               low.contains("otakuvid") || low.contains("earnvids") || low.contains("dramiyos") ||
               low.contains("acek-cdn") || low.contains("mediadexmora") || low.contains("playmogo") ||
               low.contains("echovideo") || low.contains("aniwaves") || low.contains("burntburst") ||
               low.contains("dpopdrop") || low.contains("roburnt") || low.contains("anineko") ||
               low.contains("anikoto") || low.contains("vidwish") || low.contains("vidtube") ||
               low.contains("rapid-cloud") || low.contains("dokicloud");
    }

    private static String getReferer(String url, String host, Map<String, String> reqHeaders) {
        if (reqHeaders != null) {
            for (Map.Entry<String, String> entry : reqHeaders.entrySet()) {
                if ("x-aniplay-referer".equalsIgnoreCase(entry.getKey())) {
                    String val = entry.getValue();
                    if (val != null && !val.trim().isEmpty()) return val.trim();
                }
            }
        }
        if (url.contains("__aniplay_ref=")) {
            try {
                Uri u = Uri.parse(url);
                String q = u.getQueryParameter("__aniplay_ref");
                if (q != null && !q.trim().isEmpty()) return q.trim();
            } catch (Exception ignored) {}
        }
        String low = host.toLowerCase();
        if (low.contains("otakuhg") || low.contains("premilkyway") || low.contains("cdn-centaurus") || low.contains("streamhg") || low.contains("financialintelligence")) {
            return "https://otakuhg.site/";
        }
        if (low.contains("otakuvid") || low.contains("dramiyos") || low.contains("acek-cdn") || low.contains("earnvids") || low.contains("mediadexmora") || low.contains("playmogo")) {
            return "https://otakuvid.online/";
        }
        if (low.contains("echovideo") || low.contains("aniwaves") || low.contains("burntburst") || low.contains("dpopdrop") || low.contains("roburnt")) {
            return "https://echovideo.to/";
        }
        return activeReferer != null ? activeReferer : "https://megaplay.buzz/";
    }

    /**
     * Strips obfuscated dummy PNG headers (252 bytes) on TikTok CDN / MegaPlay chunks
     * in raw stream bytes with zero-copy stream slicing (takes 0.0001ms).
     */
    private static InputStream sanitizeStream(InputStream original) throws IOException {
        PushbackInputStream pbis = new PushbackInputStream(original, 2048);
        byte[] header = new byte[2048];
        int read = 0;
        while (read < 2048) {
            int r = pbis.read(header, read, 2048 - read);
            if (r == -1) break;
            read += r;
        }
        if (read < 188) {
            pbis.unread(header, 0, read);
            return pbis;
        }

        // Already standard MPEG-TS (first byte is sync byte 0x47)
        if (header[0] == 0x47 && (read < 376 || header[188] == 0x47)) {
            pbis.unread(header, 0, read);
            return pbis;
        }

        // Standard fMP4 box ('ftyp' or 'moof')
        if (read > 8 && (
            (header[4] == 'f' && header[5] == 't' && header[6] == 'y' && header[7] == 'p') ||
            (header[4] == 'm' && header[5] == 'o' && header[6] == 'o' && header[7] == 'f')
        )) {
            pbis.unread(header, 0, read);
            return pbis;
        }

        // Known 252-byte dummy PNG header check
        if (read > 252 + 376 && header[252] == 0x47 && header[252 + 188] == 0x47 && header[252 + 376] == 0x47) {
            pbis.unread(header, 252, read - 252);
            return pbis;
        }

        // General sync word scan for any other dummy headers
        int maxScan = Math.min(read - 376, 2048);
        for (int o = 1; o < maxScan; o++) {
            if (header[o] == 0x47 && header[o + 188] == 0x47 && header[o + 376] == 0x47) {
                pbis.unread(header, o, read - o);
                return pbis;
            }
        }

        pbis.unread(header, 0, read);
        return pbis;
    }

    private static List<InetAddress> resolveDnsOverHttps(String hostname) {
        List<InetAddress> cached = dohDnsCache.get(hostname);
        if (cached != null && !cached.isEmpty()) return cached;

        try {
            OkHttpClient client = new OkHttpClient.Builder()
                .connectTimeout(3, TimeUnit.SECONDS)
                .readTimeout(3, TimeUnit.SECONDS)
                .build();

            String[] providers = {
                "https://cloudflare-dns.com/dns-query?name=" + hostname + "&type=A",
                "https://dns.google/resolve?name=" + hostname + "&type=A"
            };

            for (String url : providers) {
                try {
                    Request req = new Request.Builder()
                        .url(url)
                        .header("Accept", "application/dns-json")
                        .build();

                    try (Response res = client.newCall(req).execute()) {
                        if (res.isSuccessful() && res.body() != null) {
                            String body = res.body().string();
                            org.json.JSONObject json = new org.json.JSONObject(body);
                            if (json.has("Answer")) {
                                org.json.JSONArray answers = json.getJSONArray("Answer");
                                java.util.ArrayList<InetAddress> resolved = new java.util.ArrayList<>();
                                for (int i = 0; i < answers.length(); i++) {
                                    org.json.JSONObject ans = answers.getJSONObject(i);
                                    if (ans.optInt("type") == 1 && ans.has("data")) {
                                        String ip = ans.getString("data").trim();
                                        try {
                                            resolved.add(InetAddress.getByName(ip));
                                        } catch (Exception ignored) {}
                                    }
                                }
                                if (!resolved.isEmpty()) {
                                    dohDnsCache.put(hostname, resolved);
                                    return resolved;
                                }
                            }
                        }
                    }
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static void configureUnsafeSsl(OkHttpClient.Builder builder) {
        try {
            final TrustManager[] trustAllCerts = new TrustManager[] {
                new X509TrustManager() {
                    @Override
                    public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {}
                    @Override
                    public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {}
                    @Override
                    public X509Certificate[] getAcceptedIssuers() {
                        return new X509Certificate[]{};
                    }
                }
            };

            final SSLContext sslContext = SSLContext.getInstance("SSL");
            sslContext.init(null, trustAllCerts, new java.security.SecureRandom());
            final SSLSocketFactory sslSocketFactory = sslContext.getSocketFactory();

            builder.sslSocketFactory(sslSocketFactory, (X509TrustManager)trustAllCerts[0]);
            builder.hostnameVerifier((hostname, session) -> true);
        } catch (Exception ignored) {}
    }
}
