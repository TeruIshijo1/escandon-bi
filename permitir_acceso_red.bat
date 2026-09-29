@echo off
title Permitir acceso a Hospital Escandon BI desde la red local
color 0b

echo ===================================================
echo   ACCESO A HOSPITAL ESCANDON BI DESDE LA RED LOCAL
echo ===================================================
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Este paso necesita permiso de administrador.
    echo Cierra esta ventana, haz clic derecho sobre este archivo
    echo y elige "Ejecutar como administrador".
    echo.
    pause
    exit /b 1
)

echo Permitiendo el acceso a BI desde los equipos de la red local...
netsh advfirewall firewall delete rule name="Hospital Escandon BI - Acceso local TCP 5173" >nul 2>&1
netsh advfirewall firewall add rule name="Hospital Escandon BI - Acceso local TCP 5173" dir=in action=allow protocol=TCP localport=5173 remoteip=localsubnet profile=any
if errorlevel 1 (
    echo.
    echo No se pudo agregar la regla. Pide ayuda al responsable de la red.
    pause
    exit /b 1
)

echo.
echo Listo. Desde otra computadora usa http://DIRECCION-IP:5173
echo La direccion IP se consulta con el comando ipconfig en este servidor.
echo.
pause
