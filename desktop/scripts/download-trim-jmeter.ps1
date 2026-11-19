<#
.SYNOPSIS
  Download Apache JMeter 5.6.x and trim docs for bundled runtime.

.PARAMETER Version
  JMeter version string (default 5.6.3)

.PARAMETER OutputDir
  JMETER_HOME. Default: desktop\runtime-dev\jmeter

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\download-trim-jmeter.ps1
#>
param(
    [string]$Version = "5.6.3",
    [string]$OutputDir = $env:ATP_EMBED_JMETER
)
$ErrorActionPreference = "Stop"
$DesktopRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDir) { $OutputDir = Join-Path $DesktopRoot "runtime-dev\jmeter" }

function Get-FolderSizeMb([string]$Path) {
  if (-not (Test-Path $Path)) { return 0 }
  return [math]::Round(((Get-ChildItem $Path -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum / 1MB), 1)
}

$zipName = "apache-jmeter-$Version.zip"
$urls = @(
  "https://dlcdn.apache.org/jmeter/binaries/$zipName",
  "https://archive.apache.org/dist/jmeter/binaries/$zipName"
)
$minZipBytes = 70MB

function Save-RemoteFile {
  param(
    [string[]]$UriList,
    [string]$Destination,
    [long]$MinSize = 1
  )
  foreach ($u in $UriList) {
    Write-Host "Downloading $u ..."
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
      if (Test-Path $Destination) { Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue }
      & curl.exe -fSL --retry 5 --retry-delay 3 --connect-timeout 30 -o $Destination $u
      if ($LASTEXITCODE -eq 0) {
        $len = (Get-Item -LiteralPath $Destination).Length
        if ($len -ge $MinSize) { return $true }
        Write-Warning "curl saved $len bytes (< $MinSize) from $u"
      }
    }
    try {
      Invoke-WebRequest -Uri $u -OutFile $Destination -UseBasicParsing
      $len = (Get-Item -LiteralPath $Destination).Length
      if ($len -ge $MinSize) { return $true }
      Write-Warning "Incomplete download $len bytes from $u"
    } catch {
      Write-Warning "Failed: $u — $_"
    }
  }
  return $false
}

$staging = Join-Path $env:TEMP "atp-jmeter-$Version-$((Get-Date).ToString('yyyyMMddHHmmss'))"
if (Test-Path $staging) {
  try {
    Remove-Item -Recurse -Force $staging
  } catch {
    Write-Warning "Staging in use; reusing $staging — $_"
  }
}
New-Item -ItemType Directory -Force -Path $staging | Out-Null
$zipPath = Join-Path $staging $zipName

if (-not (Save-RemoteFile -UriList $urls -Destination $zipPath -MinSize $minZipBytes)) {
  throw "JMeter download failed from all mirrors (expected zip >= 70 MB). Check network or proxy."
}

$extractRoot = Join-Path $staging "extract"
New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force

$jmHome = Get-ChildItem -Path $extractRoot -Directory |
  Where-Object { $_.Name -like "apache-jmeter-*" -and (Test-Path (Join-Path $_.FullName "bin\jmeter.bat")) } |
  Select-Object -First 1
if (-not $jmHome) {
  throw "apache-jmeter-* with bin\jmeter.bat not found in archive."
}

$trimDirs = @("docs", "printable_docs", "licenses\bin")
foreach ($d in $trimDirs) {
  $p = Join-Path $jmHome.FullName $d
  if (Test-Path $p) {
    Write-Host "Removing $d ..."
    Remove-Item -LiteralPath $p -Recurse -Force
  }
}
# Optional extras not needed for HTTP/JSON load tests
$extras = Join-Path $jmHome.FullName "extras"
if (Test-Path $extras) {
  Remove-Item -LiteralPath $extras -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path (Join-Path $jmHome.FullName "bin\jmeter.bat"))) {
  throw "Trimmed JMeter missing bin\jmeter.bat"
}

if (Test-Path $OutputDir) { Remove-Item -Recurse -Force $OutputDir }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
& robocopy $jmHome.FullName $OutputDir /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed staging JMeter" }

$mb = Get-FolderSizeMb $OutputDir
Write-Host "JMeter $Version trimmed -> $OutputDir (~${mb} MB)"