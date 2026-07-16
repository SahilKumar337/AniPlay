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
import android.content.pm.ActivityInfo;

public class MainActivity extends BridgeActivity {
    public static boolean isImmersiveMode = false;

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

            // Adjust WebView bounds based on whether immersive mode is active
            ViewCompat.setOnApplyWindowInsetsListener(getBridge().getWebView(), (v, insets) -> {
                Insets navInsets = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
                Insets imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime());
                boolean isKeyboardVisible = imeInsets.bottom > 0;

                android.view.ViewGroup.MarginLayoutParams lp = (android.view.ViewGroup.MarginLayoutParams) v.getLayoutParams();
                if (lp != null) {
                    lp.topMargin    = 0; // Full edge-to-edge on top
                    lp.bottomMargin = 0; // Full edge-to-edge on bottom — CSS --android-safe-bottom pads content
                    v.setLayoutParams(lp);
                }
                // Inject the navigation bar height as a CSS variable so in-app content can pad itself
                int navBarHeightPx = isImmersiveMode ? 0 : navInsets.bottom;
                float density = getResources().getDisplayMetrics().density;
                int navBarHeightDp = (int) (navBarHeightPx / density);
                final String js = "document.documentElement.style.setProperty('--android-safe-bottom', '" + navBarHeightDp + "px')";
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(js, null));
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

        // Draw edge-to-edge behind system bars — both bars are transparent so WebView content bleeds through
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(android.graphics.Color.TRANSPARENT);
        // TRANSPARENT: app content (translucent glass navbar) shows through the system nav bar
        window.setNavigationBarColor(android.graphics.Color.TRANSPARENT);

        applyFullscreen();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Re-apply fullscreen when app regains focus (e.g. after dialog or notification shade)
        if (hasFocus) {
            applyFullscreen();
        }
    }

    public void applyFullscreen() {
        Window window = getWindow();
        if (isImmersiveMode) {
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
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
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
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.setDecorFitsSystemWindows(false);
                android.view.WindowInsetsController ctrl = window.getInsetsController();
                if (ctrl != null) {
                    // Hide only status bars (immersive top), show navigation bars (visible bottom)
                    ctrl.hide(android.view.WindowInsets.Type.statusBars());
                    ctrl.show(android.view.WindowInsets.Type.navigationBars());
                    // Light text/icons on dark system bars (0 means dark background appearance)
                    ctrl.setSystemBarsAppearance(0, android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
                    ctrl.setSystemBarsAppearance(0, android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                window.getDecorView().setSystemUiVisibility(
                    android.view.View.SYSTEM_UI_FLAG_FULLSCREEN // Hide status bar
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
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
    }
}
