$ErrorActionPreference = "Stop"

$ProjectRoot = "D:\Escritorio\escandon-bi"
$DeployDir = "$ProjectRoot\pase_a_produccion"

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  EMPAQUETADO PARA PRODUCCION - Hospital Escandon BI"   -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"            -ForegroundColor DarkGray
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# ──────────────────────────────────────────────────────────
# 1. Respaldo y limpieza selectiva (preservar DBs de producción)
# ──────────────────────────────────────────────────────────
Write-Host "[1/8] Preparando directorio de destino..." -ForegroundColor Yellow

if (Test-Path $DeployDir) {
    # Respaldar archivo .env de producción si existe
    $EnvBackup = $null
    if (Test-Path "$DeployDir\backend\.env") {
        $EnvBackup = Get-Content -Path "$DeployDir\backend\.env" -Raw
        Write-Host "  -> .env de produccion respaldado en memoria" -ForegroundColor DarkGray
    }

    # Limpiar carpetas compiladas (frontend, backend y database)
    if (Test-Path "$DeployDir\frontend") { Remove-Item -Path "$DeployDir\frontend" -Recurse -Force }
    if (Test-Path "$DeployDir\backend")  { Remove-Item -Path "$DeployDir\backend" -Recurse -Force }
    if (Test-Path "$DeployDir\database") { Remove-Item -Path "$DeployDir\database" -Recurse -Force }
    if (Test-Path "$DeployDir\docs")     { Remove-Item -Path "$DeployDir\docs" -Recurse -Force }

} else {
    New-Item -ItemType Directory -Path $DeployDir | Out-Null
}

New-Item -ItemType Directory -Path "$DeployDir\frontend" -Force | Out-Null
New-Item -ItemType Directory -Path "$DeployDir\frontend\dist" -Force | Out-Null
New-Item -ItemType Directory -Path "$DeployDir\backend" -Force | Out-Null

# ──────────────────────────────────────────────────────────
# 2. Compilar Frontend (Vite build)
# ──────────────────────────────────────────────────────────
Write-Host "[2/8] Compilando frontend (Vite production build)..." -ForegroundColor Yellow
Set-Location -Path "$ProjectRoot\frontend"
npm run build
if ($LASTEXITCODE -ne 0) { throw "Error al compilar el frontend" }

Write-Host "  -> Copiando build del frontend..." -ForegroundColor DarkGray
Copy-Item -Path "$ProjectRoot\frontend\dist\*" -Destination "$DeployDir\frontend\dist" -Recurse -Force

# ──────────────────────────────────────────────────────────
# 3. Copiar Backend (filtrado profesional)
# ──────────────────────────────────────────────────────────
Write-Host "[3/8] Copiando backend (excluyendo dev/test/scratch)..." -ForegroundColor Yellow
Set-Location -Path "$ProjectRoot\backend"

# Patrones de exclusión para archivos y carpetas de desarrollo
$ExcludePatterns = @(
    "node_modules",
    ".env",
    "scratch",              # Carpeta scratch/
    "scratch_*.js",         # Scripts scratch_ sueltos
    "test_*.js",            # Scripts de test
    "test.xlsx",
    "test_*.xlsx",
    "check_*.js",
    "search_*.js",
    "query_*.js",
    "query_*.cjs",
    "update_*.cjs",
    "sync_almacen.js",      # Script de utilidad local
    "*.log",                # Logs de runtime
    "*.sqlite",             # DBs sueltas
    "analisis_*.md",        # Docs de análisis temporal
    "database.sqlite",
    "__pycache__",          # Caché de Python (se regenera)
    "*.pyc",
    "uploads",              # Carpeta uploads (se crea en instalación)
    "tests",                # Suite de tests (solo desarrollo)
    "coverage",             # Reportes de cobertura
    "jest.config.js",       # Config de tests
    "eslint.config.js",      # Config de lint
    "0",                     # Archivo huérfano sin nombre (stray)
    ".env.example"          # Se genera en el paso 4
)

Get-ChildItem -Path "$ProjectRoot\backend" | Where-Object { 
    $item = $_
    $exclude = $false
    foreach ($pattern in $ExcludePatterns) {
        if ($item.Name -like $pattern) {
            $exclude = $true
            break
        }
    }
    return -not $exclude
} | Copy-Item -Destination "$DeployDir\backend" -Recurse -Force

# Crear carpeta uploads vacía (necesaria para runtime)
New-Item -ItemType Directory -Path "$DeployDir\backend\uploads" -Force | Out-Null

# Limpiar cachés de Python anidadas (__pycache__ / *.pyc) dentro del backend copiado
Get-ChildItem -Path "$DeployDir\backend" -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path "$DeployDir\backend" -Recurse -File -Filter "*.pyc" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

# ──────────────────────────────────────────────────────────
# 4. Generar .env.example actualizado
# ──────────────────────────────────────────────────────────
Write-Host "[4/8] Generando .env.example..." -ForegroundColor Yellow
$EnvExampleContent = @"
# ===================================================
# Hospital Escandon BI - Variables de Entorno (Producción)
# ===================================================

# Servidor (En producción el puerto por defecto es 5173 para Backend + Frontend integrado)
PORT=5173
NODE_ENV=production

# PostgreSQL (Base de datos principal y Data Warehouse)
PGUSER=postgres
PGHOST=localhost
PGPASSWORD=aqui_pon_la_contrasena_del_usuario_postgres
PGDATABASE=escandon_bi
PGPORT=5432

# SQL Server Remoto (VERTICAL / KH_HE via Tailscale VPN)
REMOTE_DB_USER=
REMOTE_DB_PASS=
REMOTE_DB_SERVER=100.121.115.8
REMOTE_DB_NAME=KH_HE
REMOTE_DB_PORT=1433

# API SITI (sistema legado)
SITI_API_URL=http://192.168.254.21:9000
SITI_USER=
SITI_PASS=

# SAP B1 Service Layer (sincronizacion de inventario)
SAP_BASE_URL=https://sl.hospesc.com:50000/b1s/v2
SAP_COMPANY_DB=SBO_HE2
SAP_USERNAME=manager
SAP_PASSWORD=
SAP_REJECT_UNAUTHORIZED=true

# Seguridad
JWT_SECRET=your_jwt_secret_min_64_chars
JWT_REFRESH=your_refresh_secret
JWT_EXPIRY=8h
# CORS_ORIGIN: Puedes especificar origenes separados por coma o dejar vacio para permitir Intranet y Tailscale
CORS_ORIGIN=http://localhost:5173

# IA / Asistente ARIA (al menos una API key)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-chat
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
LLM_BASE_URL=
# AZURE_OPENAI_ENDPOINT=https://TU-RECURSO.openai.azure.com/openai/deployments/gpt-4o

# Administrador inicial (solo se usa en db:init)
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_NAME=Administrador Inicial
SEED_ADMIN_EMAIL=admin@example.invalid
SEED_ADMIN_PASSWORD=
"@
Set-Content -Path "$DeployDir\backend\.env.example" -Value $EnvExampleContent

# Restaurar .env de producción si existía
if ($EnvBackup) {
    Set-Content -Path "$DeployDir\backend\.env" -Value $EnvBackup
    Write-Host "  -> .env de produccion restaurado" -ForegroundColor Green
}

# ──────────────────────────────────────────────────────────
# 5. Copiar scripts de Base de Datos (solo SQL y migraciones JS)
# ──────────────────────────────────────────────────────────
Write-Host "[5/8] Copiando scripts de base de datos..." -ForegroundColor Yellow

if (-not (Test-Path "$DeployDir\database")) {
    New-Item -ItemType Directory -Path "$DeployDir\database" -Force | Out-Null
}

# Copiar solo archivos .sql y .js de migraciones (NO copiar .db)
Get-ChildItem -Path "$ProjectRoot\database" -File | Where-Object {
    $_.Extension -in @(".sql", ".js")
} | Copy-Item -Destination "$DeployDir\database" -Force

# ──────────────────────────────────────────────────────────
# 6. Exportar Data Warehouse PostgreSQL (pg_dump)
# ──────────────────────────────────────────────────────────
Write-Host "[6/8] Exportando Data Warehouse PostgreSQL..." -ForegroundColor Yellow

# Detección dinámica de pg_dump
$PgDumpPath = $null
$cmd = Get-Command pg_dump -ErrorAction SilentlyContinue
if ($cmd) {
    $PgDumpPath = $cmd.Source
} else {
    $pgDirs = Get-ChildItem -Path "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue | Sort-Object { 
        $v = 0
        if ([int]::TryParse($_.Name, [ref]$v)) { $v } else { 0 }
    } -Descending
    foreach ($dir in $pgDirs) {
        $testPath = Join-Path $dir.FullName "bin\pg_dump.exe"
        if (Test-Path $testPath) {
            $PgDumpPath = $testPath
            break
        }
    }
}

if ($PgDumpPath -and (Test-Path $PgDumpPath)) {
    Write-Host "  -> Utilizando pg_dump: $PgDumpPath" -ForegroundColor DarkGray
    $env:PGPASSWORD = "postgres"
    & $PgDumpPath -U postgres -d escandon_bi --no-owner --no-privileges --format=custom --compress=9 -f "$DeployDir\database\escandon_bi_dw.dump" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0 -and (Test-Path "$DeployDir\database\escandon_bi_dw.dump")) {
        $dumpSize = [math]::Round((Get-Item "$DeployDir\database\escandon_bi_dw.dump").Length / 1MB, 2)
        Write-Host "  -> Dump PostgreSQL generado: $dumpSize MB" -ForegroundColor Green
    } else {
        Write-Host "  -> [AVISO] No se pudo generar el dump de PostgreSQL con pg_dump" -ForegroundColor Red
    }
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
} else {
    Write-Host "  -> [AVISO] pg_dump no encontrado en PATH ni en C:\Program Files\PostgreSQL" -ForegroundColor Red
    Write-Host "  -> El dump de PostgreSQL debera generarse manualmente si no existe" -ForegroundColor Red
}

# ──────────────────────────────────────────────────────────
# 7. Generar / Sincronizar scripts de arranque e instalación
# ──────────────────────────────────────────────────────────
Write-Host "[7/8] Sincronizando scripts de ejecucion (.bat)..." -ForegroundColor Yellow

# Copiar iniciar_produccion.bat
if (Test-Path "$ProjectRoot\iniciar_produccion.bat") {
    Copy-Item -Path "$ProjectRoot\iniciar_produccion.bat" -Destination "$DeployDir\iniciar_produccion.bat" -Force
    Write-Host "  -> iniciar_produccion.bat sincronizado OK" -ForegroundColor Green
}

# Generar instalar.bat de producción
$InstalarBatContent = @'
@echo off
title Instalador - Hospital Escandon BI
color 0b

echo ===================================================
echo     INSTALADOR DEL SERVIDOR (PRODUCCION)
echo ===================================================
echo.

cd /d "%~dp0"
cd backend

echo [1/4] Instalando dependencias de Node.js...
call npm install --omit=dev
if %errorlevel% neq 0 (
    echo [ERROR] Fallo la instalacion de dependencias de Node.js.
    pause
    exit /b 1
)
echo.

echo [2/4] Configurando Variables de Entorno...
if not exist ".env" (
    echo Creando archivo .env a partir de .env.example...
    copy .env.example .env
    echo.
    echo [ATENCION] Se ha creado el archivo .env.
    echo.
    echo POR FAVOR, EDITA EL ARCHIVO backend\.env Y LLENA LAS CONTRASENAS DE:
    echo   - PostgreSQL (PGPASSWORD)
    echo   - SQL Server / Tailscale (REMOTE_DB_PASS)
    echo   - SAP Service Layer (SAP_PASSWORD)
    echo   - JWT_SECRET
    echo.
    pause
) else (
    echo El archivo .env ya existe. No se sobreescribira.
)

echo.
echo [3/4] Creando carpetas de almacenamiento...
if not exist "uploads" mkdir uploads
if not exist "uploads\pbix" mkdir uploads\pbix
if not exist "uploads\excel" mkdir uploads\excel
if not exist "uploads\thumbnails" mkdir uploads\thumbnails

cd ..

echo.
echo [4/4] Restaurando Data Warehouse PostgreSQL...
echo.
echo Se restaurara la base de datos PostgreSQL con datos historicos
echo del Data Warehouse.
echo.
echo PREREQUISITO: PostgreSQL debe estar instalado y la BD creada:
echo   psql -U postgres -c "CREATE DATABASE escandon_bi;"
echo.

set /p RESTORE_PG="Deseas restaurar el Data Warehouse ahora? (S/N): "
if /i "%RESTORE_PG%"=="S" (
    echo.
    echo Ingresa la contrasena del usuario postgres de PostgreSQL:
    set /p PGPASSWORD="Contrasena: "
    echo.

    :: Localizar binario pg_restore
    set PG_RESTORE_BIN=pg_restore
    where pg_restore >nul 2>&1
    if %errorlevel% neq 0 (
        for /d %%D in ("C:\Program Files\PostgreSQL\*") do (
            if exist "%%D\bin\pg_restore.exe" (
                set "PG_RESTORE_BIN=%%D\bin\pg_restore.exe"
            )
        )
    )

    echo Restaurando base de datos con: %PG_RESTORE_BIN% ...
    "%PG_RESTORE_BIN%" -U postgres -d escandon_bi --no-owner --no-privileges --clean --if-exists "database\escandon_bi_dw.dump" 2>nul
    if %errorlevel%==0 (
        echo [OK] Data Warehouse restaurado exitosamente.
    ) else (
        echo [AVISO] Se restauro con advertencias o notas (comportamiento normal en primera instalacion).
        echo Las tablas faltantes se auto-migraran al iniciar el servidor.
    )
) else (
    echo.
    echo Se omitio la restauracion del Data Warehouse.
    echo Las tablas se crearan automaticamente al iniciar y se sincronizaran
    echo desde SQL Server y SAP Service Layer.
)

echo.
echo ===================================================
echo INSTALACION COMPLETADA EXITOSAMENTE.
echo Para iniciar la aplicacion, ejecuta: iniciar_produccion.bat
echo ===================================================
pause
'@
Set-Content -Path "$DeployDir\instalar.bat" -Value $InstalarBatContent -Encoding ASCII
Write-Host "  -> instalar.bat generado OK" -ForegroundColor Green

# ──────────────────────────────────────────────────────────
# 8. Copiar Documentación y Guías
# ──────────────────────────────────────────────────────────
Write-Host "[8/8] Copiando documentacion y manuales..." -ForegroundColor Yellow

$DocsToCopy = @(
    "README.md",
    "README_PRODUCCION.md",
    "GUIA_CONEXION_PRODUCCION_TAILSCALE.md"
)

foreach ($doc in $DocsToCopy) {
    if (Test-Path "$ProjectRoot\$doc") {
        Copy-Item -Path "$ProjectRoot\$doc" -Destination "$DeployDir\$doc" -Force
        Write-Host "  -> $doc copiado" -ForegroundColor DarkGray
    }
}

if (Test-Path "$ProjectRoot\docs") {
    Copy-Item -Path "$ProjectRoot\docs" -Destination "$DeployDir\docs" -Recurse -Force
    Write-Host "  -> Carpeta docs/ copiada" -ForegroundColor DarkGray
}

# ──────────────────────────────────────────────────────────
# Resumen final
# ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  EMPAQUETADO COMPLETADO CON EXITO" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  Directorio: $DeployDir" -ForegroundColor White
Write-Host ""

# Mostrar resumen de archivos copiados
$backendFiles = (Get-ChildItem -Path "$DeployDir\backend" -Recurse -File).Count
$frontendFiles = (Get-ChildItem -Path "$DeployDir\frontend" -Recurse -File).Count
$dbFiles = (Get-ChildItem -Path "$DeployDir\database" -Recurse -File).Count
Write-Host "  Backend:  $backendFiles archivos" -ForegroundColor DarkGray
Write-Host "  Frontend: $frontendFiles archivos" -ForegroundColor DarkGray
Write-Host "  Database: $dbFiles archivos" -ForegroundColor DarkGray
Write-Host ""

Set-Location -Path $ProjectRoot

