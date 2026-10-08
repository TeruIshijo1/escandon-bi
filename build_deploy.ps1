param()
$ErrorActionPreference = 'Stop'
$taskProjectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$taskDeployDir = Join-Path $taskProjectRoot 'pase_a_produccion'
$taskTempDir = Join-Path $taskProjectRoot 'tmp'
$taskId = [Guid]::NewGuid().ToString('N')
$taskStaging = Join-Path $taskTempDir ('release-package-' + $taskId)
$taskArchive = Join-Path $taskTempDir ('pase-anterior-' + $taskId)
$taskInputSnapshot = Join-Path $taskTempDir ('release-inputs-' + $taskId + '.json')
$taskRuntime = Join-Path $taskProjectRoot '.runtime\node.exe'
if (-not (Test-Path -LiteralPath $taskRuntime)) { throw 'Prepara primero el runtime con scripts\prepare-node-runtime.ps1.' }
if (Test-Path -LiteralPath (Join-Path $taskDeployDir 'backend\.env')) { throw 'El pase contiene un .env privado. Conserva ese archivo fuera del paquete antes de regenerarlo.' }
Write-Host '[1/4] Validando runtime y compilando todo el frontend...'
& $taskRuntime (Join-Path $taskProjectRoot 'backend\scripts\start-server.js') --check
if ($LASTEXITCODE -ne 0) { throw 'Runtime no compatible.' }
New-Item -ItemType Directory -Path $taskTempDir -Force | Out-Null
& $taskRuntime (Join-Path $taskProjectRoot 'scripts\production-package.cjs') inputs $taskInputSnapshot
if ($LASTEXITCODE -ne 0) { throw 'No se pudo registrar el estado del frontend.' }
Push-Location (Join-Path $taskProjectRoot 'frontend')
try {
    & $taskRuntime 'node_modules\vite\bin\vite.js' build
    if ($LASTEXITCODE -ne 0) { throw 'Fallo la compilacion del frontend; se conserva el pase anterior.' }
} finally { Pop-Location }
Write-Host '[2/4] Preparando paquete completo y manifiesto SHA256...'
& $taskRuntime (Join-Path $taskProjectRoot 'scripts\production-package.cjs') build $taskStaging $taskInputSnapshot
if ($LASTEXITCODE -ne 0) { throw 'Fallo la auditoria del paquete; se conserva el pase anterior.' }
# Validate absolute paths before any directory move. Stay in this workspace.
$taskRootPrefix = $taskProjectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
foreach ($taskPath in @($taskDeployDir, $taskStaging, $taskArchive)) {
    $taskResolved = [IO.Path]::GetFullPath($taskPath)
    if (-not $taskResolved.StartsWith($taskRootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Ruta fuera del proyecto.' }
}
if ($taskDeployDir -ne (Join-Path $taskProjectRoot 'pase_a_produccion')) { throw 'Destino de pase no permitido.' }
Write-Host '[3/4] Conservando el pase anterior y actualizando el destino...'
if (Test-Path -LiteralPath $taskDeployDir) { Move-Item -LiteralPath $taskDeployDir -Destination $taskArchive }
try { Move-Item -LiteralPath $taskStaging -Destination $taskDeployDir }
catch {
    if ((Test-Path -LiteralPath $taskArchive) -and -not (Test-Path -LiteralPath $taskDeployDir)) { Move-Item -LiteralPath $taskArchive -Destination $taskDeployDir }
    throw
}
Write-Host '[4/4] Contrastando el pase final con las fuentes actuales...'
& $taskRuntime (Join-Path $taskProjectRoot 'scripts\production-package.cjs') verify $taskDeployDir --source
if ($LASTEXITCODE -ne 0) { throw 'Fallo la verificacion final del pase.' }
Write-Host "Pase listo: $taskDeployDir" -ForegroundColor Green
if (Test-Path -LiteralPath $taskArchive) { Write-Host "Pase anterior conservado: $taskArchive" }
