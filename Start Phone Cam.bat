@echo off
title Phone Cam for OBS
cd /d "%~dp0"
if not exist node_modules (
  echo First run - installing, one moment...
  call npm install --omit=dev
)
echo.
echo  Phone Cam is starting. Your browser will open with the QR code.
echo  Leave this window open while you use it. Close it to stop.
echo.
node server.mjs
pause
