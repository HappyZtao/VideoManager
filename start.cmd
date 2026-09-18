@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0release\win-unpacked\VideoManager.exe" (
  start "" "%~dp0release\win-unpacked\VideoManager.exe"
  exit /b 0
)
if exist "%~dp0node_modules\electron\dist\electron.exe" (
  start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
  exit /b 0
)
echo Please run the Windows setup package in the release folder.
pause
