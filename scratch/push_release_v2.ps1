# E:\Anilab\scratch\push_release_v2.ps1

$token = "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"
$owner = "SahilKumar337"
$repo = "Anilab"
$tag = "v1.0.0"
$releaseName = "AniLab Mobile v1.0.0"
$apkPath = "E:\Anilab\native\android\app\build\outputs\apk\release\app-release.apk"

$headers = @{
    "Authorization" = "token $token"
    "Accept"        = "application/vnd.github+json"
}

# 1. Get the existing release if it exists
Write-Host "Checking for existing release for $tag..."
try {
    $existingRelease = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/releases/tags/$tag" -Method Get -Headers $headers
    if ($existingRelease) {
        $releaseId = $existingRelease.id
        Write-Host "Found existing release ID: $releaseId. Deleting it..."
        Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/releases/$releaseId" -Method Delete -Headers $headers
        Write-Host "Release deleted."
    }
} catch {
    Write-Host "No existing release found or search failed."
}

# 2. Delete remote tag
Write-Host "Deleting remote tag $tag..."
git push --delete origin $tag 2>&1

# 3. Delete local tag
Write-Host "Deleting local tag $tag..."
git tag -d $tag 2>&1

# 4. Create and push tag again
Write-Host "Creating git tag $tag..."
git tag $tag
Write-Host "Pushing git tag $tag to origin..."
git push origin $tag

# 5. Create new release via GitHub API
Write-Host "Creating fresh release $releaseName on GitHub..."
$body = @{
    "tag_name" = $tag
    "target_commitish" = "main"
    "name" = $releaseName
    "body" = "AniLab Native Android App Release v1.0.0. Fixed startup crash by correcting Gesture Handler initialization and migrating navigation to native-stack."
    "draft" = $false
    "prerelease" = $false
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/releases" -Method Post -Headers $headers -Body $body -ContentType "application/json"
$releaseId = $response.id
$uploadUrlTemplate = $response.upload_url

Write-Host "Release created successfully. ID: $releaseId"

# 6. Upload APK asset
$uploadUrl = $uploadUrlTemplate.Split('{')[0] + "?name=anilab-mobile-v1.0.0.apk"
Write-Host "Uploading APK asset to $uploadUrl..."
$bytes = [System.IO.File]::ReadAllBytes($apkPath)

$uploadResponse = Invoke-RestMethod -Uri $uploadUrl -Method Post -Headers $headers -Body $bytes -ContentType "application/vnd.android.package-archive"

Write-Host "Asset uploaded successfully! URL: $($uploadResponse.browser_download_url)"
