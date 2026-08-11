@echo off
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
echo  (Presiona Ctrl+C para detener)
echo.

npx concurrently -n "BACKEND,FRONTEND" -c "bgBlue.bold,bgGreen.bold" "cd backend && node server.js" "cd frontend && npx vite --host"

