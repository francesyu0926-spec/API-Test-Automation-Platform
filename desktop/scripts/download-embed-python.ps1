<#
.SYNOPSIS
  Download and extract official Windows embeddable Python (amd64).

.PARAMETER Version
  Python release, default 3.11.9

.PARAMETER OutputDir
  Target folder (will contain python.exe). Default: desktop\runtime-dev\python or $env:ATP_EMBED_PYTHON

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\download-embed-python.ps1
#>
param(
    [string]$Version = $env:ATP_PYTHON_VERSION,
    [string]$OutputDir = $env:ATP_EMBED_PYTHON
)
$ErrorActionPreference = "Stop"
$DesktopRoot = Split-Path -Parent $PSScriptRoot
if (-not $Version) { $Version = "3.11.9" }
if (-not $OutputDir) { $OutputDir = Join-Path $DesktopRoot "runtime-dev\python" }

$verNoDot = $Version -replace '\.', ''
$zipName = "python-$Version-embed-amd64.zip"
$base = "https://www.python.org/ftp/python/$Version"
$uri = "$base/$zipName"

$staging = Join-Path $env:TEMP "atp-python-embed-$verNoDot"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

Write-Host "Downloading $uri"
try {
  Invoke-WebRequest -Uri $uri -OutFile (Join-Path $staging $zipName) -UseBasicParsing
} catch {
  throw "Failed to download embeddable Python $Version from python.org: $_"
}

if (Test-Path $OutputDir) {
  Remove-Item -Recurse -Force $OutputDir
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Expand-Archive -Path (Join-Path $staging $zipName) -DestinationPath $OutputDir -Force

if (-not (Test-Path (Join-Path $OutputDir "python.exe"))) {
  throw "Extracted but python.exe missing in $OutputDir"
}

$sizeMb = [math]::Round(((Get-ChildItem $OutputDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB), 1)
Write-Host "Embeddable Python $Version -> $OutputDir (~${sizeMb} MB)"