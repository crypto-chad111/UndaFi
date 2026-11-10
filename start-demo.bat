@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
rem DEMO: uses a made-up signal, not your home. For looking at the dashboard only.
node server.js --demo --port 4781 --open
pause
