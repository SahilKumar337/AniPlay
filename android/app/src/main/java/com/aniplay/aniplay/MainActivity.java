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

            // Dynamically pad the WebView content so it is never covered by the system navigation bar
            // Dynamically resize the WebView layout margins to fit exactly between system status and navigation bars
            ViewCompat.setOnApplyWindowInsetsListener(getBridge().getWebView(), (v, insets) -> {
                Insets systemBarInsets = insets.getInsets(WindowInsetsCompat.Type.systemBars());
                
                android.view.ViewGroup.MarginLayoutParams lp = (android.view.ViewGroup.MarginLayoutParams) v.getLayoutParams();
                if (lp != null) {
                    lp.topMargin = systemBarInsets.top;
                    lp.bottomMargin = systemBarInsets.bottom;
                    v.setLayoutParams(lp);
                }
                
                return insets;
            });
        }

        // Full hardware acceleration at the window level
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);

        // Configure solid black status and navigation bars
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Window window = getWindow();
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                    | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(android.graphics.Color.BLACK);
            window.setNavigationBarColor(android.graphics.Color.BLACK);
            
            // Force edge-to-edge so the window draws behind system bars, which we then pad/margin in Java
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.setDecorFitsSystemWindows(false);
            } else {
                window.getDecorView().setSystemUiVisibility(
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

@CapacitorPlugin(name = "APKUpdater")
class APKUpdaterPlugin extends Plugin {
    @PluginMethod
    public void getAppVersion(PluginCall call) {
        try {
            android.content.pm.PackageInfo pInfo = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject ret = new JSObject();
            ret.put("versionName", pInfo.versionName);
            ret.put("versionCode", pInfo.versionCode);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String urlString = call.getString("url");
        if (urlString == null) {
            call.reject("URL is required");
            return;
        }

        new Thread(() -> {
            try {
                java.net.URL url = new java.net.URL(urlString);
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.connect();
                
                int fileLength = conn.getContentLength();
                java.io.InputStream input = new java.io.BufferedInputStream(url.openStream(), 8192);
                
                java.io.File cacheDir = getContext().getCacheDir();
                java.io.File apkFile = new java.io.File(cacheDir, "update.apk");
                if (apkFile.exists()) {
                    apkFile.delete();
                }
                
                java.io.OutputStream output = new java.io.FileOutputStream(apkFile);
                
                byte[] data = new byte[1024];
                long total = 0;
                int count;
                while ((count = input.read(data)) != -1) {
                    total += count;
                    output.write(data, 0, count);
                    
                    if (fileLength > 0) {
                        int progress = (int) (total * 100 / fileLength);
                        JSObject progressObj = new JSObject();
                        progressObj.put("progress", progress);
                        notifyListeners("downloadProgress", progressObj);
                    }
                }
                
                output.flush();
                output.close();
                input.close();
                
                JSObject completeObj = new JSObject();
                completeObj.put("status", "success");
                notifyListeners("downloadComplete", completeObj);
                
                triggerInstall(apkFile);
                call.resolve();
                
            } catch (Exception e) {
                JSObject errObj = new JSObject();
                errObj.put("error", e.getMessage());
                notifyListeners("downloadError", errObj);
                call.reject(e.getMessage());
            }
        }).start();
    }

    private void triggerInstall(java.io.File file) {
        android.content.Context context = getContext();
        android.net.Uri apkUri = androidx.core.content.FileProvider.getUriForFile(
            context,
            context.getPackageName() + ".fileprovider",
            file
        );
        
        android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            if (!context.getPackageManager().canRequestPackageInstalls()) {
                android.content.Intent settingsIntent = new android.content.Intent(
                    android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    android.net.Uri.parse("package:" + context.getPackageName())
                );
                settingsIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(settingsIntent);
            }
        }
        
        context.startActivity(intent);
    }
}
