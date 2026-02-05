@echo off
setlocal

if /i not "%~1"=="-minimized" (
  start "" /min "%~f0" -minimized
  exit /b
)

cd /d "%~dp0config"

where node >nul 2>nul
if not "%errorlevel%"=="0" (
  echo ERROR: Node.js is required to run PilkOS.
  echo Install Node.js, then re-run this script.
  exit /b 1
)

echo Installing dependencies...
call npm install
if not "%errorlevel%"=="0" exit /b %errorlevel%

echo Starting PilkOS...
call npm start
if not "%errorlevel%"=="0" exit /b %errorlevel%
exit
