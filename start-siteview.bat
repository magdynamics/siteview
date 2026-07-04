@echo off
REM ── SiteView one-click startup ──────────────────────────────────────────
REM Starts the API server, the public tunnel (permanent address), and the
REM office web dashboard. Run this after any reboot of this machine.

echo Starting SiteView API server (port 5000)...
start "SiteView API" /min cmd /c "cd /d %~dp0backend && node src/server.js"

echo Starting public tunnel (stuffing-acclimate-muster.ngrok-free.dev)...
start "SiteView Tunnel" /min cmd /c "%LOCALAPPDATA%\Microsoft\WinGet\Links\ngrok.exe http 5000 --url=https://stuffing-acclimate-muster.ngrok-free.dev"

echo Starting office web dashboard (port 3000)...
start "SiteView Web" /min cmd /c "cd /d %~dp0web && npm start"

echo.
echo All three started (minimized windows).
echo   Team app server:  https://stuffing-acclimate-muster.ngrok-free.dev
echo   Office dashboard: http://192.168.1.3:3000
echo.
pause
