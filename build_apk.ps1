# AniPlay Headless CLI Build Script (Non-AS)
# Builds the production web bundle, syncs with Capacitor, and compiles the signed release APK.

$ErrorActionPreference = "Stop"

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  AniPlay Headless APK Build Pipeline" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# ── 0. Auto-discover Node.js ──────────────────────────────────────────────────
$nodeExe = $null

# Strategy 1: Read real PATH from Windows registry (bypasses IDE shell PATH isolation)
$regPaths = @()
try {
    $machPath = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' -Name 'Path' -ErrorAction SilentlyContinue).Path
    $userPath = (Get-ItemProperty -Path 'HKCU:\Environment' -Name 'Path' -ErrorAction SilentlyContinue).Path
    $allRegPaths = ("$machPath;$userPath" -split ';') | Where-Object { $_ -ne '' } | Select-Object -Unique
    foreach ($p in $allRegPaths) {
        $candidate = Join-Path $p "node.exe"
        if (Test-Path $candidate) {
            $nodeExe = $candidate
            Write-Host "[OK] Found Node via registry PATH: $nodeExe" -ForegroundColor Green
            break
        }
    }
} catch {}

# Strategy 2: Probe well-known install directories
if (-not $nodeExe) {
    $nodeCandidates = @(
        "$env:LOCALAPPDATA\nodejs22",
        "$env:LOCALAPPDATA\nodejs",
        "$env:APPDATA\nvm",
        "$env:LOCALAPPDATA\Volta\bin",
        "$env:USERPROFILE\.volta\bin",
        "$env:LOCALAPPDATA\fnm",
        "$env:USERPROFILE\scoop\apps\nodejs\current",
        "$env:USERPROFILE\scoop\apps\nodejs-lts\current",
        "C:\Program Files\nodejs",
        "C:\nodejs",
        "D:\nodejs",
        "E:\nodejs"
    )
    foreach ($dir in $nodeCandidates) {
        if (Test-Path $dir) {
            $found = Get-ChildItem -Path $dir -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($found) { $nodeExe = $found.FullName; break }
        }
    }
}

# Strategy 3: Fallback to shell PATH
if (-not $nodeExe) {
    $nodeInPath = Get-Command "node.exe" -ErrorAction SilentlyContinue
    if ($nodeInPath) { $nodeExe = $nodeInPath.Source }
}

# Verify Node version is >= 22 (Capacitor requirement)
if ($nodeExe) {
    try {
        $nodeVerRaw = (& $nodeExe -v) -replace '^v',''
        $nodeMajor = [int]($nodeVerRaw.Split('.')[0])
        if ($nodeMajor -lt 22) {
            Write-Host "[WARN] Found Node.js v$nodeVerRaw (< v22). Capacitor CLI requires Node >= 22.0.0." -ForegroundColor Yellow
            $nodeExe = $null
        }
    } catch {
        $nodeExe = $null
    }
}

if (-not $nodeExe) {
    # Strategy 4: Auto-install Node.js 22 LTS via portable zip (no admin required)
    Write-Host "" 
    Write-Host "[INFO] Node.js 22+ not found. Installing Node.js 22 LTS (portable, no admin needed)..." -ForegroundColor Yellow

    $NodeVersion    = "22.23.3"
    $NodeZip        = "node-v$NodeVersion-win-x64.zip"
    $NodeUrl        = "https://nodejs.org/dist/v$NodeVersion/$NodeZip"
    $NodeInstallDir = "$env:LOCALAPPDATA\nodejs22"
    $TempZip        = "$env:TEMP\$NodeZip"
    $ExtractDir     = "$env:TEMP\node_extract"

    try {
        # Download using curl if available (fastest and most reliable)
        Write-Host "[INFO] Downloading Node.js $NodeVersion portable zip (~35MB)..." -ForegroundColor Yellow
        if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
            curl.exe -fL -o $TempZip $NodeUrl
        } else {
            $wc = New-Object System.Net.WebClient
            $wc.DownloadFile($NodeUrl, $TempZip)
        }
        Write-Host "[OK] Download complete." -ForegroundColor Green

        # Extract
        Write-Host "[INFO] Extracting to $NodeInstallDir ..." -ForegroundColor Yellow
        if (Test-Path $ExtractDir) { Remove-Item $ExtractDir -Recurse -Force }
        Expand-Archive -LiteralPath $TempZip -DestinationPath $ExtractDir -Force

        # Move the versioned subfolder to the install dir
        $extracted = Get-ChildItem $ExtractDir -Directory | Select-Object -First 1
        if (Test-Path $NodeInstallDir) { Remove-Item $NodeInstallDir -Recurse -Force }
        Move-Item $extracted.FullName $NodeInstallDir

        # Cleanup
        Remove-Item $TempZip  -Force -ErrorAction SilentlyContinue
        Remove-Item $ExtractDir -Recurse -Force -ErrorAction SilentlyContinue

        $nodeExe = Join-Path $NodeInstallDir "node.exe"
        Write-Host "[OK] Node.js 22 LTS installed (portable) at: $NodeInstallDir" -ForegroundColor Green

    } catch {
        Write-Host "[FAIL] Node.js auto-install failed: $_" -ForegroundColor Red
        Write-Host "       Please install Node.js 22+ from https://nodejs.org then re-run." -ForegroundColor Red
        exit 1
    }
}


if (-not $nodeExe -or -not (Test-Path $nodeExe)) {
    Write-Host "[FAIL] Node.js still not found after install attempt. Please install manually from https://nodejs.org" -ForegroundColor Red
    exit 1
}

$nodeBinDir = Split-Path -Parent $nodeExe
$env:PATH = "$nodeBinDir;" + $env:PATH
Write-Host "[OK] Node.js: $nodeExe" -ForegroundColor Green

$nodeVersion = & $nodeExe --version 2>&1
Write-Host "[OK] Node version: $nodeVersion" -ForegroundColor Green

# ── 1. Environment Setup ──────────────────────────────────────────────────────
$JavaHome   = "E:\Android Studio\jbr"
# Primary SDK path (moved to Windows.old after OS reinstall)
$AndroidSdk = "C:\Windows.old\Users\sahil\AppData\Local\Android\Sdk"
# Fallback to current user location if it ever gets moved
if (-not (Test-Path $AndroidSdk)) {
    $AndroidSdk = "C:\Users\sahil\AppData\Local\Android\Sdk"
}

if (Test-Path "$JavaHome\bin\java.exe") {
    $env:JAVA_HOME = $JavaHome
    $env:PATH = "$JavaHome\bin;" + $env:PATH
    Write-Host "[OK] JAVA_HOME: $JavaHome" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Java not found at: $JavaHome" -ForegroundColor Red
    exit 1
}

if (Test-Path $AndroidSdk) {
    $env:ANDROID_HOME = $AndroidSdk
    $env:PATH = "$AndroidSdk\platform-tools;" + $env:PATH
    Write-Host "[OK] ANDROID_HOME: $AndroidSdk" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Android SDK not found at: $AndroidSdk" -ForegroundColor Red
    exit 1
}

$RootPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootPath

# Resolve npm/npx paths
$npmCmd = Join-Path $nodeBinDir "npm.cmd"
if (-not (Test-Path $npmCmd)) { $npmCmd = Join-Path $nodeBinDir "npm" }
$npxCmd = Join-Path $nodeBinDir "npx.cmd"
if (-not (Test-Path $npxCmd)) { $npxCmd = Join-Path $nodeBinDir "npx" }
Write-Host "[OK] npm: $npmCmd" -ForegroundColor Green
Write-Host "[OK] npx: $npxCmd" -ForegroundColor Green

# ── 2. Build Production Web Application ──────────────────────────────────────
Write-Host ""
Write-Host "[1/4] Building production web bundle..." -ForegroundColor Yellow
& $npmCmd run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Web build failed." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Web bundle built." -ForegroundColor Green

# ── 3. Synchronize with Capacitor Android ─────────────────────────────────────
Write-Host ""
Write-Host "[2/4] Syncing assets with Capacitor Android..." -ForegroundColor Yellow
& $npxCmd cap sync android
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Capacitor sync failed." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Capacitor sync complete." -ForegroundColor Green

# ── 4. Compile Release APK via Gradle ────────────────────────────────────────
Write-Host ""
Write-Host "[3/4] Compiling signed release APK via Gradle CLI..." -ForegroundColor Yellow
Set-Location "$RootPath\android"

cmd.exe /c "gradlew.bat assembleRelease"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Gradle build failed." -ForegroundColor Red
    exit 1
}

Set-Location $RootPath

# ── 5. Verify & Copy Artifacts ───────────────────────────────────────────────
Write-Host ""
Write-Host "[4/4] Verifying and organizing APK artifacts..." -ForegroundColor Yellow
$GeneratedApk = "$RootPath\android\app\build\outputs\apk\release\app-release.apk"

if (Test-Path $GeneratedApk) {
    $ApkFolder = "$RootPath\APKs"
    if (!(Test-Path $ApkFolder)) {
        New-Item -ItemType Directory -Path $ApkFolder | Out-Null
    }

    $PkgVersion = "1.6.1"
    try {
        $PkgJson = Get-Content "$RootPath\package.json" -Raw | ConvertFrom-Json
        if ($PkgJson.version) { $PkgVersion = $PkgJson.version }
    } catch {}

    $TargetNamedApk       = "$ApkFolder\AniPlay-v$PkgVersion-release.apk"
    $TargetRootApk        = "$RootPath\AniPlay.apk"
    $TargetRootReleaseApk = "$RootPath\app-release.apk"

    Copy-Item $GeneratedApk -Destination $TargetNamedApk -Force
    Copy-Item $GeneratedApk -Destination $TargetRootApk -Force
    Copy-Item $GeneratedApk -Destination $TargetRootReleaseApk -Force

    $Item   = Get-Item $TargetNamedApk
    $SizeMB = [math]::Round($Item.Length / 1MB, 2)
    $Hash   = (Get-FileHash $TargetNamedApk -Algorithm SHA256).Hash

    Write-Host ""
    Write-Host "=================================================" -ForegroundColor Green
    Write-Host "  BUILD SUCCESSFUL!" -ForegroundColor Green
    Write-Host "=================================================" -ForegroundColor Green
    Write-Host "  Artifact 1 : $TargetNamedApk" -ForegroundColor White
    Write-Host "  Artifact 2 : $TargetRootApk" -ForegroundColor White
    Write-Host "  Size       : $SizeMB MB ($($Item.Length) bytes)" -ForegroundColor White
    Write-Host "  SHA256     : $Hash" -ForegroundColor White
    Write-Host "  Mode       : Ad-Free" -ForegroundColor White
    Write-Host "=================================================" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "[FAIL] Could not find compiled APK at: $GeneratedApk" -ForegroundColor Red
    exit 1
}
