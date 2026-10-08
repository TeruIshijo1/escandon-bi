@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0.runtime\node.exe" set "PATH=%~dp0.runtime;%PATH%"
title Preparar actualizacion - Hospital Escandon BI
echo Preparando dependencias. Se conservan la base de datos y la configuracion.
node backend/scripts/start-server.js --check
if errorlevel 1 goto error
set "taskNpmCli="
for /f "delims=" %%N in ('where npm.cmd 2^>nul') do (
  if not defined taskNpmCli if exist "%%~dpNnode_modules\npm\bin\npm-cli.js" set "taskNpmCli=%%~dpNnode_modules\npm\bin\npm-cli.js"
)
if not defined taskNpmCli (
  echo Instala Node.js con npm antes de continuar.
  goto error
)
if not exist "backend\.env" (
  copy /y "backend\.env.example" "backend\.env" >nul
  echo Se creo backend\.env. Configura credenciales y secretos antes de iniciar.
)
cd backend
node "%taskNpmCli%" ci --omit=dev
if errorlevel 1 goto error
cd ..
node scripts/initialize-package-data.cjs
if errorlevel 1 goto error
echo Preparacion completada. Revisa backend\.env y ejecuta iniciar_produccion.bat.
echo Para preparar el esquema nuevo de honorarios: node backend/scripts/migrate-honorarios.js
pause
exit /b 0
:error
echo No se completo la preparacion. Revisa el error mostrado.
pause
exit /b 1
