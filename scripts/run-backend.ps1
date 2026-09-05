# Helper script to launch Python FastAPI Sidecar Engine
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$localBin = Join-Path $env:USERPROFILE ".local\bin"
if (Test-Path $localBin) {
    $env:Path = "$localBin;$env:Path"
}

$pyExe = if (Test-Path ".\.venv\Scripts\python.exe") {
    ".\.venv\Scripts\python.exe"
} elseif ($env:VIRTUAL_ENV -and (Test-Path "$env:VIRTUAL_ENV\Scripts\python.exe")) {
    "$env:VIRTUAL_ENV\Scripts\python.exe"
} else {
    "python"
}

Write-Host "Starting SecurePhotos Backend Engine on http://127.0.0.1:8000 using $pyExe..." -ForegroundColor Green
& $pyExe -m uvicorn engine.main:app --port 8000 --reload
