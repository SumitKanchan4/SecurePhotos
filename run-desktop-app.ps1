# Helper script to launch SecurePhotos 2.0 Native Desktop App
$env:Path = "C:\Users\sumit\.local\nodejs;C:\Users\sumit\.local\bin;C:\Users\sumit\.cargo\bin;$env:Path"
Write-Host "Launching SecurePhotos 2.0 Native Desktop Application..." -ForegroundColor Magenta
npm run tauri dev
