@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
title Hospital Escandon BI - Servicio Windows
if not exist "%~dp0scripts\manage-production-service.ps1" (
    echo ERROR: Copia el pase completo; falta el administrador del servicio.
    pause
    endlocal & exit /b 1
)
if "%~1"=="" goto :menu
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\manage-production-service.ps1" %*
set "BI_SERVICE_EXIT=%errorlevel%"
echo.
pause
endlocal & exit /b %BI_SERVICE_EXIT%

:menu
echo.
echo ===================================================
echo     HOSPITAL ESCANDON BI - SERVICIO WINDOWS
echo ===================================================
echo 1. Estado             2. Verificar requisitos
echo 3. Instalar           4. Iniciar
echo 5. Detener            6. Reiniciar
echo 7. Ver registros      8. Desinstalar
echo 9. Salir
echo.
echo Para cambiar el servicio, abra este archivo como administrador.
choice /c 123456789 /n /m "Seleccione una opcion: "
if errorlevel 9 goto :salir
if errorlevel 8 (
    set "BI_SERVICE_ACTION=Desinstalar"
    goto :ejecutar
)
if errorlevel 7 (
    set "BI_SERVICE_ACTION=Registros"
    goto :ejecutar
)
if errorlevel 6 (
    set "BI_SERVICE_ACTION=Reiniciar"
    goto :requisitos
)
if errorlevel 5 (
    set "BI_SERVICE_ACTION=Detener"
    goto :ejecutar
)
if errorlevel 4 (
    set "BI_SERVICE_ACTION=Iniciar"
    goto :requisitos
)
if errorlevel 3 (
    set "BI_SERVICE_ACTION=Instalar"
    goto :requisitos
)
if errorlevel 2 (
    set "BI_SERVICE_ACTION=Verificar"
    goto :ejecutar
)
set "BI_SERVICE_ACTION=Estado"
goto :ejecutar

:requisitos
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\manage-production-service.ps1" -Accion Verificar
if errorlevel 1 goto :volver
echo.
echo Debe haber comprobado el acceso de NT SERVICE\EscandonBI a las rutas externas indicadas.
choice /c SN /n /m "Ya verifico esos permisos para el servicio (S/N)? "
if errorlevel 2 goto :volver
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\manage-production-service.ps1" -Accion "%BI_SERVICE_ACTION%" -RutasExternasVerificadas
goto :volver

:ejecutar
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\manage-production-service.ps1" -Accion "%BI_SERVICE_ACTION%"
:volver
echo.
pause
goto :menu

:salir
endlocal & exit /b 0
