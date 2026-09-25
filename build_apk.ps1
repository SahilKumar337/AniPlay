# AniPlay Headless CLI Build Script (Non-AS)
# Builds the production web bundle, syncs with Capacitor, and compiles the signed release APK.

$ErrorActionPreference = "Stop"

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  AniPlay Headless APK Build Pipeline" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# 1. Environment Setup
$JavaHome = "E:\Android Studio\jbr"
$AndroidSdk = "C:\Users\sahil\AppData\Local\Android\Sdk"

if (Test-Path "$JavaHome\bin\java.exe") {
    $env:JAVA_HOME = $JavaHome
    $env:PATH = "$JavaHome\bin;" + $env:PATH
    Write-Host "[✓] JAVA_HOME set to: $JavaHome" -ForegroundColor Green
} else {
    Write-Error "[✗] Java runtime not found at: $JavaHome"
    exit 1
}

if (Test-Path $AndroidSdk) {
    $env:ANDROID_HOME = $AndroidSdk
    Write-Host "[✓] ANDROID_HOME set to: $AndroidSdk" -ForegroundColor Green
} else {
    Write-Error "[✗] Android SDK not found at: $AndroidSdk"
    exit 1
}

$RootPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootPath

# 2. Build Production Web Application
Write-Host "`n[1/4] Building production web bundle..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "[✗] Web build failed."
    exit 1
}

# 3. Synchronize with Capacitor Android
Write-Host "`n[2/4] Syncing assets with Capacitor Android..." -ForegroundColor Yellow
npx cap sync android
if ($LASTEXITCODE -ne 0) {
    Write-Error "[✗] Capacitor sync failed."
    exit 1
}

# 4. Compile Release APK via Gradle
Write-Host "`n[3/4] Compiling signed release APK via Gradle CLI..." -ForegroundColor Yellow
Set-Location "$RootPath\android"

cmd.exe /c "gradlew.bat assembleRelease"
if ($LASTEXITCODE -ne 0) {
    Write-Error "[✗] Gradle build failed."
    exit 1
}

Set-Location $RootPath

# 5. Verify & Copy Artifacts
Write-Host "`n[4/4] Verifying and organizing APK artifacts..." -ForegroundColor Yellow
$GeneratedApk = "$RootPath\android\app\build\outputs\apk\release\app-release.apk"

if (Test-Path $GeneratedApk) {
    $ApkFolder = "$RootPath\APKs"
    if (!(Test-Path $ApkFolder)) {
        New-Item -ItemType Directory -Path $ApkFolder | Out-Null
    }

    $TargetNamedApk = "$ApkFolder\AniPlay-v1.6.0-release.apk"
    $TargetRootApk = "$RootPath\AniPlay.apk"
    $TargetRootReleaseApk = "$RootPath\app-release.apk"

    Copy-Item $GeneratedApk -Destination $TargetNamedApk -Force
    Copy-Item $GeneratedApk -Destination $TargetRootApk -Force
    Copy-Item $GeneratedApk -Destination $TargetRootReleaseApk -Force

    $Item = Get-Item $TargetNamedApk
    $SizeMB = [math]::Round($Item.Length / 1MB, 2)
    $Hash = (Get-FileHash $TargetNamedApk -Algorithm SHA256).Hash

    Write-Host "`n=================================================" -ForegroundColor Green
    Write-Host "  BUILD SUCCESSFUL!" -ForegroundColor Green
    Write-Host "=================================================" -ForegroundColor Green
    Write-Host "  Artifact 1 : $TargetNamedApk" -ForegroundColor White
    Write-Host "  Artifact 2 : $TargetRootApk" -ForegroundColor White
    Write-Host "  Size       : $SizeMB MB ($($Item.Length) bytes)" -ForegroundColor White
    Write-Host "  SHA256     : $Hash" -ForegroundColor White
    Write-Host "  Mode       : Ad-Free (Ready for remote git switch)" -ForegroundColor White
    Write-Host "=================================================`n" -ForegroundColor Green
} else {
    Write-Error "[✗] Could not find compiled APK at: $GeneratedApk"
    exit 1
}
