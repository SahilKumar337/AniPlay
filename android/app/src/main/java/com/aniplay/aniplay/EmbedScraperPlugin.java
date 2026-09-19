package com.aniplay.aniplay;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.Window;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;


/**
 * EmbedScraperPlugin — True "Way 4" Client-Side WebView Scraping
 *
 * Opens a hidden Android WebView (not an iframe), loads the embed URL
 * with a custom Referer header, and intercepts all network requests via
 * shouldInterceptRequest(). When an .m3u8 URL is detected, it fires
 * a "streamCaptured" Capacitor event back to JavaScript with direct
 * stream URL and all extracted subtitle tracks.
 *
 * This is exactly how Cloudstream and Aniyomi scrape streaming URLs:
 * the Referer header is set correctly so Vidplay/echovideo decrypt
 * the video source successfully.
 */
@CapacitorPlugin(name = "EmbedScraper")
public class EmbedScraperPlugin extends Plugin {

    private WebView scrapeWebView = null;
    private boolean captured = false;
    private String currentSessionId = null;
    private final List<JSObject> capturedSubtitles = Collections.synchronizedList(new ArrayList<>());
    private final Set<String> seenSubUrls = Collections.synchronizedSet(new HashSet<>());

    private static final String BOOSTER_JS = 
        "(function() {" +
        "  if (window.__aniBooster) return;" +
        "  window.__aniBooster = true;" +
        "  window.open = function() { return null; };" +
        "  function notify(url) {" +
        "    if (!url || typeof url !== 'string') return;" +
        "    var u = url.toLowerCase();" +
        "    if (u.indexOf('.m3u8') !== -1 || u.indexOf('.mp4') !== -1 || u.indexOf('.mpd') !== -1 || u.indexOf('.m4v') !== -1) {" +
        "      if (window.AniPlayBridge && window.AniPlayBridge.onStreamDetected) {" +
        "        window.AniPlayBridge.onStreamDetected(url);" +
        "      }" +
        "    }" +
        "  }" +
        "  function checkCfg(cfg) {" +
        "    if (!cfg) return;" +
        "    try {" +
        "      if (cfg.file) notify(cfg.file);" +
        "      if (cfg.sources) {" +
        "        if (typeof cfg.sources.file === 'string') notify(cfg.sources.file);" +
        "        else if (Array.isArray(cfg.sources)) {" +
        "          for (var i = 0; i < cfg.sources.length; i++) {" +
        "            if (cfg.sources[i] && cfg.sources[i].file) notify(cfg.sources[i].file);" +
        "          }" +
        "        }" +
        "      }" +
        "      if (Array.isArray(cfg.playlist)) {" +
        "        for (var j = 0; j < cfg.playlist.length; j++) {" +
        "          checkCfg(cfg.playlist[j]);" +
        "        }" +
        "      }" +
        "      if (Array.isArray(cfg.tracks) && window.AniPlayBridge && window.AniPlayBridge.onSubtitleDetected) {" +
        "        for (var k = 0; k < cfg.tracks.length; k++) {" +
        "          var tr = cfg.tracks[k];" +
        "          if (tr && tr.file) window.AniPlayBridge.onSubtitleDetected(tr.file, tr.label || 'English');" +
        "        }" +
        "      }" +
        "    } catch(e) {}" +
        "  }" +
        "  try {" +
        "    var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');" +
        "    if (desc && desc.set) {" +
        "      var origSet = desc.set;" +
        "      Object.defineProperty(HTMLMediaElement.prototype, 'src', {" +
        "        set: function(val) { notify(val); return origSet.call(this, val); }," +
        "        get: desc.get" +
        "      });" +
        "    }" +
        "  } catch(e) {}" +
        "  try {" +
        "    var wrapJw = function(orig) {" +
        "      return function() {" +
        "        var p = orig.apply(this, arguments);" +
        "        if (p && p.setup) {" +
        "          var origSetup = p.setup;" +
        "          p.setup = function(cfg) {" +
        "            checkCfg(cfg);" +
        "            return origSetup.apply(this, arguments);" +
        "          };" +
        "        }" +
        "        return p;" +
        "      };" +
        "    };" +
        "    var _jw = window.jwplayer ? wrapJw(window.jwplayer) : undefined;" +
        "    Object.defineProperty(window, 'jwplayer', {" +
        "      configurable: true," +
        "      get: function() { return _jw; }," +
        "      set: function(fn) { _jw = wrapJw(fn); }" +
        "    });" +
        "  } catch(e) {}" +
        "  try {" +
        "    if (window.Hls && window.Hls.prototype) {" +
        "      var origHls = window.Hls.prototype.loadSource;" +
        "      window.Hls.prototype.loadSource = function(src) {" +
        "        notify(src);" +
        "        return origHls.apply(this, arguments);" +
        "      };" +
        "    }" +
        "  } catch(e) {}" +
        "  try {" +
        "    var origFetch = window.fetch;" +
        "    window.fetch = function(input, init) {" +
        "      var u = typeof input === 'string' ? input : (input && input.url);" +
        "      notify(u);" +
        "      return origFetch.apply(this, arguments);" +
        "    };" +
        "  } catch(e) {}" +
        "  try {" +
        "    var origXhr = XMLHttpRequest.prototype.open;" +
        "    XMLHttpRequest.prototype.open = function(m, u) {" +
        "      notify(u);" +
        "      return origXhr.apply(this, arguments);" +
        "    };" +
        "  } catch(e) {}" +
        "  var cnt = 0;" +
        "  var clk = setInterval(function() {" +
        "    cnt++;" +
        "    var sel = ['video', '#player', '.jw-video', '.jw-display-icon-container', '.vjs-big-play-button', '.play-button', '[class*=\"play\"]', '[id*=\"play\"]'];" +
        "    for (var i = 0; i < sel.length; i++) {" +
        "      var el = document.querySelector(sel[i]);" +
        "      if (el) {" +
        "        el.click();" +
        "        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));" +
        "      }" +
        "    }" +
        "    if (cnt > 50) clearInterval(clk);" +
        "  }, 50);" +
        "})();";

    @Override
    public void load() {
        super.load();
        getActivity().runOnUiThread(this::ensureWebView);
    }

    private void ensureWebView() {
        if (scrapeWebView != null) return;
        scrapeWebView = new WebView(getContext());
        ViewGroup rootView = getActivity().findViewById(android.R.id.content);
        if (rootView != null) {
            ViewGroup.LayoutParams lp = new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 
                ViewGroup.LayoutParams.MATCH_PARENT
            );
            scrapeWebView.setAlpha(0.01f);
            scrapeWebView.setFocusable(false);
            scrapeWebView.setClickable(false);
            rootView.addView(scrapeWebView, 0, lp);
            Window window = getActivity().getWindow();
            window.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.setNavigationBarContrastEnforced(false);
            }
            if (getActivity() instanceof MainActivity) {
                ((MainActivity) getActivity()).applyFullscreen();
            }
        }
        WebSettings settings = scrapeWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setUserAgentString("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36");
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadsImagesAutomatically(false);
        settings.setBlockNetworkImage(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);

        android.webkit.CookieManager cookieManager = android.webkit.CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(scrapeWebView, true);
        }

        scrapeWebView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void onStreamDetected(String url) {
                handleCapturedStream(url);
            }
            @android.webkit.JavascriptInterface
            public void onSubtitleDetected(String file, String label) {
                handleCapturedSubtitle(file, label);
            }
        }, "AniPlayBridge");

        scrapeWebView.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                // Completely block any ad popups / new windows
                return false;
            }
            @Override
            public boolean onJsAlert(WebView view, String url, String message, android.webkit.JsResult result) {
                result.cancel();
                return true;
            }
            @Override
            public boolean onJsConfirm(WebView view, String url, String message, android.webkit.JsResult result) {
                result.cancel();
                return true;
            }
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                super.onProgressChanged(view, newProgress);
                if (newProgress >= 15 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    view.evaluateJavascript(BOOSTER_JS, null);
                }
            }
        });

        scrapeWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String reqUrl = request.getUrl().toString().toLowerCase();
                // Block all ad redirects
                if (reqUrl.contains("doubleclick") || reqUrl.contains("googleads") || reqUrl.contains("popads")
                    || reqUrl.contains("onclickads") || reqUrl.contains("bodegashunlike") || reqUrl.contains("nekostream")
                    || reqUrl.contains("linkmansclate") || reqUrl.contains("bet365") || reqUrl.contains("1xbet")
                    || reqUrl.contains("adsterra") || reqUrl.contains("exoclick")) {
                    return true;
                }
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    view.evaluateJavascript(BOOSTER_JS, null);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    view.evaluateJavascript(BOOSTER_JS, null);
                }
            }

            @Override
            public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
                handler.proceed();
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                String reqUrl = request.getUrl().toString();
                String lowerReq = reqUrl.toLowerCase();

                // ── Capture Subtitle & Caption URLs ───────────────────────────────────────
                boolean isAdUrl = lowerReq.contains("doubleclick") || lowerReq.contains("googleads") || lowerReq.contains("adserver") || lowerReq.contains("popads") || lowerReq.contains("analytics");
                if (!isAdUrl && (lowerReq.contains(".vtt") || lowerReq.contains(".srt") || (lowerReq.contains("/subtitles/") && !lowerReq.contains(".css")))) {
                    if (seenSubUrls.add(reqUrl)) {
                        JSObject subObj = new JSObject();
                        subObj.put("file", reqUrl);
                        String label = "English";
                        if (lowerReq.contains("spa") || lowerReq.contains("spanish") || lowerReq.contains("latin")) label = "Spanish";
                        else if (lowerReq.contains("fre") || lowerReq.contains("french")) label = "French";
                        else if (lowerReq.contains("ger") || lowerReq.contains("german")) label = "German";
                        else if (lowerReq.contains("ita") || lowerReq.contains("italian")) label = "Italian";
                        else if (lowerReq.contains("por") || lowerReq.contains("portuguese")) label = "Portuguese";
                        else if (lowerReq.contains("ara") || lowerReq.contains("arabic")) label = "Arabic";
                        else if (lowerReq.contains("rus") || lowerReq.contains("russian")) label = "Russian";
                        else if (lowerReq.contains("hin") || lowerReq.contains("hindi")) label = "Hindi";
                        subObj.put("label", label);
                        capturedSubtitles.add(subObj);
                    }
                }

                // ── Capture the first REAL media URL ──────────────────────────────────────
                boolean isAdM3u8 = lowerReq.contains("doubleclick") || lowerReq.contains("googleads") || lowerReq.contains("adserver") || lowerReq.contains("popads");

                if (!captured && !isAdM3u8 && (
                        lowerReq.contains(".m3u8") 
                     || lowerReq.contains(".mp4") 
                     || lowerReq.contains(".mpd") 
                     || lowerReq.contains(".m4v") 
                     || lowerReq.contains("googlevideo.com/videoplayback"))) {
                    handleCapturedStream(reqUrl);
                    // Return empty response so WebView does not waste bandwidth downloading video segments in background
                    return new WebResourceResponse("application/vnd.apple.mpegurl", "UTF-8", new java.io.ByteArrayInputStream(new byte[0]));
                }

                // Block stylesheets, fonts, images, tracking/analytics, and all known ad networks for maximum speed
                if (lowerReq.contains(".css") 
                    || lowerReq.contains(".png")
                    || lowerReq.contains(".jpg")
                    || lowerReq.contains(".jpeg")
                    || lowerReq.contains(".gif")
                    || lowerReq.contains(".svg")
                    || lowerReq.contains(".webp")
                    || lowerReq.contains(".ico")
                    || lowerReq.contains(".woff")
                    || lowerReq.contains(".ttf")
                    || lowerReq.contains(".otf")
                    || lowerReq.contains("google-analytics.com") 
                    || lowerReq.contains("doubleclick.net")
                    || lowerReq.contains("adnxs.com")
                    || lowerReq.contains("adsystem")
                    || lowerReq.contains("popads")
                    || lowerReq.contains("onclickads")
                    || lowerReq.contains("exoclick")
                    || lowerReq.contains("juicyads")
                    || lowerReq.contains("arnattoprana")
                    || lowerReq.contains("omg10")
                    || lowerReq.contains("cpmstar")
                    || lowerReq.contains("adsterra")
                    || lowerReq.contains("histats")
                    || lowerReq.contains("statcounter")
                    || lowerReq.contains("statlytic.net")
                    || lowerReq.contains("fonts.googleapis")
                    || lowerReq.contains("fonts.gstatic")
                    || lowerReq.contains("nekostream.site")
                    || lowerReq.contains("bodegashunlike")
                    || lowerReq.contains("linkmansclate")
                    || lowerReq.contains("volume-booster")
                    || lowerReq.contains("live-sync")
                    || lowerReq.contains("parent-fullscreen-bridge")) {
                    return new WebResourceResponse("text/plain", "UTF-8", new java.io.ByteArrayInputStream(new byte[0]));
                }

                return super.shouldInterceptRequest(view, request);
            }
        });
    }

    private synchronized void handleCapturedStream(String mediaUrl) {
        if (captured || mediaUrl == null || mediaUrl.isEmpty()) return;
        captured = true;
        final String sid = currentSessionId;

        Log.d("EmbedScraper", "FAST STREAM CAPTURED: " + mediaUrl);

        // Auto-derive standard English subtitle URL if CDN pattern matches
        String lowerReq = mediaUrl.toLowerCase();
        if (lowerReq.contains("/master.m3u8") || lowerReq.contains("/index.m3u8")) {
            String derivedEng = mediaUrl.replaceAll("/(?:master|index)\\.m3u8.*$", "/subtitles/track_0_eng.vtt");
            if (seenSubUrls.add(derivedEng)) {
                JSObject engSub = new JSObject();
                engSub.put("file", derivedEng);
                engSub.put("label", "English");
                engSub.put("default", true);
                capturedSubtitles.add(0, engSub);
            }
        }

        // Stop loading immediately to conserve mobile network bandwidth and CPU
        getActivity().runOnUiThread(() -> {
            if (scrapeWebView != null) {
                scrapeWebView.stopLoading();
            }
        });

        JSObject data = new JSObject();
        data.put("url", mediaUrl);
        data.put("sessionId", sid);
        JSArray subsArray = new JSArray();
        synchronized (capturedSubtitles) {
            for (JSObject s : capturedSubtitles) {
                subsArray.put(s);
            }
        }
        data.put("subtitles", subsArray);
        notifyListeners("streamCaptured", data);
    }

    private void handleCapturedSubtitle(String file, String label) {
        if (file == null || file.isEmpty() || !seenSubUrls.add(file)) return;
        JSObject sub = new JSObject();
        sub.put("file", file);
        sub.put("label", label != null && !label.isEmpty() ? label : "English");
        sub.put("default", false);
        capturedSubtitles.add(sub);
    }

    @PluginMethod
    public void startScrape(final PluginCall call) {
        final String url = call.getString("url", "");
        final String referer = call.getString("referer", "https://aniwaves.ru/");
        final String sessionId = call.getString("sessionId", "default");

        if (url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        captured = false;
        currentSessionId = sessionId;
        capturedSubtitles.clear();
        seenSubUrls.clear();

        getActivity().runOnUiThread(() -> {
            ensureWebView();
            scrapeWebView.stopLoading();

            Map<String, String> headers = new HashMap<>();
            headers.put("Referer", referer);
            headers.put("Origin", referer.replaceAll("/$", ""));

            scrapeWebView.loadUrl(url, headers);
            call.resolve();
        });
    }

    @PluginMethod
    public void setImmersiveMode(final PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        getActivity().runOnUiThread(() -> {
            // Update the shared state flag so onWindowFocusChanged respects the right mode
            MainActivity.isImmersiveMode = enabled;

            Window window = getActivity().getWindow();
            View decorView = window.getDecorView();

            if (enabled) {
                // Enter fullscreen for video: hide status bar + navigation bar
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    WindowInsetsController controller = window.getInsetsController();
                    if (controller != null) {
                        controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                        controller.setSystemBarsBehavior(
                            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                        );
                    }
                } else {
                    decorView.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                    );
                }
            } else {
                // Exit fullscreen: restore nav bar visibility via applyFullscreen()
                // This ensures the nav bar is always restored properly including on older APIs
                ((MainActivity) getActivity()).applyFullscreen();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setOrientation(final PluginCall call) {
        final String orientation = call.getString("orientation", "portrait");
        getActivity().runOnUiThread(() -> {
            try {
                if ("landscape".equalsIgnoreCase(orientation) || "sensor-landscape".equalsIgnoreCase(orientation)) {
                    getActivity().setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                } else if ("portrait".equalsIgnoreCase(orientation)) {
                    getActivity().setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                } else if ("unlocked".equalsIgnoreCase(orientation) || "unspecified".equalsIgnoreCase(orientation)) {
                    getActivity().setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("Failed setting orientation: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void setWebViewVisibility(final PluginCall call) {
        final boolean visible = Boolean.TRUE.equals(call.getBoolean("visible", false));
        getActivity().runOnUiThread(() -> {
            if (scrapeWebView != null) {
                if (visible) {
                    scrapeWebView.setAlpha(1.0f);
                    scrapeWebView.bringToFront();
                    scrapeWebView.requestFocus();
                } else {
                    scrapeWebView.setAlpha(0.01f);
                    ViewGroup parent = (ViewGroup) scrapeWebView.getParent();
                    if (parent != null) {
                        parent.removeView(scrapeWebView);
                        parent.addView(scrapeWebView, 0);
                    }
                }
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void stopScrape(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (scrapeWebView != null) {
                scrapeWebView.stopLoading();
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                android.webkit.CookieManager.getInstance().flush();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void getCookiesForUrl(final PluginCall call) {
        final String url = call.getString("url", "");
        if (url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                android.webkit.CookieManager cookieManager = android.webkit.CookieManager.getInstance();
                String cookies = cookieManager.getCookie(url);
                JSObject result = new JSObject();
                result.put("cookies", cookies != null ? cookies : "");
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Failed to get cookies: " + e.getMessage());
            }
        });
    }

    /**
     * fetchViaWebView: Executes a fetch() call FROM INSIDE the WebView's Cloudflare-cleared session.
     *
     * This is the correct way to make authenticated requests to Cloudflare-protected sites:
     * - The WebView already has cf_clearance cookies for the domain (solved during startScrape)
     * - fetch() runs in the same JS context so cookies are sent automatically
     * - No cookie transfer or User-Agent matching needed
     *
     * Parameters:
     *   url      - The API URL to fetch (e.g. https://animepahe.com/api?m=search&q=One+Piece)
     *   referer  - Referer header to include
     *   domainUrl - Domain the WebView should be on (navigate there first if needed)
     */
    @PluginMethod
    public void fetchViaWebView(final PluginCall call) {
        call.setKeepAlive(true);
        final String url = call.getString("url", "");
        final String referer = call.getString("referer", "");
        final String domainUrl = call.getString("domainUrl", "");

        if (url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            ensureWebView();

            // Build the JavaScript fetch string to run inside the WebView
            String escapedUrl = url.replace("\"", "\\\"");
            String escapedReferer = referer.replace("\"", "\\\"");

            final String fetchJs = "(async function() {" +
                "  try {" +
                "    const resp = await fetch(\"" + escapedUrl + "\", {" +
                "      headers: {" +
                "        'Accept': 'application/json, text/html, */*'," +
                "        'Referer': \"" + escapedReferer + "\"" +
                "      }," +
                "      credentials: 'include'" +
                "    });" +
                "    const text = await resp.text();" +
                "    return JSON.stringify({ status: resp.status, body: text });" +
                "  } catch(e) {" +
                "    return JSON.stringify({ error: e.message });" +
                "  }" +
                "})()";

            final Runnable executeScript = () -> {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.KITKAT) {
                    scrapeWebView.evaluateJavascript(fetchJs, resultValue -> {
                        getActivity().runOnUiThread(() -> {
                            try {
                                String raw = resultValue;
                                if (raw != null && raw.startsWith("\"") && raw.endsWith("\"")) {
                                    raw = raw.substring(1, raw.length() - 1)
                                        .replace("\\\"", "\"")
                                        .replace("\\n", "\n")
                                        .replace("\\\\", "\\");
                                }
                                JSObject result = new JSObject();
                                result.put("body", raw != null ? raw : "");
                                call.resolve(result);
                            } catch (Exception e) {
                                call.reject("fetchViaWebView parse error: " + e.getMessage());
                            }
                        });
                    });
                } else {
                    call.reject("fetchViaWebView requires Android 4.4+");
                }
            };

            // Check if we need to navigate the WebView to the target domain origin first to satisfy CORS
            boolean needsNavigate = false;
            String currentUrl = scrapeWebView.getUrl();
            if (currentUrl == null || currentUrl.isEmpty() || currentUrl.equals("about:blank")) {
                needsNavigate = true;
            } else if (!domainUrl.isEmpty()) {
                try {
                    android.net.Uri currentUri = android.net.Uri.parse(currentUrl);
                    android.net.Uri targetUri = android.net.Uri.parse(domainUrl);
                    String currentHost = currentUri.getHost();
                    String targetHost = targetUri.getHost();
                    if (currentHost == null || targetHost == null || !currentHost.equals(targetHost)) {
                        needsNavigate = true;
                    }
                } catch (Exception e) {
                    needsNavigate = true;
                }
            }

            if (needsNavigate && !domainUrl.isEmpty()) {
                Log.d("EmbedScraper", "Navigating WebView to domain URL: " + domainUrl + " for fetch context");
                scrapeWebView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        super.onPageFinished(view, url);
                        executeScript.run();
                    }
                    @Override
                    public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
                        handler.proceed();
                    }
                });
                if (!referer.isEmpty()) {
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Referer", referer);
                    headers.put("Origin", referer.replaceAll("/$", ""));
                    scrapeWebView.loadUrl(domainUrl, headers);
                } else {
                    scrapeWebView.loadUrl(domainUrl);
                }
            } else {
                executeScript.run();
            }
        });
    }

    /**
     * fetchSegmentBinary — Downloads an HLS segment through the WebView's browser context.
     *
     * WHY THIS EXISTS: Cloudflare Bot Management checks the TLS fingerprint (JA3/JA4)
     * of the HTTP client. OkHttp's TLS fingerprint differs from Chrome's → 403.
     * The WebView uses Chromium's network stack WITH the correct Chrome TLS fingerprint
     * AND already has cf_clearance cookies from loading the embed page.
     *
     * By running fetch() INSIDE the WebView, segments are downloaded with:
     *   - Chrome TLS fingerprint (passes Cloudflare Bot Management)
     *   - All CDN cookies (cf_clearance, session tokens, etc.)
     *   - Same security origin context as the embed player
     *
     * Returns base64-encoded binary data of the segment.
     */
    @PluginMethod
    public void fetchSegmentBinary(final PluginCall call) {
        call.setKeepAlive(true);
        final String url = call.getString("url", "");
        final String referer = call.getString("referer", "");

        if (url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            if (scrapeWebView == null) {
                call.reject("WebView not available - call startScrape first");
                return;
            }

            // Safely escape URL and referer for embedding in JS string literal
            String escapedUrl = url.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "").replace("\r", "");
            String escapedRef = referer.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "").replace("\r", "");

            // JS: fetch binary → convert to base64 in chunks (avoids stack overflow on large segments)
            final String fetchJs =
                "(async function() {" +
                "  try {" +
                "    const resp = await fetch(\"" + escapedUrl + "\", {" +
                "      credentials: 'include'," +
                "      headers: { 'Accept': '*/*', 'Referer': \"" + escapedRef + "\" }" +
                "    });" +
                "    if (!resp.ok) return 'ERR:HTTP' + resp.status;" +
                "    const buf = await resp.arrayBuffer();" +
                "    const bytes = new Uint8Array(buf);" +
                "    const chunk = 8192;" +
                "    const parts = [];" +
                "    for (let i = 0; i < bytes.length; i += chunk) {" +
                "      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i+chunk, bytes.length))));" +
                "    }" +
                "    return 'OK:' + btoa(parts.join(''));" +
                "  } catch(e) { return 'ERR:' + e.message; }" +
                "})();";

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                scrapeWebView.evaluateJavascript(fetchJs, resultValue -> {
                    getActivity().runOnUiThread(() -> {
                        try {
                            // evaluateJavascript wraps string result in JSON quotes — unwrap
                            String raw = resultValue;
                            if (raw != null && raw.startsWith("\"") && raw.endsWith("\"")) {
                                raw = raw.substring(1, raw.length() - 1)
                                    .replace("\\\"", "\"")
                                    .replace("\\\\", "\\");
                            }
                            if (raw == null || raw.startsWith("ERR:")) {
                                call.reject("Segment fetch failed: " + (raw != null ? raw.substring(4) : "null"));
                            } else if (raw.startsWith("OK:")) {
                                JSObject result = new JSObject();
                                result.put("data", raw.substring(3));
                                call.resolve(result);
                            } else {
                                call.reject("Unexpected JS result: " + raw.substring(0, Math.min(80, raw.length())));
                            }
                        } catch (Exception e) {
                            call.reject("fetchSegmentBinary error: " + e.getMessage());
                        }
                    });
                });
            } else {
                call.reject("Requires Android 4.4+ (API 19)");
            }
        });
    }

    private void destroyWebView() {
        if (scrapeWebView != null) {
            try {
                scrapeWebView.stopLoading();
                scrapeWebView.onPause();
                scrapeWebView.loadUrl("about:blank");
                scrapeWebView.clearHistory();
                ViewGroup parent = (ViewGroup) scrapeWebView.getParent();
                if (parent != null) {
                    parent.removeView(scrapeWebView);
                }
                scrapeWebView.destroy();
            } catch (Exception ignored) {}
            scrapeWebView = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        getActivity().runOnUiThread(this::destroyWebView);
    }
}
