$ErrorActionPreference = "Stop"

$serviceId = "cms-middle-backend"
$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$wrapper = Join-Path $baseDir "cms-middle-service.exe"
$dataDir = Join-Path $env:ProgramData "CMS-Middle"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script from an Administrator PowerShell session."
}

if (-not (Test-Path -LiteralPath $wrapper)) {
  throw "Missing WinSW wrapper: $wrapper"
}

@("data", "snapshots", "layout", "request_logs", "event_registry", "device_registry", "logs") |
  ForEach-Object {
    New-Item -ItemType Directory -Force -Path (Join-Path $dataDir $_) | Out-Null
  }

& icacls $dataDir /grant "*S-1-5-18:(OI)(CI)M" /T | Out-Null

$existing = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
if (-not $existing) {
  & $wrapper install
}

& $wrapper start
& $wrapper status

Write-Host "CMS Middle Backend service installed."
Write-Host "Health check: http://127.0.0.1:5050/healthcheck"
Write-Host "Runtime data: $dataDir"
