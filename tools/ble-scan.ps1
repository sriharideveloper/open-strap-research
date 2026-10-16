<#
.SYNOPSIS
  Passive BLE advertisement scan (Windows). Reports nearby devices and flags any
  advertising the standard Bluetooth Heart Rate service (0x180D).

.DESCRIPTION
  Listens only. Does not connect, pair, write, or read any characteristic.
  Uses the Windows Runtime BluetoothLEAdvertisementWatcher via a small C# helper
  compiled with the .NET Framework csc.exe that ships with Windows; no SDK needed.

.PARAMETER Seconds
  Scan duration. Default 20.

.PARAMETER ExtraServicesFile
  Optional JSON object mapping additional service UUIDs (lowercase) to labels,
  e.g. {"0000180f-0000-1000-8000-00805f9b34fb": "Battery"}. Matches are reported
  in extraServiceMatch. A match only means a device advertised that UUID.

.PARAMETER NamePattern
  Optional regex; devices whose advertised name matches are flagged.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File toolsle-scan.ps1 -Seconds 30
#>
param(
  [int]$Seconds = 20,
  [string]$ExtraServicesFile = '',
  [string]$NamePattern = ''
)

$ErrorActionPreference = 'Stop'

$HeartRateService = '0000180d-0000-1000-8000-00805f9b34fb'
$ExtraServices = @{}
if ($ExtraServicesFile) {
  $j = Get-Content -Raw -Path $ExtraServicesFile | ConvertFrom-Json
  foreach ($prop in $j.PSObject.Properties) { $ExtraServices[$prop.Name.ToLower()] = [string]$prop.Value }
}

# Windows PowerShell 5.1 cannot subscribe to Windows Runtime events
# (Register-ObjectEvent fails with INVALID_REGISTRATION), and Add-Type cannot load
# .winmd references. So the watcher is a small C# program compiled with the
# .NET Framework csc.exe, which can reference WinRT metadata at compile time.
$fw  = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$md  = Join-Path $env:WINDIR 'System32\WinMetadata'
$src = Join-Path $PSScriptRoot 'ble-scan\BleScan.cs'
$out = Join-Path $PSScriptRoot 'ble-scan\bin\BleScan.exe'
if (-not (Test-Path $out) -or (Get-Item $src).LastWriteTime -gt (Get-Item $out).LastWriteTime) {
  New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
  $refs = @(
    (Join-Path $fw 'System.Runtime.WindowsRuntime.dll'), (Join-Path $fw 'System.Runtime.dll'),
    (Join-Path $fw 'System.Runtime.InteropServices.WindowsRuntime.dll'),
    (Join-Path $md 'Windows.Devices.winmd'), (Join-Path $md 'Windows.Foundation.winmd')
  ) | ForEach-Object { "/r:$_" }
  & (Join-Path $fw 'csc.exe') /nologo /target:exe /platform:x64 "/out:$out" @refs $src | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "csc.exe failed with exit code $LASTEXITCODE" }
}

$started = Get-Date
$all   = @(& $out $Seconds)
$diag  = @($all | Where-Object { $_ -like '#*' })
$lines = @($all | Where-Object { $_ -notlike '#*' })
if ($LASTEXITCODE -ne 0) { throw "scanner failed: $($diag -join ' ')" }

$devices = @{}
foreach ($line in @($lines)) {
  $f = $line -split "`t"
  if ($f.Count -lt 5) { continue }
  $devices[$f[0]] = [ordered]@{
    address  = $f[0]
    names    = @($f[1] -split ';' | Where-Object { $_ })
    services = @($f[2] -split ';' | Where-Object { $_ })
    rssi     = if ($f[3]) { [int]$f[3] } else { $null }
    count    = [int]$f[4]
  }
}

$result = foreach ($d in $devices.Values) {
  $svc = @($d.services)
  $names = @($d.names)
  $extraHits = @($svc | Where-Object { $ExtraServices.ContainsKey($_) } | ForEach-Object { $ExtraServices[$_] })
  [pscustomobject]@{
    address           = $d.address
    names             = ($names -join ', ')
    advertisements    = $d.count
    rssiMedian        = $d.rssi
    heartRateService  = ($svc -contains $HeartRateService)
    extraServiceMatch = ($extraHits -join ', ')
    nameMatch         = [bool]($NamePattern -and ($names | Where-Object { $_ -match $NamePattern }))
    serviceUuids      = ($svc -join ' ')
  }
}

[pscustomobject]@{
  watcher            = (($diag | ForEach-Object { $_.TrimStart('#') }) -join ' ')
  scannedAt          = $started.ToString('yyyy-MM-ddTHH:mm:sszzz')
  seconds            = $Seconds
  devicesSeen        = @($result).Count
  heartRateAdvertisers = @($result | Where-Object heartRateService).Count
  flaggedDevices     = @($result | Where-Object { $_.extraServiceMatch -or $_.nameMatch }).Count
  devices            = @($result | Sort-Object rssiMedian -Descending)
} | ConvertTo-Json -Depth 4
