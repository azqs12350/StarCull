@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

title StarCull Server

set "PORT=4173"
set "NODE_SKIP_PLATFORM_CHECK=1"

echo ==============================================
echo   StarCull Server
echo ==============================================
echo.

echo [1/5] Working directory
echo       %CD%
echo.

echo [2/5] Checking Node.js and npm
where node >nul 2>&1
if errorlevel 1 goto :no_node
where npm >nul 2>&1
if errorlevel 1 goto :no_npm

set "NODE_VERSION=unknown"
set "NPM_VERSION=unknown"
for /f "delims=" %%V in ('node -v') do set "NODE_VERSION=%%V"
for /f "delims=" %%V in ('npm -v') do set "NPM_VERSION=%%V"
echo       Node %NODE_VERSION% / npm %NPM_VERSION%
echo.

echo [3/5] Checking dependencies
set "NEED_INSTALL="
if not exist "node_modules\express" set "NEED_INSTALL=1"
if not exist "node_modules\multer" set "NEED_INSTALL=1"
if not exist "node_modules\qiniu" set "NEED_INSTALL=1"
if not exist "node_modules\sharp" set "NEED_INSTALL=1"
if defined NEED_INSTALL goto :install
echo       Dependencies ready.
goto :check_port

:install
echo       Missing dependencies detected. Running npm install ...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto :install_failed
echo.
echo       Dependencies installed.
goto :check_port

:check_port
echo.
echo [4/5] Checking port %PORT%
set "PORT_FILE=%TEMP%\starcull_port_%RANDOM%_%RANDOM%.txt"
netstat -ano | findstr /C:":%PORT% " | findstr /C:"LISTENING" > "%PORT_FILE%" 2>nul
set "PORT_USED="
for /f "usebackq tokens=5" %%P in ("%PORT_FILE%") do set "PORT_USED=1"

if not defined PORT_USED goto :port_free

for /f "usebackq tokens=5" %%P in ("%PORT_FILE%") do (
    if not defined PORT_USED goto :port_free_loop
    call :stop_pid %%P
    set "PORT_USED="
)
:port_free_loop
del "%PORT_FILE%" >nul 2>&1
ping -n 2 127.0.0.1 >nul
goto :run

:port_free
echo       Port %PORT% is free.
del "%PORT_FILE%" >nul 2>&1
goto :run

:stop_pid
set "TARGET_PID=%~1"
if "%TARGET_PID%"=="" goto :eof
set "TARGET_NAME=unknown process"
for /f "tokens=1 delims=," %%N in ('tasklist /FI "PID eq %TARGET_PID%" /FO CSV /NH') do set "TARGET_NAME=%%~N"
echo       Port %PORT% is in use by %TARGET_NAME% (PID %TARGET_PID%). Stopping it ...
taskkill /F /PID %TARGET_PID% >nul 2>&1
if errorlevel 1 (
    echo       [WARN] Could not stop PID %TARGET_PID%. Please close it manually.
) else (
    echo       Stopped PID %TARGET_PID%.
)
goto :eof

:run
echo.
echo [5/5] Starting StarCull on http://localhost:%PORT%
echo       Press Ctrl+C to stop the server.
echo       Keep this window open while the server is running.
echo.
node server.js
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
    echo [ERROR] Server exited with code %EXIT_CODE%.
    echo         Read the messages above for details. Common causes:
    echo         - port %PORT% is still occupied by another process
    echo         - data\db.json is locked or contains invalid JSON
    echo         - native dependency missing, run: npm install
) else (
    echo [INFO] Server stopped normally.
)
echo.
echo Tip: closing this window stops the server.
echo Tip: for 24/7 hosting, run this script through NSSM or Task Scheduler.
echo.
pause
exit /b %EXIT_CODE%

:no_node
echo       [ERROR] Node.js was not found in PATH.
echo               Install Node.js 18 or newer, then run this script again.
echo.
pause
exit /b 1

:no_npm
echo       [ERROR] npm was not found in PATH.
echo               Reinstall Node.js with npm included, then run this script again.
echo.
pause
exit /b 1

:install_failed
echo.
echo       [ERROR] npm install failed.
echo               Check the network connection and the messages above.
echo.
pause
exit /b 1
