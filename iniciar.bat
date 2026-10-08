@echo off
cd /d "%~dp0"
if exist "%~dp0.runtime\node.exe" set "PATH=%~dp0.runtime;%PATH%"
title Hospital Escandon BI

echo.
echo  ============================================
echo   Hospital Escandon - Plataforma BI
echo  ============================================
echo.

:: Obtener IP local
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=*" %%b in ("%%a") do set LOCAL_IP=%%b
)

echo  Backend:    http://localhost:4000
echo  Frontend:   http://localhost:5173
if defined LOCAL_IP echo  Red Local:  http://%LOCAL_IP%:5173
echo.

echo  Iniciando Backend y Frontend en 1 solo CMD...
echo  (Ctrl+C detiene los procesos iniciados en esta ventana)
echo.

node backend/scripts/start-server.js --check
if errorlevel 1 (
    pause
    exit /b 1
)
npx concurrently -n "BACKEND,FRONTEND" -c "bgBlue.bold,bgGreen.bold" "cd backend && npm run start" "cd frontend && npx vite --host"

