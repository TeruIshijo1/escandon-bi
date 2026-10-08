param([ValidateSet('x64', 'arm64')][string]$Architecture = 'x64')

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDirectory = Join-Path $projectRoot '.runtime'
$release = 'v24.21.0'
$baseUri = 'https://nodejs.org/dist/' + $release
$relativeBinary = 'win-' + $Architecture + '/node.exe'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$downloadPath = Join-Path $runtimeDirectory ('node-' + $release + '-' + $Architecture + '.candidate.exe')

try {
    Invoke-WebRequest -Uri ($baseUri + '/' + $relativeBinary) -OutFile $downloadPath -UseBasicParsing
    $checksums = (Invoke-WebRequest -Uri ($baseUri + '/SHASUMS256.txt') -UseBasicParsing).Content
    $entry = @($checksums -split "`n" | Where-Object { $_ -match ('\s+' + [regex]::Escape($relativeBinary) + '\s*$') })
    if ($entry.Count -ne 1) { throw 'No se encontró el checksum oficial del ejecutable.' }
    $expected = ($entry[0] -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw 'El checksum del ejecutable no coincide. Se conservó el runtime anterior.' }
    $version = & $downloadPath --version
    if ($LASTEXITCODE -ne 0 -or $version -ne $release) { throw 'No se pudo validar la versión del runtime.' }
    $portablePath = Join-Path $runtimeDirectory 'node.exe'
    Move-Item -LiteralPath $downloadPath -Destination $portablePath -Force
    Write-Host "Node $version preparado en $portablePath. SHA256 verificado."
} finally {
    if (Test-Path -LiteralPath $downloadPath) { Remove-Item -LiteralPath $downloadPath -Force }
}
