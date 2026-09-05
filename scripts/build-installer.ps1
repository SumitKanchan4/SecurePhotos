# Script to compile standalone Windows .exe and .msi setup installers
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

# Dynamic Toolchain Discovery for Multi-PC Compatibility
$candidatePaths = @(
    (Join-Path $env:USERPROFILE ".local\w64devkit\bin"),
    (Join-Path $env:USERPROFILE ".local\nodejs"),
    (Join-Path $env:USERPROFILE ".local\bin"),
    (Join-Path $env:USERPROFILE ".cargo\bin"),
    "C:\Program Files\nodejs"
)
foreach ($dir in $candidatePaths) {
    if (Test-Path $dir) {
        $env:Path = "$dir;$env:Path"
    }
}
$localTarget = Join-Path $env:USERPROFILE ".local\target"
if (Test-Path (Join-Path $env:USERPROFILE ".local")) {
    $env:CARGO_TARGET_DIR = $localTarget
}

Write-Host "Building SecurePhotos Desktop Production Installer..." -ForegroundColor Cyan
npm run tauri build -- --no-bundle-updater
