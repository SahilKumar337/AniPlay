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
