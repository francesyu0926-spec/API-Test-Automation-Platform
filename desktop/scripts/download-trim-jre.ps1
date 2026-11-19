<#
.SYNOPSIS
  Download Eclipse Temurin JRE (Windows x64) and trim to a minimal layout for bundling.

.PARAMETER MajorVersion
  17 or 21 (default 17)

.PARAMETER OutputDir
  JRE home (contains bin\java.exe). Default: desktop\runtime-dev\jre

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\download-trim-jre.ps1 -MajorVersion 21
#>
param(
    [ValidateSet(17, 21)]
    [int]$MajorVersion = 17,
    [string]$OutputDir = $env:ATP_EMBED_JRE,
    [switch]$Compact
)
$ErrorActionPreference = "Stop"
$DesktopRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDir) { $OutputDir = Join-Path $DesktopRoot "runtime-dev\jre" }

function Get-FolderSizeMb([string]$Path) {
  if (-not (Test-Path $Path)) { return 0 }
  return [math]::Round(((Get-ChildItem $Path -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum / 1MB), 1)
}

$staging = Join-Path $env:TEMP "atp-jre-$MajorVersion"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

$zipPath = Join-Path $staging "temurin-java.zip"
$kind = if ($Compact) { "jdk" } else { "jre" }
$apiUri = "https://api.adoptium.net/v3/binary/latest/$MajorVersion/ga/windows/x64/$kind/hotspot/normal/eclipse?project=jdk"

Write-Host "Downloading Temurin $kind $MajorVersion (x64) ..."
try {
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -fSL --retry 3 --retry-delay 2 -o $zipPath $apiUri
    if ($LASTEXITCODE -ne 0) { throw "curl exit $LASTEXITCODE" }
  } else {
    Invoke-WebRequest -Uri $apiUri -OutFile $zipPath -UseBasicParsing -MaximumRedirection 5
  }
} catch {
  throw "JRE/JDK download failed (Adoptium API). Check network or proxy. $_"
}

$extractRoot = Join-Path $staging "extract"
New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force

$javaHome = Get-ChildItem -Path $extractRoot -Directory -Recurse |
  Where-Object { Test-Path (Join-Path $_.FullName "bin\java.exe") } |
  Select-Object -First 1
if (-not $javaHome) {
  throw "No bin\java.exe found in downloaded archive."
}

$trimWork = Join-Path $staging "trimmed"
if (Test-Path $trimWork) { Remove-Item -Recurse -Force $trimWork }

if ($Compact) {
  $jlink = Join-Path $javaHome.FullName "bin\jlink.exe"
  if (-not (Test-Path $jlink)) {
    throw "Compact mode needs JDK (jlink.exe). Re-run without -Compact or check download."
  }
  $modules = @(
    "java.base", "java.logging", "java.xml", "java.desktop",
    "java.management", "java.instrument", "java.prefs", "java.naming",
    "java.security.jgss", "jdk.crypto.ec", "jdk.localedata", "jdk.zipfs"
  ) -join ","
  Write-Host "jlink custom runtime (~40-55 MB target) ..."
  & $jlink `
    --add-modules $modules `
    --strip-debug `
    --compress=2 `
    --no-header-files `
    --no-man-pages `
  --output $trimWork
  if ($LASTEXITCODE -ne 0) { throw "jlink failed with exit $LASTEXITCODE" }
} else {
  New-Item -ItemType Directory -Force -Path $trimWork | Out-Null
  & robocopy $javaHome.FullName $trimWork /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying JRE" }

  $removePatterns = @(
    "demo", "sample", "samples", "man", "include",
    "legal\jdk", "lib\jfr", "lib\src.zip"
  )
  foreach ($rel in $removePatterns) {
    $p = Join-Path $trimWork $rel
    if (Test-Path $p) {
      Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  Get-ChildItem -Path $trimWork -Recurse -Filter "src.zip" -File -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item $_.FullName -Force }
}

if (-not (Test-Path (Join-Path $trimWork "bin\java.exe"))) {
  throw "Trimmed JRE missing bin\java.exe"
}

if (Test-Path $OutputDir) { Remove-Item -Recurse -Force $OutputDir }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
& robocopy $trimWork $OutputDir /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed staging JRE" }

$mb = Get-FolderSizeMb $OutputDir
Write-Host "JRE $MajorVersion trimmed -> $OutputDir (~${mb} MB)"
if ($mb -gt 80) {
  Write-Warning "JRE larger than ~40MB target (${mb} MB). Temurin JRE may still be acceptable for POC."
}