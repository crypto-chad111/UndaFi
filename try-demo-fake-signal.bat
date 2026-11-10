@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
rem DEMO ONLY: a made-up signal with made-up movement. It does NOT watch your home.
echo.
echo  DEMO ONLY - made-up signal. This does NOT watch your home.
echo  For the real thing, close this window and double-click start.bat
echo.
node server.js --demo --port 4781 --open
pause
