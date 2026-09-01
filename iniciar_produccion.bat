@echo off
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
node server.js

pause
