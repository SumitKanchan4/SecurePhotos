@echo off
setlocal enabledelayedexpansion

REM ── 1. Dynamically discover Node.js / NPM directory ──
where npm >nul 2>&1
if errorlevel 1 (
    for %%D in (
        "%USERPROFILE%\.local\nodejs"
        "C:\Program Files\nodejs"
        "%ProgramFiles%\nodejs"
        "%LOCALAPPDATA%\Programs\nodejs"
        "%NVM_SYMLINK%"
    ) do (
        if exist "%%~D\npm.cmd" (
            set "PATH=%%~D;!PATH!"
            goto :node_found
        )
    )
)
:node_found

REM ── 2. Dynamically add Rust / Cargo & Tooling if present ──
if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;!PATH!"
if exist "%USERPROFILE%\.local\bin\uv.exe" set "PATH=%USERPROFILE%\.local\bin;!PATH!"
if exist "%USERPROFILE%\.local\w64devkit\bin\gcc.exe" set "PATH=%USERPROFILE%\.local\w64devkit\bin;!PATH!"

REM ── 3. Dynamically discover Python Interpreter ──
set "PY_EXE="
if exist "%~dp0.venv\Scripts\python.exe" (
    set "PY_EXE=%~dp0.venv\Scripts\python.exe"
) else if defined VIRTUAL_ENV (
    if exist "%VIRTUAL_ENV%\Scripts\python.exe" set "PY_EXE=%VIRTUAL_ENV%\Scripts\python.exe"
) else (
    where py >nul 2>&1
    if not errorlevel 1 (
        set "PY_EXE=py -3"
    ) else (
        where python >nul 2>&1
        if not errorlevel 1 set "PY_EXE=python"
    )
)

if not defined PY_EXE (
    echo [ERROR] No Python interpreter found! Please install Python or initialize .venv.
    exit /b 1
)

REM ── 4. Launch Release Script ──
"%PY_EXE%" "%~dp0scripts\create_release.py" %*
