@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
title Hospital Escandon BI - SERVIDOR
color 0a

echo ===================================================
echo     HOSPITAL ESCANDON BI - SERVIDOR PRODUCCION
echo ===================================================
echo.
echo Backend + Frontend integrado en un solo proceso.
echo Puerto: 5173
echo.

if not exist "%~dp0backend\scripts\start-server.js" (
    echo ERROR: Falta backend\scripts\start-server.js. Copia el pase completo.
    goto :fallo_inicio
)

set "BI_LOG_DIR=%~dp0backend\logs"
if not exist "%BI_LOG_DIR%" mkdir "%BI_LOG_DIR%" 2>nul
if not exist "%BI_LOG_DIR%" (
    echo ERROR: No se pudo crear la carpeta de registros:
    echo "%BI_LOG_DIR%"
    goto :fallo_inicio
)
set "BI_LOG_DAY="
for /f "delims=" %%I in ('powershell.exe -NoProfile -NonInteractive -Command "Get-Date -Format yyyy-MM-dd" 2^>nul') do set "BI_LOG_DAY=%%I"
if not defined BI_LOG_DAY set "BI_LOG_DAY=sin-fecha"
set "BI_LOG_FILE=%BI_LOG_DIR%\produccion-%BI_LOG_DAY%.log"
type nul >>"%BI_LOG_FILE%" 2>nul
if errorlevel 1 (
    echo ERROR: No se puede escribir el registro del servidor:
    echo "%BI_LOG_FILE%"
    goto :fallo_inicio
)
>>"%BI_LOG_FILE%" echo ===== Inicio %date% %time% =====

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\disable-quick-edit.ps1" >>"%BI_LOG_FILE%" 2>&1
if errorlevel 1 echo Aviso: No se pudo verificar QuickEdit. La salida del servidor se conserva en archivo.

set "BI_NODE=node"
if exist "%~dp0.runtime\node.exe" (
    set "BI_NODE=%~dp0.runtime\node.exe"
    set "PATH=%~dp0.runtime;%PATH%"
)
echo Registro de actividad y errores:
echo "%BI_LOG_FILE%"
echo.
echo Mantenga esta ventana abierta. Para detener el servidor, presione Ctrl+C.
echo La actividad se guarda en el registro, aunque seleccione texto en esta ventana.
echo Si el inicio falla, el diagnostico aparecera aqui al terminar.
echo.

cd /d "%~dp0backend"
set "NODE_ENV=production"
set "PORT=5173"
"%BI_NODE%" "scripts\start-server.js" >>"%BI_LOG_FILE%" 2>&1
set "BI_START_EXIT=%errorlevel%"
>>"%BI_LOG_FILE%" echo ===== Fin %date% %time% - codigo %BI_START_EXIT% =====

echo.
echo El proceso de inicio termino con codigo %BI_START_EXIT%.
echo Ultimas lineas del registro:
powershell.exe -NoProfile -NonInteractive -Command "Get-Content -LiteralPath $env:BI_LOG_FILE -Encoding UTF8 -Tail 25"
echo.
echo Registro completo: "%BI_LOG_FILE%"
pause
endlocal & exit /b %BI_START_EXIT%

:fallo_inicio
echo.
echo No se inicio un servidor nuevo. Corrija el error indicado y vuelva a ejecutar este archivo.
pause
endlocal & exit /b 1
