# Helper script to launch SecurePhotos Frontend Vite Dev Server
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$env:Path = "C:\Users\sumit\.local\nodejs;C:\Users\sumit\.local\bin;$env:Path"
Write-Host "Starting SecurePhotos Frontend UI on http://localhost:1420..." -ForegroundColor Cyan
npm run dev
