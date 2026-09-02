# Helper script to launch SecurePhotos 2.0 Native Desktop App
$env:Path = "C:\Users\sumit\.local\nodejs;C:\Users\sumit\.local\bin;C:\Users\sumit\.cargo\bin;$env:Path"

# 1. Clean up any previous orphaned Vite instances on port 1420
$activePort = Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue
if ($activePort) {
    Write-Host "Freeing occupied port 1420..." -ForegroundColor Yellow
    foreach ($conn in $activePort) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
}

Write-Host "Launching SecurePhotos 2.0 Native Desktop Application..." -ForegroundColor Magenta
npm run tauri dev
