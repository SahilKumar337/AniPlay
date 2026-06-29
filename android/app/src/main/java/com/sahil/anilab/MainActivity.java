package com.sahil.anilab;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Enable hardware acceleration for smooth video rendering
        getWindow().setFlags(
            android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );
    }

    @Override
    public void onStart() {
        super.onStart();

        // Configure WebView for inline HLS video playback
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            // Allow JS to call video.play() without a user gesture
            settings.setMediaPlaybackRequiresUserGesture(false);
            // Allow cross-origin requests from the local Capacitor server
            settings.setAllowUniversalAccessFromFileURLs(true);
            settings.setAllowFileAccessFromFileURLs(true);
            // Force hardware rendering for the WebView layer
            webView.setLayerType(WebView.LAYER_TYPE_HARDWARE, null);
        }
    }
}

