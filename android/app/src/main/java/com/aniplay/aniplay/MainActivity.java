package com.aniplay.aniplay;

import android.os.Bundle;
import android.os.Build;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register native Capacitor plugins
        registerPlugin(EmbedScraperPlugin.class);

        // Keep the splash screen until the web content is ready
        super.onCreate(savedInstanceState);

        // Full hardware acceleration at the window level
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);

        // Force edge-to-edge (immersive layout) so WebView content sits behind translucent system bars
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
            getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                getWindow().setDecorFitsSystemWindows(false);
            } else {
                getWindow().getDecorView().setSystemUiVisibility(
                    android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                );
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        configureWebView();
    }

    /**
     * Route the Android hardware back button into the React Router SPA.
     * We evaluate JS to check history.length and call history.back().
     * Only if there is nowhere to go back to (history.length <= 1) do we exit the app.
     */
    @Override
    public void onBackPressed() {
        WebView webView = getBridge().getWebView();
        if (webView == null) {
            super.onBackPressed();
            return;
        }

        // Evaluate JS: go back if possible, return whether we could
        webView.evaluateJavascript(
            "(function() { "
            + "  if (window.history && window.history.length > 1) { "
            + "    window.history.back(); "
            + "    return true; "
            + "  } "
            + "  return false; "
            + "})()",
            canGoBack -> {
                if (!"true".equals(canGoBack)) {
                    // No more history — exit the app
                    runOnUiThread(() -> super.onBackPressed());
                }
            }
        );
    }

    private void configureWebView() {
        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        WebSettings s = webView.getSettings();

        // ── Critical for inline HLS video ──────────────────────────────
        // Allow JavaScript to call video.play() automatically (no tap needed)
        s.setMediaPlaybackRequiresUserGesture(false);

        // Mixed content: allow https page loading http CDN segments
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        // Allow the local Capacitor server to fetch from external origins
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowFileAccess(true);

        // ── Critical for video rendering ───────────────────────────────
        // LAYER_TYPE_NONE: let the video decoder composite directly to the display.
        // LAYER_TYPE_HARDWARE causes a separate GPU texture that blocks video output.
        // LAYER_TYPE_SOFTWARE is too slow for 720p decode.
        webView.setLayerType(WebView.LAYER_TYPE_NONE, null);

        // ── Native Feel Optimizations ──────────────────────────────────
        // Disable scroll overscroll bounce/glow effect
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

        // Disable native Android long-press selection menu/handlers
        webView.setOnLongClickListener(new android.view.View.OnLongClickListener() {
            @Override
            public boolean onLongClick(android.view.View v) {
                return true; // Consume the long-press event
            }
        });
        webView.setLongClickable(false);
    }
}
