package com.aniplay.aniplay;

import android.content.pm.PackageManager;
import android.Manifest;
import java.util.ArrayList;
import java.util.List;
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
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSObject;
import android.content.pm.ActivityInfo;

public class MainActivity extends BridgeActivity {
    public static boolean isImmersiveMode = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register native Capacitor plugins
        registerPlugin(EmbedScraperPlugin.class);
        registerPlugin(APKUpdaterPlugin.class);
        registerPlugin(OfflineDownloader.class);
        registerPlugin(BrightnessPlugin.class);

        // Initialize the native Android 12+ SplashScreen splash view
        androidx.core.splashscreen.SplashScreen.installSplashScreen(this);

        // Switch from splash launch theme to main app theme
        setTheme(R.style.AppTheme_NoActionBar);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);

        // ── EDGE-TO-EDGE: tell the window to draw behind ALL system bars ──
        // This is the modern API (WindowCompat) — replaces the deprecated FLAG_FULLSCREEN
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Keep the splash screen until the web content is ready
        super.onCreate(savedInstanceState);

        // Ensure notification permission is requested on Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }

        // Customize the WebChromeClient and enforce hardware GPU rendering
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            // Window is hardware-accelerated; LAYER_TYPE_NONE allows direct compositing & hardware video decoding
            webView.setLayerType(android.view.View.LAYER_TYPE_NONE, null);
            WebSettings ws = webView.getSettings();
            ws.setDomStorageEnabled(true);
            ws.setDatabaseEnabled(true);
            ws.setCacheMode(WebSettings.LOAD_DEFAULT);
            ws.setJavaScriptCanOpenWindowsAutomatically(true);
            // Pre-rasterize offscreen tiles on background thread for 120 FPS scrolling
            ws.setOffscreenPreRaster(true);

            webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
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

            // Inject CSS variables for all insets so React layout can account for system bars
            ViewCompat.setOnApplyWindowInsetsListener(getBridge().getWebView(), (v, insets) -> {
                Insets statusInsets  = insets.getInsets(WindowInsetsCompat.Type.statusBars());
                Insets cutoutInsets  = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
                Insets navInsets     = insets.getInsets(WindowInsetsCompat.Type.navigationBars());

                // WebView always fills edge-to-edge — no margins
                android.view.ViewGroup.MarginLayoutParams lp = (android.view.ViewGroup.MarginLayoutParams) v.getLayoutParams();
                if (lp != null) {
                    lp.topMargin    = 0;
                    lp.bottomMargin = 0;
                    v.setLayoutParams(lp);
                }

                float density = getResources().getDisplayMetrics().density;
                // Use the LARGER of status bar and display cutout (camera punch-hole).
                // When the status bar is hidden, statusInsets.top = 0 but cutoutInsets.top
                // still reports the camera module height, so --sat always has the correct
                // safe area value regardless of status bar visibility.
                int safeTopPx   = Math.max(statusInsets.top, cutoutInsets.top);
                int statusBarDp = Math.max(0, (int) (safeTopPx / density));
                int navBarDp    = isImmersiveMode ? 0 : (int) (navInsets.bottom / density);

                // Inject both variables into CSS so the web layer can pad content correctly
                final String js =
                    "document.documentElement.style.setProperty('--sat', '" + statusBarDp + "px');" +
                    "document.documentElement.style.setProperty('--android-safe-bottom', '" + navBarDp + "px');";

                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().post(() ->
                        getBridge().getWebView().evaluateJavascript(js, null));
                }
                return insets;
            });
        }

        // Full hardware acceleration at the window level
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);

        Window window = getWindow();

        // Disable contrast enforcement (removes forced gray scrim on Android Q+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }

        // Both bars fully transparent — WebView content shows through
        window.setStatusBarColor(android.graphics.Color.TRANSPARENT);
        window.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(android.graphics.Color.parseColor("#04040a")));
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);

        applySystemBarAppearance();

        // Request storage permissions on first launch
        getWindow().getDecorView().postDelayed(() -> {
            requestStoragePermissionsIfNeeded();
        }, 600);
    }

    /** Request storage read permissions on first launch. Without these:
     *  - File.exists() returns false on Android 10+ for external storage
     *  - Capacitor's _capacitor_file_ server can't open video files
     *  We request at startup so the dialog appears before the user tries to play.
     */
    private void requestStoragePermissionsIfNeeded() {
        List<String> perms = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+: granular media permissions (video only, not photos)
            if (checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO)
                    != PackageManager.PERMISSION_GRANTED)
                perms.add(Manifest.permission.READ_MEDIA_VIDEO);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // Android 6-12
            if (checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED)
                perms.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
                checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED)
                perms.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }
        if (!perms.isEmpty())
            requestPermissions(perms.toArray(new String[0]), 100);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Re-apply fullscreen when app regains focus (e.g. after dialog or notification shade)
        if (hasFocus) {
            applyFullscreen();
        }
    }

    /** Apply edge-to-edge immersive appearance without hiding the bars.
     *  Status bar icons are white (light-on-dark). Navigation bar transparent.
     *  When isImmersiveMode=true (video player), we hide ALL bars for cinema mode.
     */
    public void applyFullscreen() {
        applySystemBarAppearance();
    }

    private void applySystemBarAppearance() {
        Window window = getWindow();

        if (isImmersiveMode) {
            // ── Cinema mode: hide status + nav bars completely ──
            window.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
            window.setStatusBarColor(android.graphics.Color.TRANSPARENT);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.setDecorFitsSystemWindows(false);
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
            } else {
                window.getDecorView().setSystemUiVisibility(
                    android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                );
            }
        } else {
            // ── Normal mode: HIDE status bar (transient — reappears briefly on swipe-from-top) ──
            // Navigation bar stays visible so user can use Android back/home gestures.
            window.setStatusBarColor(android.graphics.Color.TRANSPARENT);
            window.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowCompat.setDecorFitsSystemWindows(window, false);
                android.view.WindowInsetsController ctrl = window.getInsetsController();
                if (ctrl != null) {
                    // HIDE the status bar — it briefly shows on swipe from top, then auto-hides
                    ctrl.hide(android.view.WindowInsets.Type.statusBars());
                    // Keep navigation bar visible for gestures
                    ctrl.show(android.view.WindowInsets.Type.navigationBars());
                    ctrl.setSystemBarsBehavior(
                        android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    );
                    // White nav bar icons on dark background
                    ctrl.setSystemBarsAppearance(0,
                        android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                        android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                // Pre-Android 11: fullscreen flag + immersive sticky for status bar
                window.getDecorView().setSystemUiVisibility(
                    android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                );
            }
        }
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().requestApplyInsets();
        }
    }

    @Override
    public void setRequestedOrientation(int requestedOrientation) {
        if (requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE) {
            // Map standard landscape lock to sensor-landscape (allows 180 degree rotation standard/reverse landscape)
            super.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        } else {
            super.setRequestedOrientation(requestedOrientation);
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

        // Hide native scrollbars completely (CSS can't hide Android WebView scrollbars)
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
    }
}
