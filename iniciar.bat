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

:: Iniciar Backend
start "HE-BI Backend" cmd /k "cd /d "%~dp0backend" && node server.js"

:: Esperar al backend
ping 127.0.0.1 -n 4 > nul

:: Iniciar Frontend con acceso por IP
start "HE-BI Frontend" cmd /k "cd /d "%~dp0frontend" && npx vite --host"

echo  Servidores iniciados.
echo.
