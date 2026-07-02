# E:\Anilab\scratch\push_release.ps1

$token = "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"
$owner = "SahilKumar337"
$repo = "Anilab"
$tag = "v1.0.0"
$releaseName = "AniLab Mobile v1.0.0"
$apkPath = "E:\Anilab\native\android\app\build\outputs\apk\release\app-release.apk"

# 1. Ensure tag is created and pushed
Write-Host "Creating git tag $tag..."
git tag $tag
Write-Host "Pushing git tag $tag to origin..."
git push origin $tag

# 2. Create release via GitHub API
Write-Host "Creating release $releaseName on GitHub..."
$headers = @{
    "Authorization" = "token $token"
    "Accept"        = "application/vnd.github+json"
}

$body = @{
    "tag_name" = $tag
    "target_commitish" = "main"
    "name" = $releaseName
    "body" = "AniLab Native Android App Release v1.0.0. Features stale-while-revalidate caching and native landscape HLS player."
    "draft" = $false
    "prerelease" = $false
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/releases" -Method Post -Headers $headers -Body $body -ContentType "application/json"
$releaseId = $response.id
$uploadUrlTemplate = $response.upload_url

Write-Host "Release created successfully. ID: $releaseId"

# 3. Clean up the upload URL template
# The upload_url contains "{?name,label}" template, we replace it
$uploadUrl = $uploadUrlTemplate.Split('{')[0] + "?name=anilab-mobile-v1.0.0.apk"

# 4. Read APK bytes and upload
Write-Host "Uploading APK asset to $uploadUrl..."
$bytes = [System.IO.File]::ReadAllBytes($apkPath)

$uploadHeaders = @{
    "Authorization" = "token $token"
    "Accept"        = "application/vnd.github+json"
}

$uploadResponse = Invoke-RestMethod -Uri $uploadUrl -Method Post -Headers $uploadHeaders -Body $bytes -ContentType "application/vnd.android.package-archive"

Write-Host "Asset uploaded successfully! URL: $($uploadResponse.browser_download_url)"
