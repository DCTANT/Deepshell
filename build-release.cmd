@echo off
setlocal
cd /d "%~dp0"
title DeepShell Release Build
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\build-release.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
