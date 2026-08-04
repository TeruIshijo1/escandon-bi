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

:: Instalar y arrancar todo en la misma ventana con concurrently
echo  Iniciando servicios...
echo  (Presiona Ctrl+C en esta ventana para detener todos los servicios)
echo.

npx concurrently -n "BACKEND,FRONTEND,NGROK" -c "bgBlue.bold,bgGreen.bold,bgMagenta.bold" "cd backend && node server.js" "cd frontend && npx vite --host" "ngrok http 5173 --host-header=localhost --log=stdout --authtoken 3H6A6J7ZzbGOQQIt865EStbmcYj_5T1WE7kvnxNnz74dPgSBg"
