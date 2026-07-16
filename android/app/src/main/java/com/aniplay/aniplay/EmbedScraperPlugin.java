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

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Map;


/**
 * EmbedScraperPlugin — True "Way 4" Client-Side WebView Scraping
 *
 * Opens a hidden Android WebView (not an iframe), loads the embed URL
 * with a custom Referer header, and intercepts all network requests via
 * shouldInterceptRequest(). When an .m3u8 URL is detected, it fires
 * a "streamCaptured" Capacitor event back to JavaScript.
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

        getActivity().runOnUiThread(() -> {
            // Destroy previous WebView if any
            destroyWebView();

            scrapeWebView = new WebView(getContext());
            ViewGroup rootView = getActivity().findViewById(android.R.id.content);
            if (rootView != null) {
                // Layout WebView as full screen, fully focusable/clickable, and drawn behind the main application WebView (index 0)
                ViewGroup.LayoutParams lp = new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, 
                    ViewGroup.LayoutParams.MATCH_PARENT
                );
                scrapeWebView.setAlpha(1.0f);
                scrapeWebView.setFocusable(true);
                scrapeWebView.setClickable(true);
                rootView.addView(scrapeWebView, 0, lp);
                // Re-enforce navigation bar color and fullscreen flags after WebView is added.
                // Adding a new View to the hierarchy can cause Android to briefly reset
                // system bar colors and visibility — this prevents the nav bar from turning white.
                android.view.Window window = getActivity().getWindow();
                window.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    window.setNavigationBarContrastEnforced(false);
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    android.view.WindowInsetsController wic = window.getInsetsController();
                    if (wic != null) {
                        wic.hide(
                            android.view.WindowInsets.Type.statusBars() |
                            android.view.WindowInsets.Type.navigationBars()
                        );
                        wic.setSystemBarsBehavior(
                            android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                        );
                    }
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
            android.webkit.CookieManager cookieManager = android.webkit.CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                cookieManager.setAcceptThirdPartyCookies(scrapeWebView, true);
            }

            scrapeWebView.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(
                        WebView view, WebResourceRequest request) {
                    String reqUrl = request.getUrl().toString();
                    // Capture the first media URL (.m3u8, .mp4, .mpd, .m4v, googlevideo) we see
                    String lowerReq = reqUrl.toLowerCase();
                    if (!captured && (lowerReq.contains(".m3u8") 
                        || lowerReq.contains(".mp4") 
                        || lowerReq.contains(".mpd") 
                        || lowerReq.contains(".m4v") 
                        || lowerReq.contains("googlevideo.com/videoplayback"))) {
                        captured = true;
                        final String sid = currentSessionId;
                        getActivity().runOnUiThread(() -> {
                            JSObject data = new JSObject();
                            data.put("url", reqUrl);
                            data.put("sessionId", sid);
                            notifyListeners("streamCaptured", data);
                        });
                    }

                    // Block stylesheets, fonts, images, and tracking/analytics to load pages up to 10x faster
                    String lowerUrl = reqUrl.toLowerCase();
                    if (lowerUrl.contains(".css") 
                        || lowerUrl.contains(".png")
                        || lowerUrl.contains(".jpg")
                        || lowerUrl.contains(".jpeg")
                        || lowerUrl.contains(".gif")
                        || lowerUrl.contains(".svg")
                        || lowerUrl.contains(".webp")
                        || lowerUrl.contains(".ico")
                        || lowerUrl.contains(".woff")
                        || lowerUrl.contains(".ttf")
                        || lowerUrl.contains(".otf")
                        || lowerUrl.contains("google-analytics.com") 
                        || lowerUrl.contains("doubleclick.net")
                        || lowerUrl.contains("adnxs.com")
                        || lowerUrl.contains("adsystem")
                        || lowerUrl.contains("popads")
                        || lowerUrl.contains("onclickads")
                        || lowerUrl.contains("exoclick")
                        || lowerUrl.contains("juicyads")
                        || lowerUrl.contains("arnattoprana")
                        || lowerUrl.contains("omg10")
                        || lowerUrl.contains("cpmstar")
                        || lowerUrl.contains("adsterra")
                        || lowerUrl.contains("histats")
                        || lowerUrl.contains("statcounter")
                        || lowerUrl.contains("fonts.googleapis")
                        || lowerUrl.contains("fonts.gstatic")) {
                        // Return empty response to block the request
                        return new WebResourceResponse("text/plain", "UTF-8", new java.io.ByteArrayInputStream(new byte[0]));
                    }

                    return super.shouldInterceptRequest(view, request);
                }

                @Override
                public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
                    handler.proceed(); // Ignore SSL errors from bad ad domains/expired hosts
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    // Inject a trigger-click script to start playback automatically
                    String js = "javascript:(function() { " +
                            "var clickTimer = setInterval(function() {" +
                            "  var selectors = ['video', '#player', '.jw-video', '.jw-display-icon-container', '.vjs-big-play-button', '.play-button', '[class*=\"play\"]', '[id*=\"play\"]'];" +
                            "  for (var i=0; i<selectors.length; i++) {" +
                            "    var el = document.querySelector(selectors[i]);" +
                            "    if (el) {" +
                            "      el.click();" +
                            "      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));" +
                            "    }" +
                            "  }" +
                            "}, 300);" +
                            "setTimeout(function() { clearInterval(clickTimer); }, 8000);" +
                            "})()";
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                        view.evaluateJavascript(js.replace("javascript:", ""), null);
                    } else {
                        view.loadUrl(js);
                    }
                }
            });

            // Load with custom Referer header — this is the key difference
            // that makes Vidplay decrypt correctly (same as how Cloudstream does it)
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
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                android.webkit.CookieManager.getInstance().flush();
            }
            destroyWebView();
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
            // Create a fresh WebView if not available
            boolean needsSetup = (scrapeWebView == null);
            if (needsSetup) {
                scrapeWebView = new WebView(getContext());
                ViewGroup rootView = getActivity().findViewById(android.R.id.content);
                if (rootView != null) {
                    ViewGroup.LayoutParams lp = new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    );
                    scrapeWebView.setAlpha(1.0f);
                    scrapeWebView.setFocusable(true);
                    scrapeWebView.setClickable(true);
                    rootView.addView(scrapeWebView, 0, lp);
                }
                WebSettings settings = scrapeWebView.getSettings();
                settings.setJavaScriptEnabled(true);
                settings.setUserAgentString("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36");
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setLoadWithOverviewMode(true);
                settings.setUseWideViewPort(true);
                android.webkit.CookieManager cookieManager = android.webkit.CookieManager.getInstance();
                cookieManager.setAcceptCookie(true);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    cookieManager.setAcceptThirdPartyCookies(scrapeWebView, true);
                }
            }

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


    private void destroyWebView() {
        if (scrapeWebView != null) {
            scrapeWebView.stopLoading();
            scrapeWebView.clearHistory();
            ViewGroup parent = (ViewGroup) scrapeWebView.getParent();
            if (parent != null) {
                parent.removeView(scrapeWebView);
            }
            scrapeWebView.destroy();
            scrapeWebView = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        getActivity().runOnUiThread(this::destroyWebView);
    }
}
