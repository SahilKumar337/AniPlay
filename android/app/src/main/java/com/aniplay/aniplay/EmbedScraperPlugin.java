package com.aniplay.aniplay;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.Window;

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
            WebSettings settings = scrapeWebView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setLoadWithOverviewMode(true);
            settings.setUseWideViewPort(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(scrapeWebView, true);
            }
            // Use the same UA as the main app for consistency
            settings.setUserAgentString(
                "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"
            );

            scrapeWebView.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(
                        WebView view, WebResourceRequest request) {
                    String reqUrl = request.getUrl().toString();
                    // Capture the first .m3u8 URL we see
                    if (!captured && reqUrl.contains(".m3u8")) {
                        captured = true;
                        final String sid = currentSessionId;
                        getActivity().runOnUiThread(() -> {
                            JSObject data = new JSObject();
                            data.put("url", reqUrl);
                            data.put("sessionId", sid);
                            notifyListeners("streamCaptured", data);
                        });
                    }

                    // Block known tracking, analytics, and redirect ad domains to load pages 10x faster
                    String lowerUrl = reqUrl.toLowerCase();
                    if (lowerUrl.contains("google-analytics.com") 
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
                        || (lowerUrl.endsWith(".js") && !lowerUrl.contains("jquery") && !lowerUrl.contains("jwplayer") && !lowerUrl.contains("hls") && !lowerUrl.contains("player") && !lowerUrl.contains("echovideo") && !lowerUrl.contains("bundle"))) {
                        // Return empty response to block the request
                        return new WebResourceResponse("text/javascript", "UTF-8", new java.io.ByteArrayInputStream(new byte[0]));
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
            Window window = getActivity().getWindow();
            View decorView = window.getDecorView();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // API 30+ — WindowInsetsController (modern, no deprecation)
                WindowInsetsController controller = window.getInsetsController();
                if (controller != null) {
                    if (enabled) {
                        controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                        controller.setSystemBarsBehavior(
                            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                        );
                    } else {
                        controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    }
                }
            } else {
                // API < 30 — legacy flags
                if (enabled) {
                    decorView.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                    );
                } else {
                    decorView.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    );
                }
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void stopScrape(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            destroyWebView();
            call.resolve();
        });
    }


    private void destroyWebView() {
        if (scrapeWebView != null) {
            scrapeWebView.stopLoading();
            scrapeWebView.clearHistory();
            scrapeWebView.destroy();
            scrapeWebView = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        getActivity().runOnUiThread(this::destroyWebView);
    }
}
