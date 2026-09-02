# Helper script to launch SecurePhotos Native Desktop App
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$env:Path = "C:\Users\sumit\.local\w64devkit\bin;C:\Users\sumit\.local\nodejs;C:\Users\sumit\.local\bin;C:\Users\sumit\.cargo\bin;$env:Path"

# Point Cargo build artifacts to a space-free target directory
$env:CARGO_TARGET_DIR = "C:\Users\sumit\.local\target"

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
