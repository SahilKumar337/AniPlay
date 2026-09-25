# AniPlay Production ProGuard / R8 Optimization Rules

# ── App Native Plugins & Service ──────────────────────────────────────────────
-keep class com.aniplay.aniplay.** { *; }
-keepclassmembers class com.aniplay.aniplay.** { *; }

# ── Capacitor Core & Plugin Interfaces ─────────────────────────────────────────
-keep class com.getcapacitor.** { *; }
-keepclassmembers class com.getcapacitor.** { *; }
-keep public class * extends com.getcapacitor.Plugin {
    public *;
}
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public *;
    @com.getcapacitor.annotation.ActivityCallback public *;
    @com.getcapacitor.annotation.PermissionCallback public *;
}

# ── JavaScript Interface & WebView Bridge ──────────────────────────────────────
-keepattributes JavascriptInterface
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# ── FFmpegKit (Muxing & Remuxing Engine) ──────────────────────────────────────
-keep class com.arthenica.ffmpegkit.** { *; }
-keepclassmembers class com.arthenica.ffmpegkit.** { *; }
-dontwarn com.arthenica.ffmpegkit.**

# ── OkHttp & Okio (Parallel Chunk Downloader) ──────────────────────────────────
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }
-keep class okio.** { *; }
-keep interface okio.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# ── AndroidX SplashScreen & Core ───────────────────────────────────────────────
-keep class androidx.core.splashscreen.** { *; }
-dontwarn androidx.core.splashscreen.**
