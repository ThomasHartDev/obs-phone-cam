@echo off
title Phone Cam for OBS
cd /d "%~dp0"
if not exist node_modules (
  echo First run - installing, one moment...
  call npm install --omit=dev
)
REM If mkcert is installed, mint a trusted cert once so the phone stops warning.
where mkcert >nul 2>&1
if %errorlevel%==0 if not exist certs\cert.pem (
  echo Setting up a trusted certificate with mkcert...
  mkcert -install
  for /f "delims=" %%i in ('node -e "console.log(require('os').networkInterfaces()&&Object.values(require('os').networkInterfaces()).flat().filter(a=>a.family==='IPv4'&&!a.internal).map(a=>a.address).join(' '))"') do set LANIPS=%%i
  mkcert -key-file certs\key.pem -cert-file certs\cert.pem localhost 127.0.0.1 %LANIPS%
)
echo.
echo  Phone Cam is starting. Your browser will open with the QR code.
echo  Leave this window open while you use it. Close it to stop.
echo.
node server.mjs
pause
