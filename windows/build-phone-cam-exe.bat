@echo off
set CSC=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
"%CSC%" /nologo /target:winexe /out:"%~dp0PhoneCamLauncher.exe" "%~dp0PhoneCam.cs" "%~dp0Server.cs"
if errorlevel 1 exit /b 1
"%CSC%" /nologo /target:winexe /out:"%~dp0PhoneCamQrLauncher.exe" "%~dp0PhoneCamQr.cs" "%~dp0Server.cs"
if errorlevel 1 exit /b 1
set PHONE_CAM_WINDOWS=%~dp0
powershell -NoProfile -Command "$ErrorActionPreference = 'Stop'; $desk = [Environment]::GetFolderPath('Desktop'); Copy-Item -Force (Join-Path $env:PHONE_CAM_WINDOWS 'PhoneCamLauncher.exe') (Join-Path $desk 'Phone Cam.exe'); $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk 'Phone Cam QR.lnk')); $s.TargetPath = Join-Path $env:PHONE_CAM_WINDOWS 'PhoneCamQrLauncher.exe'; $s.WorkingDirectory = $env:PHONE_CAM_WINDOWS; $s.Hotkey = 'CTRL+ALT+Q'; $s.Description = 'Show the QR that pairs the iPhone camera'; $s.Save()"
if errorlevel 1 exit /b 1
"%CSC%" /nologo /target:winexe /main:PhoneCamStudio /out:"%~dp0PhoneCamStudio.exe" "%~dp0PhoneCamStudio.cs" "%~dp0PhoneCamQr.cs" "%~dp0Server.cs" "%~dp0AppId.cs"
if errorlevel 1 exit /b 1
"%CSC%" /nologo /target:winexe /main:DrawingBoard /win32icon:"%~dp0drawing-board.ico" /r:System.Management.dll /out:"%~dp0DrawingBoard.exe" "%~dp0DrawingBoard.cs" "%~dp0PhoneCamQr.cs" "%~dp0Server.cs" "%~dp0AppId.cs"
if errorlevel 1 exit /b 1
"%~dp0PhoneCamStudio.exe" --install
if errorlevel 1 exit /b 1
"%~dp0DrawingBoard.exe" --install
if errorlevel 1 exit /b 1
echo Built Desktop\Phone Cam.exe, Desktop\Phone Cam QR (Ctrl+Alt+Q), Start menu\Phone Cam Studio and Drawing Board (Start menu + Desktop)
