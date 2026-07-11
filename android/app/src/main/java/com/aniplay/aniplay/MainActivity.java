package com.aniplay.aniplay;

import android.os.Bundle;
import android.os.Build;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.view.Window;
import android.view.WindowManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.graphics.Insets;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSObject;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register native Capacitor plugins
        registerPlugin(EmbedScraperPlugin.class);
        registerPlugin(APKUpdaterPlugin.class);
        registerPlugin(OfflineDownloader.class);

        // Initialize the native Android 12+ SplashScreen splash view
        androidx.core.splashscreen.SplashScreen.installSplashScreen(this);

        // Switch from splash launch theme to main app theme
        setTheme(R.style.AppTheme_NoActionBar);

        // Keep the splash screen until the web content is ready
        super.onCreate(savedInstanceState);

        // Customize the WebChromeClient to hide the default poster
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                @Override
                public Bitmap getDefaultVideoPoster() {
                    try {
                        Bitmap bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
                        Canvas canvas = new Canvas(bitmap);
                        canvas.drawARGB(0, 0, 0, 0);
                        return bitmap;
                    } catch (Exception e) {
                        return super.getDefaultVideoPoster();
                    }
                }
            });

            // Only apply bottom inset (for gesture nav bar) when keyboard is hidden.
            ViewCompat.setOnApplyWindowInsetsListener(getBridge().getWebView(), (v, insets) -> {
                Insets navInsets = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
                Insets imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime());
                boolean isKeyboardVisible = imeInsets.bottom > 0;

                android.view.ViewGroup.MarginLayoutParams lp = (android.view.ViewGroup.MarginLayoutParams) v.getLayoutParams();
                if (lp != null) {
                    lp.topMargin    = 0;            // No top margin — status bar is hidden
                    lp.bottomMargin = isKeyboardVisible ? 0 : navInsets.bottom; // Flush WebView to keyboard when open
                    v.setLayoutParams(lp);
                }
                return insets;
            });
        }

        // Full hardware acceleration at the window level
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);

        Window window = getWindow();

        // Disable contrast enforcement for status and navigation bars (removes forced gray scrim on Android Q+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }

        // Set window background to solid black
        window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(android.graphics.Color.BLACK));

        // Draw edge-to-edge behind system bars
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(android.graphics.Color.TRANSPARENT);
        window.setNavigationBarColor(android.graphics.Color.BLACK);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // API 30+: modern WindowInsetsController approach
            window.setDecorFitsSystemWindows(false);
            android.view.WindowInsetsController insetsController = window.getInsetsController();
            if (insetsController != null) {
                // Hide BOTH status bar (time, battery) AND navigation bar
                insetsController.hide(
                    android.view.WindowInsets.Type.statusBars() |
                    android.view.WindowInsets.Type.navigationBars()
                );
                // Swipe-from-edges gesture temporarily shows bars, then auto-hides
                insetsController.setSystemBarsBehavior(
                    android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            // API 21–29: legacy flags for fullscreen + immersive
            window.getDecorView().setSystemUiVisibility(
                android.view.View.SYSTEM_UI_FLAG_FULLSCREEN          // hide status bar
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN  // draw behind status bar
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY   // auto-hide after swipe
            );
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Re-apply fullscreen when app regains focus (e.g. after dialog or notification shade)
        if (hasFocus) {
            applyFullscreen();
        }
    }

    private void applyFullscreen() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.view.WindowInsetsController ctrl = window.getInsetsController();
            if (ctrl != null) {
                ctrl.hide(
                    android.view.WindowInsets.Type.statusBars() |
                    android.view.WindowInsets.Type.navigationBars()
                );
                ctrl.setSystemBarsBehavior(
                    android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.getDecorView().setSystemUiVisibility(
                android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }
    }


    @Override
    public void onResume() {
        super.onResume();
        applyFullscreen();
        configureWebView();
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
