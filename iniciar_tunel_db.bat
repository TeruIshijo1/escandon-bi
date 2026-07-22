@echo off
title Hospital Escandon - DB Tunnel Service
echo =======================================================
echo   HOSPITAL ESCANDON - SERVICIO DE CONEXION REMOTA DB
echo =======================================================
echo.
echo [INFO] Descargando dependencias de red (bore-v0.5.1)...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/ekzhang/bore/releases/download/v0.5.1/bore-v0.5.1-x86_64-pc-windows-msvc.zip' -OutFile '%TEMP%\bore.zip'"
powershell -Command "Expand-Archive -Path '%TEMP%\bore.zip' -DestinationPath '%TEMP%\bore' -Force"

echo.
echo [INFO] Inicializando puente TCP hacia el puerto 1433 (SQL Server)...
echo.
echo =======================================================
echo   IMPORTANTE:
echo   Por favor, anote el puerto asignado en el mensaje
echo   inferior (Ej. "listening at bore.pub:XXXXX").
echo   Debera actualizar la variable REMOTE_DB_PORT en
echo   el archivo .env del backend con dicho puerto.
echo =======================================================
echo.

"%TEMP%\bore\bore.exe" local 1433 --to bore.pub

pause
