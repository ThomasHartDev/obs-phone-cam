@echo off
set CSC=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
"%CSC%" /nologo /target:winexe /out:"%~dp0PhoneCamLauncher.exe" "%~dp0PhoneCam.cs"
if errorlevel 1 exit /b 1
copy /Y "%~dp0PhoneCamLauncher.exe" "%USERPROFILE%\Desktop\Phone Cam.exe" >nul
echo Built and copied to Desktop\Phone Cam.exe
