@echo off
title Xclusive Platform - Dev Mode
echo ========================================================
echo   Iniciando Xclusive Platform (API + Web + Admin)
echo ========================================================
echo.

set "PATH=%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm;%ProgramFiles%\nodejs;%LOCALAPPDATA%\GitHubDesktop\app-3.6.4\resources\app\git\cmd;%PATH%"

call pnpm dev:all
pause
