@echo off
title Instalador de Dependencias - Hospital Escandon BI
color 0b

echo ===================================================
echo   INSTALANDO DEPENDENCIAS (BACKEND Y FRONTEND)
echo ===================================================
echo.

echo 1/2. Instalando dependencias del Backend...
cd backend
call npm install
cd ..

echo.
echo 2/2. Instalando dependencias del Frontend...
cd frontend
call npm install
cd ..

echo.
echo ===================================================
echo   INSTALACION COMPLETADA CORRECTAMENTE.
echo   Ahora puedes ejecutar 'iniciar.bat'
echo ===================================================
pause
