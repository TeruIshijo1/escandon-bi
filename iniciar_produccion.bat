@echo off
cd /d "%~dp0"
if exist "%~dp0.runtime\node.exe" set "PATH=%~dp0.runtime;%PATH%"
title Hospital Escandon BI - SERVIDOR
color 0a

echo ===================================================
echo     HOSPITAL ESCANDON BI - SERVIDOR PRODUCCION
echo ===================================================
echo.
echo Backend + Frontend integrado en un solo proceso.
echo Puerto: 5173
echo.

cd /d "%~dp0"
cd backend
set NODE_ENV=production
set PORT=5173
node scripts/start-server.js

pause
