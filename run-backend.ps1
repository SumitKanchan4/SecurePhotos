# Helper script to launch Python FastAPI Sidecar Engine
$env:Path = "C:\Users\sumit\.local\bin;$env:Path"
Write-Host "Starting SecurePhotos 2.0 Backend Engine on http://127.0.0.1:8000..." -ForegroundColor Green
.venv\Scripts\python.exe -m uvicorn engine.main:app --port 8000 --reload
