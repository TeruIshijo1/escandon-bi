@echo off
echo =======================================================
echo   INICIANDO TUNEL DIRECTO SIN CUENTAS NI TARJETAS
echo =======================================================
echo.
echo Descargando la herramienta ligera 'bore' (100%% gratis y sin registro)...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/ekzhang/bore/releases/download/v0.5.1/bore-v0.5.1-x86_64-pc-windows-msvc.zip' -OutFile '%TEMP%\bore.zip'"
powershell -Command "Expand-Archive -Path '%TEMP%\bore.zip' -DestinationPath '%TEMP%\bore' -Force"

echo.
echo Iniciando el tunel hacia el puerto 1433 (SQL Server)...
echo.
echo =======================================================
echo   Copia la direccion que te saldra abajo que dice:
echo   "listening at bore.pub:XXXXX"
echo =======================================================
echo.

"%TEMP%\bore\bore.exe" local 1433 --to bore.pub

pause
