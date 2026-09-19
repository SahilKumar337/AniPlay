package com.aniplay.aniplay;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "APKUpdater")
public class APKUpdaterPlugin extends Plugin {
    @PluginMethod
    public void getAppVersion(PluginCall call) {
        try {
            android.content.pm.PackageInfo pInfo = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject ret = new JSObject();
            ret.put("versionName", pInfo.versionName);
            ret.put("versionCode", pInfo.versionCode);
            ret.put("packageName", getContext().getPackageName());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void checkInstallPermission(PluginCall call) {
        JSObject ret = new JSObject();
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            ret.put("granted", getContext().getPackageManager().canRequestPackageInstalls());
        } else {
            ret.put("granted", true);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void requestInstallPermission(PluginCall call) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                android.content.Intent intent = new android.content.Intent(
                    android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    android.net.Uri.parse("package:" + getContext().getPackageName())
                );
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void openExternalUrl(PluginCall call) {
        String urlString = call.getString("url");
        if (urlString == null || urlString.isEmpty()) {
            call.reject("URL is required");
            return;
        }
        try {
            android.content.Intent intent = new android.content.Intent(
                android.content.Intent.ACTION_VIEW,
                android.net.Uri.parse(urlString)
            );
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void share(PluginCall call) {
        String title = call.getString("title", "Share AniPlay");
        String text = call.getString("text", "");
        String url = call.getString("url", "");
        String dialogTitle = call.getString("dialogTitle", "Share via");

        try {
            // Also copy URL to system clipboard
            if (url != null && !url.isEmpty()) {
                try {
                    android.content.ClipboardManager clipboard = (android.content.ClipboardManager) getContext().getSystemService(android.content.Context.CLIPBOARD_SERVICE);
                    if (clipboard != null) {
                        android.content.ClipData clip = android.content.ClipData.newPlainText("AniPlay Link", url);
                        clipboard.setPrimaryClip(clip);
                    }
                } catch (Exception ignored) {}
            }

            android.content.Intent shareIntent = new android.content.Intent(android.content.Intent.ACTION_SEND);
            shareIntent.setType("text/plain");

            String shareBody = text;
            if (url != null && !url.isEmpty()) {
                if (shareBody != null && !shareBody.isEmpty()) {
                    shareBody = shareBody + "\n\n" + url;
                } else {
                    shareBody = url;
                }
            }

            shareIntent.putExtra(android.content.Intent.EXTRA_SUBJECT, title);
            shareIntent.putExtra(android.content.Intent.EXTRA_TEXT, shareBody);

            android.content.Intent chooser = android.content.Intent.createChooser(shareIntent, dialogTitle);
            chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);

            if (getActivity() != null) {
                getActivity().startActivity(chooser);
            } else {
                getContext().startActivity(chooser);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open share dialog: " + e.getMessage());
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
        
        context.startActivity(intent);
    }
}
