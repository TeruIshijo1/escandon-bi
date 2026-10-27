[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [ValidateSet('Estado', 'Verificar', 'Instalar', 'Iniciar', 'Detener', 'Reiniciar', 'Registros', 'Desinstalar')]
    [string]$Accion = 'Estado',
    [switch]$RutasExternasVerificadas
)

$ErrorActionPreference = 'Stop'
$ServiceId = 'EscandonBI'
$InstallRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Wrapper = Join-Path $InstallRoot 'servicio\EscandonBI.exe'
$Configuration = Join-Path $InstallRoot 'servicio\EscandonBI.xml'
$SourceManifest = Join-Path $InstallRoot 'servicio\winsw-source.json'

function Assert-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Ejecuta administrar_servicio.bat como administrador para cambiar el servicio.'
    }
}

function Get-OwnedService {
    $service = Get-CimInstance Win32_Service -Filter "Name='$ServiceId'"
    if ($null -ne $service) {
        $registered = $service.PathName.Trim().Trim('"')
        if (-not [string]::Equals($registered, $Wrapper, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Ya existe un servicio EscandonBI de otra carpeta. No se modifico. Usa su instalacion original.'
        }
    }
    return $service
}

function Assert-PortAvailable {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, 5173)
    $listener.Server.ExclusiveAddressUse = $true
    try { $listener.Start() }
    catch { throw 'El puerto 5173 esta ocupado. Deten la instancia anterior desde su propio lanzador; no se cerrara automaticamente.' }
    finally { $listener.Stop() }
}

function Get-LocalSha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Assert-WrapperIntegrity {
    foreach ($file in @($Wrapper, $Configuration, $SourceManifest)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Faltan archivos del servicio. Copia el pase completo.' }
    }
    $manifest = Get-Content -LiteralPath $SourceManifest -Raw | ConvertFrom-Json
    if ((Get-LocalSha256 $Wrapper) -ne $manifest.sha256 -or
        (Get-LocalSha256 $Configuration) -ne $manifest.configurationSha256) {
        throw 'La huella de WinSW o su configuracion no coincide con la dependencia revisada.'
    }
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($Wrapper)
    if ($version.FileVersion -ne '2.12.0.0') { throw 'La version de WinSW no corresponde a la configuracion revisada.' }
}

function Assert-MachinePython {
    $machinePath = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
    if ($machinePath -match '(?i)\\Users\\|\\WindowsApps(?:\\|;|$)|%USERPROFILE%|%LOCALAPPDATA%|%APPDATA%|%HOMEPATH%|%HOMEDRIVE%') {
        throw 'El PATH del equipo contiene rutas de un perfil o WindowsApps. Corrigelo antes de habilitar el servicio; no se reutilizara el PATH del instalador.'
    }
    $expandedMachinePath = [Environment]::ExpandEnvironmentVariables($machinePath)
    if ($expandedMachinePath -match '(?i)\\Users\\|\\WindowsApps(?:\\|;|$)|%[^%]+%') {
        throw 'El PATH del equipo expandido contiene rutas de perfil o variables sin resolver. Prepara una ruta Python de equipo antes de habilitar el servicio.'
    }
    $python = $null
    foreach ($entry in ($expandedMachinePath -split ';')) {
        if (-not $entry.Trim()) { continue }
        $candidate = Join-Path ([Environment]::ExpandEnvironmentVariables($entry.Trim().Trim('"'))) 'python.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $python = $candidate; break }
    }
    if (-not $python) {
        throw 'ML necesita Python instalado para el equipo y presente en PATH de equipo. Python del perfil del usuario no sirve para LocalService. Prepara Python y sus bibliotecas antes de habilitar el servicio.'
    }
    # Isolated mode cannot pass using libraries installed only in the operator's profile.
    try { & $python -I -c 'import pandas,numpy,sklearn,joblib,psycopg2,sqlalchemy,dotenv' 2>$null | Out-Null; $pythonExit = $LASTEXITCODE }
    catch { $pythonExit = 1 }
    if ($pythonExit -ne 0) { throw 'Faltan bibliotecas Python de equipo para ML. Revisa backend/ml/requirements.txt; no se instalo ningun paquete.' }
    Write-Host 'Python y bibliotecas de equipo encontrados; el acceso efectivo de LocalService se confirma despues de instalar.'
}

function Get-ExternalPaths {
    $envFile = Join-Path $InstallRoot 'backend\.env'
    # Parse exactly as the backend does, but emit only the two file paths.
    $parser = @'
const fs = require('node:fs');
const values = require(process.argv[3]).parse(fs.readFileSync(process.argv[2]));
process.stdout.write(JSON.stringify({ACCOUNT_REOPENING_BACKUP_DIR:values.ACCOUNT_REOPENING_BACKUP_DIR || null,REORDER_EXCEL_PATH:values.REORDER_EXCEL_PATH || null}));
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($parser))
    $parsed = & (Join-Path $InstallRoot '.runtime\node.exe') -e "eval(Buffer.from(process.argv[1],'base64').toString())" $encoded $envFile (Join-Path $InstallRoot 'backend\node_modules\dotenv')
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron leer las dos rutas de configuracion. Revisa las dependencias del backend; no se mostraron credenciales.' }
    $configurationValues = $parsed | ConvertFrom-Json
    foreach ($key in @('ACCOUNT_REOPENING_BACKUP_DIR','REORDER_EXCEL_PATH')) {
        $machineValue = [Environment]::GetEnvironmentVariable($key, 'Machine')
        if ($null -ne $machineValue) { $configurationValues.$key = $machineValue }
    }
    $backup = $configurationValues.ACCOUNT_REOPENING_BACKUP_DIR
    if (-not $backup) { $backup = 'D:\Escritorio\Reaperturas' }
    $candidates = @([pscustomobject]@{ Path = $backup; Access = 'Modificar'; Purpose = 'Respaldo de reaperturas' })
    if ($configurationValues.REORDER_EXCEL_PATH) {
        $candidates += [pscustomobject]@{ Path = $configurationValues.REORDER_EXCEL_PATH; Access = 'Lectura'; Purpose = 'Excel de configuracion de compras' }
    }
    # A backup inside the root can still be outside the six writable folders.
    # Require the same explicit file-access review instead of silently omitting it.
    return @($candidates | ForEach-Object {
        $_.Path = [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($_.Path)) { $_.Path } else { Join-Path (Join-Path $InstallRoot 'backend') $_.Path }))
        $_
    })
}

function Assert-PackageReady {
    foreach ($relative in @('servicio\EscandonBI.exe','servicio\EscandonBI.xml','servicio\winsw-source.json',
        'servicio\LICENSE-WinSW.txt','.runtime\node.exe','backend\scripts\start-server.js','backend\.env','frontend\dist\index.html')) {
        if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot $relative) -PathType Leaf)) { throw "Falta $relative. Conserva .env y copia el pase completo." }
    }
    Assert-WrapperIntegrity
    [xml]$xml = Get-Content -LiteralPath $Configuration -Raw
    if ($xml.service.id -ne $ServiceId -or $xml.service.serviceaccount.user -ne 'LocalService' -or
        $xml.service.serviceaccount.domain -ne 'NT AUTHORITY' -or $xml.service.arguments -notmatch '--service\s*$' -or
        $xml.service.executable -ne '%BASE%\..\.runtime\node.exe' -or $xml.service.workingdirectory -ne '%BASE%\..\backend' -or
        @($xml.service.env | Where-Object { $_.name -eq 'PORT' -and $_.value -eq '5173' }).Count -ne 1) {
        throw 'La configuracion del servicio no conserva el runtime, cuenta, puerto y modo de inicio revisados.'
    }
    if ($xml.service.serviceaccount.password) { throw 'La configuracion del servicio no debe guardar contrasenas.' }
    $framework = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -Name Release -ErrorAction SilentlyContinue
    if (-not $framework -or $framework.Release -lt 394254) { throw 'WinSW requiere .NET Framework 4.6.1 o superior. No se instalo ningun componente.' }
    Assert-MachinePython
    & (Join-Path $InstallRoot '.runtime\node.exe') (Join-Path $InstallRoot 'backend\scripts\start-server.js') --check | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'No paso la comprobacion del runtime Node.' }
    $external = @(Get-ExternalPaths)
    if ($external.Count) {
        Write-Host 'Rutas de archivos que el operador debe comprobar para NT SERVICE\EscandonBI:'
        $external | Format-Table Purpose, Access, Path -AutoSize | Out-Host
        & "$env:SystemRoot\System32\sc.exe" showsid $ServiceId | Out-Host
        Write-Host 'No se modifican rutas externas ni se muestran las credenciales de .env.'
    }
    Write-Host 'ML requiere Python y bibliotecas instalados para el equipo y accesibles a LocalService. No se instala Python ni se consultan proveedores.'
    return $external
}

function Assert-InstallationPath([string]$Directory) {
    $prefix = $InstallRoot.TrimEnd('\') + '\'
    if ($Directory -ne $InstallRoot -and -not $Directory.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Ruta mutable fuera de la instalacion.' }
    $ancestor = $Directory
    while ($ancestor.Length -ge $InstallRoot.Length) {
        if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'No se conceden permisos a rutas con enlaces o uniones. Revisa la carpeta de instalacion.'
        }
        if ($ancestor -eq $InstallRoot) { break }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor)
    }
}

function Set-InstallationAccess {
    $directories = @('backend\uploads','backend\data','backend\ml\models','backend\ml\reports','backend\logs\servicio','backend\logs\service-temp') | ForEach-Object { [IO.Path]::GetFullPath((Join-Path $InstallRoot $_)) }
    Assert-InstallationPath $InstallRoot
    foreach ($directory in $directories) { Assert-InstallationPath $directory }
    & "$env:SystemRoot\System32\sc.exe" sidtype $ServiceId unrestricted | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo habilitar el identificador propio del servicio.' }
    $account = New-Object Security.Principal.NTAccount('NT SERVICE', $ServiceId)
    $sid = $account.Translate([Security.Principal.SecurityIdentifier]).Value
    & "$env:SystemRoot\System32\icacls.exe" $InstallRoot /grant "*$($sid):(OI)(CI)(RX)" | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar los permisos de lectura de la instalacion.' }
    foreach ($directory in $directories) {
        [void](New-Item -ItemType Directory -Path $directory -Force)
        & "$env:SystemRoot\System32\icacls.exe" $directory /grant "*$($sid):(OI)(CI)(M)" | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar los permisos de una carpeta mutable de la instalacion.' }
    }
}

function Invoke-Wrapper([string]$Command) {
    & $Wrapper $Command
    if ($LASTEXITCODE -ne 0) { throw "WinSW no completo la accion $Command (codigo $LASTEXITCODE). Revisa backend\logs\servicio y el Visor de eventos." }
}

function Wait-ServiceState([string]$Expected) {
    $deadline = (Get-Date).AddSeconds(45)
    do {
        $current = Get-OwnedService
        if ($current -and $current.State -eq $Expected) { return }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    throw "El servicio no alcanzo el estado $Expected en 45 segundos. Revisa los registros; no se cerraron procesos ajenos."
}

try {
    $service = Get-OwnedService
    if ($Accion -eq 'Estado') {
        if ($service) { Write-Host "Servicio $ServiceId : $($service.State)" }
        else { Write-Host 'El servicio todavia no esta instalado.' }
        Write-Host 'Acciones: Verificar, Instalar, Iniciar, Detener, Reiniciar, Registros, Desinstalar.'
        Write-Host 'Ejemplo: administrar_servicio.bat -Accion Verificar'
        exit 0
    }
    if ($Accion -eq 'Registros') {
        $logDirectory = Join-Path $InstallRoot 'backend\logs\servicio'
        $logs = @(Get-ChildItem -LiteralPath $logDirectory -Filter '*.log' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3)
        if (-not $logs.Count) { Write-Host 'Todavia no hay registros del servicio.' }
        foreach ($log in $logs) { Write-Host "--- $($log.Name) ---"; Get-Content -LiteralPath $log.FullName -Encoding UTF8 -Tail 80 | Out-Host }
        exit 0
    }
    $external = @()
    if ($Accion -in @('Verificar','Instalar','Iniciar','Reiniciar')) { $external = @(Assert-PackageReady) }
    if ($Accion -eq 'Verificar') { Write-Host 'Paquete y configuracion comprobados. Esto no acredita SAP, Vertical, ML ni permisos efectivos de la cuenta del servicio.'; exit 0 }
    Assert-Elevated
    Assert-WrapperIntegrity
    if ($Accion -in @('Instalar','Iniciar','Reiniciar') -and $external.Count -and -not $RutasExternasVerificadas) {
        throw 'Antes de habilitar el servicio, comprueba los permisos externos indicados. Despues repite con -RutasExternasVerificadas. No se otorgaron permisos fuera de la instalacion.'
    }
    if ($Accion -eq 'Instalar') {
        if ($service) { throw 'El servicio ya esta instalado en esta carpeta. Usa Iniciar o Estado.' }
        Assert-PortAvailable
        if ($PSCmdlet.ShouldProcess($InstallRoot, 'Instalar servicio EscandonBI sin iniciarlo')) {
            Invoke-Wrapper install
            Set-InstallationAccess
            Write-Host 'Servicio instalado, todavia detenido. Usa Iniciar cuando los permisos y dependencias esten comprobados.'
        }
    }
    elseif ($Accion -eq 'Desinstalar') {
        if (-not $service) { throw 'El servicio no esta instalado.' }
        if ($service.State -ne 'Stopped') { throw 'Deten primero el servicio con la accion Detener.' }
        if ($PSCmdlet.ShouldProcess($ServiceId, 'Desinstalar el registro del servicio; conservar archivos y datos')) { Invoke-Wrapper uninstall }
    }
    elseif ($Accion -eq 'Detener') {
        if (-not $service) { throw 'El servicio no esta instalado.' }
        if ($service.State -eq 'Stopped') { Write-Host 'El servicio ya esta detenido.' }
        elseif ($PSCmdlet.ShouldProcess($ServiceId, 'Detener servicio y su arbol de procesos')) { Invoke-Wrapper stop; Wait-ServiceState Stopped }
    }
    else {
        if (-not $service) { throw 'Instala primero el servicio desde esta carpeta.' }
        if ($Accion -eq 'Reiniciar' -and $service.State -ne 'Stopped' -and $PSCmdlet.ShouldProcess($ServiceId, 'Detener para reiniciar')) {
            Invoke-Wrapper stop; Wait-ServiceState Stopped; $service = Get-OwnedService
        }
        if ($service.State -eq 'Running') { Write-Host 'El servicio ya esta en ejecucion.' }
        elseif ($service.State -ne 'Stopped') { throw 'Espera a que termine la transicion del servicio y consulta Estado.' }
        else {
            Assert-PortAvailable
            if ($PSCmdlet.ShouldProcess($ServiceId, 'Iniciar servicio EscandonBI')) { Invoke-Wrapper start; Wait-ServiceState Running }
        }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
