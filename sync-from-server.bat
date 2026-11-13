@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

title StarCull Sync From Server

set "PORT=4173"
set "SYNC_SCRIPT=tools\local-sync\sync.js"

rem Built-in defaults (values already used by this repo).
rem Pre-set environment variables win, so the same script can target a test server.
if not defined STARCULL_SYNC_SERVER set "STARCULL_SYNC_SERVER=http://45.64.75.15:4173"
if not defined STARCULL_ADMIN_TOKEN set "STARCULL_ADMIN_TOKEN=starcull-admin-sync-2026"

set "TARGET_DIR=data"
if defined STARCULL_SYNC_DATA_DIR set "TARGET_DIR=%STARCULL_SYNC_DATA_DIR%"

echo ==============================================
echo   StarCull Sync From Server
echo   Pull db.json + uploads from the server
echo ==============================================
echo.

echo [1/5] Working directory
echo       %CD%
echo.

echo [2/5] Checking Node.js and sync script
where node >nul 2>&1
if errorlevel 1 goto :no_node
set "NODE_VERSION=unknown"
for /f "delims=" %%V in ('node -v') do set "NODE_VERSION=%%V"
echo       Node %NODE_VERSION%
if not exist "%SYNC_SCRIPT%" goto :no_sync
echo       Sync script: %SYNC_SCRIPT%
echo.

echo [3/5] Checking local server on port %PORT%
set "PORT_FILE=%TEMP%\starcull_sync_port_%RANDOM%_%RANDOM%.txt"
netstat -ano | findstr /C:":%PORT% " | findstr /C:"LISTENING" > "%PORT_FILE%" 2>nul
set "PORT_PID="
for /f "usebackq tokens=5" %%P in ("%PORT_FILE%") do if not defined PORT_PID set "PORT_PID=%%P"
del "%PORT_FILE%" >nul 2>&1
if not defined PORT_PID goto :port_free

set "PORT_NAME=unknown process"
for /f "tokens=1 delims=," %%N in ('tasklist /FI "PID eq %PORT_PID%" /FO CSV /NH') do set "PORT_NAME=%%~N"
echo       [WARN] Port %PORT% is used by %PORT_NAME% (PID %PORT_PID%).
echo              If that is the local StarCull server, it keeps db.json in memory
echo              and can write stale data back after this sync.
echo              Recommended: stop the local server first, then run this again.
echo              Continuing in 8 seconds (close this window to cancel) ...
ping -n 9 127.0.0.1 >nul
goto :run

:port_free
echo       Port %PORT% is free.
goto :run

:run
echo.
echo [4/5] Pulling from %STARCULL_SYNC_SERVER%
echo       Target data dir: %TARGET_DIR%
echo       data\db.json will be overwritten, previous copy goes to .backups\local-sync\
echo.
node "%SYNC_SCRIPT%"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo [5/5] Result
if not "%EXIT_CODE%"=="0" goto :failed

echo       [OK] Sync finished successfully.
echo            db.json and uploads are up to date in %TARGET_DIR%\
echo            previous db.json backup is in .backups\local-sync\
echo.
pause
exit /b 0

:failed
echo       [FAIL] Sync did not complete (exit code %EXIT_CODE%).
echo              Read the messages above. Common causes:
echo              - 401: admin token rejected by the server
echo              - connection refused / timeout: server offline or wrong address
echo              - image download failed: db.json was NOT overwritten
echo              - disk full / permission denied while writing %TARGET_DIR%\
echo.
pause
exit /b %EXIT_CODE%

:no_node
echo       [ERROR] Node.js was not found in PATH.
echo               Install Node.js 18 or newer, then run this script again.
echo.
pause
exit /b 1

:no_sync
echo       [ERROR] Missing %SYNC_SCRIPT%
echo               Run this script from the project root or restore tools\local-sync\.
echo.
pause
exit /b 1
