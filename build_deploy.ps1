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
Write-Host "[1/7] Preparando directorio de destino..." -ForegroundColor Yellow

if (Test-Path $DeployDir) {
    # Respaldar archivos .env de producción si existen
    $EnvBackup = $null
    if (Test-Path "$DeployDir\backend\.env") {
        $EnvBackup = Get-Content -Path "$DeployDir\backend\.env" -Raw
        Write-Host "  -> .env de produccion respaldado en memoria" -ForegroundColor DarkGray
    }

    # Respaldar bases de datos de producción
    $DbFiles = @()
    if (Test-Path "$DeployDir\database") {
        $DbFiles = Get-ChildItem -Path "$DeployDir\database" -Filter "*.db*" -ErrorAction SilentlyContinue
        if ($DbFiles.Count -gt 0) {
            $DbBackupDir = "$DeployDir\_db_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
            New-Item -ItemType Directory -Path $DbBackupDir -Force | Out-Null
            foreach ($dbf in $DbFiles) {
                Copy-Item -Path $dbf.FullName -Destination $DbBackupDir -Force
            }
            Write-Host "  -> $($DbFiles.Count) archivos de BD respaldados en $DbBackupDir" -ForegroundColor DarkGray
        }
    }

    # Limpiar frontend y backend (NO tocar database ni backups)
    if (Test-Path "$DeployDir\frontend") { Remove-Item -Path "$DeployDir\frontend" -Recurse -Force }
    if (Test-Path "$DeployDir\backend")  { Remove-Item -Path "$DeployDir\backend" -Recurse -Force }

} else {
    New-Item -ItemType Directory -Path $DeployDir | Out-Null
}

New-Item -ItemType Directory -Path "$DeployDir\frontend" -Force | Out-Null
New-Item -ItemType Directory -Path "$DeployDir\backend" -Force | Out-Null

# ──────────────────────────────────────────────────────────
# 2. Compilar Frontend (Vite build)
# ──────────────────────────────────────────────────────────
Write-Host "[2/7] Compilando frontend (Vite production build)..." -ForegroundColor Yellow
Set-Location -Path "$ProjectRoot\frontend"
npm run build
if ($LASTEXITCODE -ne 0) { throw "Error al compilar el frontend" }

Write-Host "  -> Copiando build del frontend..." -ForegroundColor DarkGray
Copy-Item -Path "$ProjectRoot\frontend\dist\*" -Destination "$DeployDir\frontend" -Recurse -Force

# ──────────────────────────────────────────────────────────
# 3. Copiar Backend (filtrado profesional)
# ──────────────────────────────────────────────────────────
Write-Host "[3/7] Copiando backend (excluyendo dev/test/scratch)..." -ForegroundColor Yellow
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
    "uploads"               # Carpeta uploads (se crea en instalación)
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

# ──────────────────────────────────────────────────────────
# 4. Generar .env.example actualizado
# ──────────────────────────────────────────────────────────
Write-Host "[4/7] Generando .env.example..." -ForegroundColor Yellow
$EnvExampleContent = @"
# ===================================================
# Hospital Escandon BI - Variables de Entorno
# ===================================================

# Servidor
PORT=5173
NODE_ENV=production

# SQLite (Base de datos local de la app)
DB_PATH=../database/escandon_bi.db

# SQL Server (KH_HE - Sistema VERTICAL)
SQL_SERVER_HOST=your_sql_server_ip
SQL_SERVER_USER=sa
SQL_SERVER_PASSWORD=your_sql_password
SQL_SERVER_DB=KH_HE

# PostgreSQL (Data Warehouse Local - Cache de dashboards)
PGUSER=postgres
PGHOST=localhost
PGPASSWORD=aqui_pon_la_contraseña_del_usuario_postgres
PGDATABASE=escandon_bi
PGPORT=5432

# SAP B1 Service Layer
SAP_SL_BASE_URL=https://sl.hospesc.com:50000/b1s/v1
SAP_DB_NAME=SBO_HE2
SAP_USER=manager
SAP_PASSWORD=your_sap_password

# Seguridad
JWT_SECRET=your_jwt_secret_min_64_chars
JWT_REFRESH=your_refresh_secret
JWT_EXPIRY=8h
CORS_ORIGIN=http://localhost:8080

# IA / Asistente ARIA
OPENAI_API_KEY=your_openai_key

# PowerBI Embedded (opcional)
PBI_CLIENT_ID=
PBI_CLIENT_SECRET=
PBI_TENANT_ID=
PBI_WORKSPACE_ID=
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

# Restaurar DBs desde backup si las respaldamos
if ($DbFiles.Count -gt 0 -and (Test-Path $DbBackupDir)) {
    Get-ChildItem -Path $DbBackupDir | Copy-Item -Destination "$DeployDir\database" -Force
    Remove-Item -Path $DbBackupDir -Recurse -Force
    Write-Host "  -> Bases de datos de produccion restauradas" -ForegroundColor Green
}

# ──────────────────────────────────────────────────────────
# 5b. Exportar Data Warehouse PostgreSQL (pg_dump)
# ──────────────────────────────────────────────────────────
Write-Host "[6/8] Exportando Data Warehouse PostgreSQL..." -ForegroundColor Yellow
$PgDumpPath = "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"
if (Test-Path $PgDumpPath) {
    $env:PGPASSWORD = "postgres"
    & $PgDumpPath -U postgres -d escandon_bi --no-owner --no-privileges --format=custom --compress=9 -f "$DeployDir\database\escandon_bi_dw.dump" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $dumpSize = [math]::Round((Get-Item "$DeployDir\database\escandon_bi_dw.dump").Length / 1MB, 2)
        Write-Host "  -> Dump PostgreSQL generado: $dumpSize MB" -ForegroundColor Green
    } else {
        Write-Host "  -> [AVISO] No se pudo generar el dump de PostgreSQL" -ForegroundColor Red
    }
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
} else {
    Write-Host "  -> [AVISO] pg_dump no encontrado en $PgDumpPath" -ForegroundColor Red
    Write-Host "  -> El dump de PostgreSQL debera generarse manualmente" -ForegroundColor Red
}

# ──────────────────────────────────────────────────────────
# 7. El instalar.bat ya fue generado/actualizado previamente
#    Solo se regenera si no existe
# ──────────────────────────────────────────────────────────
Write-Host "[7/8] Verificando instalar.bat..." -ForegroundColor Yellow
if (-not (Test-Path "$DeployDir\instalar.bat")) {
    Write-Host "  -> instalar.bat no encontrado, se debe crear manualmente" -ForegroundColor Red
} else {
    Write-Host "  -> instalar.bat OK" -ForegroundColor Green
}

# ──────────────────────────────────────────────────────────
# 8. Verificar iniciar_produccion.bat
# ──────────────────────────────────────────────────────────
Write-Host "[8/8] Verificando iniciar_produccion.bat..." -ForegroundColor Yellow
if (-not (Test-Path "$DeployDir\iniciar_produccion.bat")) {
    Write-Host "  -> iniciar_produccion.bat no encontrado, se debe crear manualmente" -ForegroundColor Red
} else {
    Write-Host "  -> iniciar_produccion.bat OK" -ForegroundColor Green
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
