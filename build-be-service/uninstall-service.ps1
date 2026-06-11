$ErrorActionPreference = "Stop"

$serviceId = "cms-middle-backend"
$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$wrapper = Join-Path $baseDir "cms-middle-service.exe"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script from an Administrator PowerShell session."
}

$existing = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Status -ne "Stopped") {
    & $wrapper stop
  }
  & $wrapper uninstall
}

Write-Host "CMS Middle Backend service uninstalled."
Write-Host "Runtime data was preserved at: $env:ProgramData\CMS-Middle"
