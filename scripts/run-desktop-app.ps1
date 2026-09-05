# Helper script to launch SecurePhotos Native Desktop App
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

# Point Cargo build artifacts to a dedicated target directory
$localTarget = Join-Path $env:USERPROFILE ".local\target"
if (Test-Path (Join-Path $env:USERPROFILE ".local")) {
    $env:CARGO_TARGET_DIR = $localTarget
}

# 1. Clean up any previous running instances of securephotos.exe
Stop-Process -Name "securephotos" -Force -ErrorAction SilentlyContinue

# 2. Clean up any previous orphaned Vite instances on port 1420
$activePort = Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue
if ($activePort) {
    Write-Host "Freeing occupied port 1420..." -ForegroundColor Yellow
    foreach ($conn in $activePort) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
}

Write-Host "Launching SecurePhotos Native Desktop Application..." -ForegroundColor Magenta
npm run tauri dev
