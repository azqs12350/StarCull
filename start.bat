@echo off
setlocal
cd /d "%~dp0"

title StarCull Server

echo ==============================================
echo   StarCull Start
echo ==============================================

set "NODE_SKIP_PLATFORM_CHECK=1"
set "PORT=4173"

where node >nul 2>&1
if errorlevel 1 (
    echo [FAIL] Node.js not found. Please install Node.js first.
    goto :hold
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [FAIL] npm not found. Please install Node.js with npm first.
    goto :hold
)

echo [OK] Node ready
echo.

echo [PORT] Checking port %PORT% ...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /C:":%PORT% " ^| findstr LISTENING') do (
    echo [PORT] Found PID=%%P, killing...
    taskkill /F /PID %%P >nul 2>&1
    if errorlevel 1 (
        echo [PORT] Failed to kill PID=%%P, continue anyway
    ) else (
        echo [PORT] Killed PID=%%P
    )
)
ping -n 2 127.0.0.1 >nul

echo.
if not exist "node_modules\express" goto :install
if not exist "node_modules\sharp" goto :install
if not exist "node_modules\qiniu" goto :install
echo [OK] dependencies ready
goto :run

:install
echo Installing dependencies, this may take a while...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo [FAIL] npm install failed. Check network and try again.
    goto :hold
)

:run
echo.
echo ==============================================
echo Starting StarCull on http://localhost:%PORT%
echo Press Ctrl+C to stop the server
echo ==============================================
echo.

node server.js
set "CODE=%ERRORLEVEL%"

echo.
if not "%CODE%"=="0" (
    echo [FAIL] Server exited with code %CODE%
) else (
    echo [INFO] Server stopped normally.
)

:hold
echo.
echo Press any key to close this window.
pause >nul
endlocal
exit /b 0
