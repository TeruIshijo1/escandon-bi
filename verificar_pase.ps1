param([string]$PackagePath = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$taskPackage = [IO.Path]::GetFullPath($PackagePath)
$taskRuntime = Join-Path $taskPackage '.runtime\node.exe'
if (-not (Test-Path -LiteralPath $taskRuntime)) { throw 'Falta el runtime incluido en el pase.' }
& $taskRuntime (Join-Path $taskPackage 'scripts\production-package.cjs') verify $taskPackage
if ($LASTEXITCODE -ne 0) { throw 'El pase no superó la verificación. No lo copies al servidor.' }
Write-Host 'Pase completo: archivos, hashes, dependencias y recursos compilados verificados.' -ForegroundColor Green
