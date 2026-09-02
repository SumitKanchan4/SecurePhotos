# Script to compile standalone Windows .exe and .msi setup installers
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$env:Path = "C:\Users\sumit\.local\w64devkit\bin;C:\Users\sumit\.local\nodejs;C:\Users\sumit\.local\bin;C:\Users\sumit\.cargo\bin;$env:Path"
$env:CARGO_TARGET_DIR = "C:\Users\sumit\.local\target"

Write-Host "Building SecurePhotos Desktop Production Installer..." -ForegroundColor Cyan
npm run tauri build -- --no-bundle-updater
