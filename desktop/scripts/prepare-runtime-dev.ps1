<#
.SYNOPSIS
  One-click: build desktop\runtime-dev\{python,jre,jmeter} for local full-edition dev.

.DESCRIPTION
  Downloads embed Python, Temurin JRE, Apache JMeter (if missing or -ForceDownload),
  injects offline wheels, writes runtime-manifest.json.

.PARAMETER SkipDownload
  Use existing runtime-dev trees; only refresh wheels/manifest.

.PARAMETER ForceDownload
  Re-download Python, JRE, JMeter even if present.

.PARAMETER JreMajor
  17 or 21

.EXAMPLE
  cd desktop
  npm run runtime:prepare-dev

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\prepare-runtime-dev.ps1 -JreMajor 21
#>
param(
    [switch]$SkipDownload,
    [switch]$ForceDownload,
    [switch]$CompactJre,
    [ValidateSet(17, 21)]
    [int]$JreMajor = 17,
    [string]$PythonVersion = "3.11.9",
    [string]$JmeterVersion = "5.6.3"
)
$ErrorActionPreference = "Stop"
$DesktopRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDev = Join-Path $DesktopRoot "runtime-dev"
$PyDir = Join-Path $RuntimeDev "python"
$JreDir = Join-Path $RuntimeDev "jre"
$JmDir = Join-Path $RuntimeDev "jmeter"

New-Item -ItemType Directory -Force -Path $RuntimeDev | Out-Null

function Need-Fetch([string]$Path, [string]$Marker) {
  if ($ForceDownload) { return $true }
  if (-not (Test-Path (Join-Path $Path $Marker))) { return $true }
  return $false
}

if (-not $SkipDownload) {
  if (Need-Fetch $PyDir "python.exe") {
    & "$PSScriptRoot\download-embed-python.ps1" -Version $PythonVersion -OutputDir $PyDir
  } else {
    Write-Host "Reusing $PyDir"
  }
  if (Need-Fetch $JreDir "bin\java.exe") {
    $jreArgs = @{ MajorVersion = $JreMajor; OutputDir = $JreDir }
    if ($CompactJre) { $jreArgs.Compact = $true }
    & "$PSScriptRoot\download-trim-jre.ps1" @jreArgs
  } else {
    Write-Host "Reusing $JreDir"
  }
  if (Need-Fetch $JmDir "bin\jmeter.bat") {
    & "$PSScriptRoot\download-trim-jmeter.ps1" -Version $JmeterVersion -OutputDir $JmDir
  } else {
    Write-Host "Reusing $JmDir"
  }
}

$env:ATP_EMBED_PYTHON = $PyDir
& "$PSScriptRoot\embed-python-offline-wheels.ps1" -PythonRoot $PyDir

$pyVer = ""
$javaVer = ""
try { $pyVer = (& (Join-Path $PyDir "python.exe") --version 2>&1 | Out-String).Trim() } catch { }
try { $javaVer = (& (Join-Path $JreDir "bin\java.exe") -version 2>&1 | Out-String).Split("`n")[0].Trim() } catch { }

$hasPy = Test-Path (Join-Path $PyDir "python.exe")
$hasJre = Test-Path (Join-Path $JreDir "bin\java.exe")
$hasJm = Test-Path (Join-Path $JmDir "bin\jmeter.bat")

$manifest = @{
  edition  = if ($hasPy -and $hasJre -and $hasJm) { "full" } else { "partial" }
  stagedAt = (Get-Date).ToUniversalTime().ToString("o")
  python   = if ($hasPy) { @{ version = $pyVer; path = "python/python.exe" } } else { $null }
  jre      = if ($hasJre) { @{ version = $javaVer; home = "jre" } } else { $null }
  jmeter   = if ($hasJm) { @{ version = $JmeterVersion; home = "jmeter" } } else { $null }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $RuntimeDev "runtime-manifest.json") -Encoding UTF8

Write-Host @"

runtime-dev ready: $RuntimeDev
  python: $(if ($hasPy) { $pyVer } else { 'MISSING' })
  jre:    $(if ($hasJre) { $javaVer } else { 'MISSING' })
  jmeter: $(if ($hasJm) { "OK $JmeterVersion" } else { 'MISSING' })

Next: cd desktop && npm run dev
Pack full edition:
  `$env:ATP_EMBED_PYTHON = '$PyDir'
  `$env:ATP_EMBED_JRE     = '$JreDir'
  `$env:ATP_EMBED_JMETER  = '$JmDir'
  npm run pack:win:full
"@