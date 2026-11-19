<#
.SYNOPSIS
  Configure Windows embeddable Python and install dependencies from an offline wheel cache.

.DESCRIPTION
  1. Enables site-packages via python*._pth (calls configure-python-embed.ps1)
  2. Bootstraps pip if missing (get-pip.py)
  3. Downloads wheels to a cache folder OR uses existing cache (--SkipDownload)
  4. pip install --no-index --find-links <cache> into Lib/site-packages

.PARAMETER PythonRoot
  Folder containing python.exe (embeddable root). Default: $env:ATP_EMBED_PYTHON

.PARAMETER WheelsCache
  Local folder for .whl files. Default: $env:ATP_WHEELS_CACHE or desktop\cache\wheels

.PARAMETER SkipDownload
  Only install from cache; fail if cache is empty or missing packages.

.EXAMPLE
  $env:ATP_EMBED_PYTHON = "D:\Document\AI LAB\API-Test-Automation-Platform\desktop\runtime-dev\python"
  powershell -ExecutionPolicy Bypass -File .\scripts\embed-python-offline-wheels.ps1

.EXAMPLE
  .\scripts\embed-python-offline-wheels.ps1 -PythonRoot "D:\embed\python311" -WheelsCache "D:\wheel-cache" -SkipDownload
#>
param(
    [string]$PythonRoot = $env:ATP_EMBED_PYTHON,
    [string]$WheelsCache = $env:ATP_WHEELS_CACHE,
    [switch]$SkipDownload,
    [switch]$DownloadOnly
)
$ErrorActionPreference = "Stop"
$DesktopRoot = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent $DesktopRoot

if (-not $PythonRoot) {
  $guess = Join-Path $DesktopRoot "runtime-dev\python"
  if (Test-Path (Join-Path $guess "python.exe")) { $PythonRoot = $guess }
}
if (-not $PythonRoot -or -not (Test-Path (Join-Path $PythonRoot "python.exe"))) {
  throw "PythonRoot not found. Set -PythonRoot or `$env:ATP_EMBED_PYTHON (embeddable folder with python.exe)."
}
if (-not $WheelsCache) {
  $WheelsCache = Join-Path $DesktopRoot "cache\wheels"
}

$PyExe = Join-Path $PythonRoot "python.exe"
$ReqFiles = @(
  (Join-Path $RepoRoot "requirements.txt"),
  (Join-Path $RepoRoot "requirements-capture.txt"),
  (Join-Path $RepoRoot "requirements-runtime-bundled.txt")
) | Where-Object { Test-Path $_ }

if ($ReqFiles.Count -eq 0) {
  throw "No requirements*.txt found under $RepoRoot"
}

function Invoke-Python([string[]]$PythonArgv) {
  $argText = ($PythonArgv | ForEach-Object {
    if ($_ -match '\s') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' '
  $cmd = "`"$PyExe`" $argText"
  $out = cmd /c "$cmd 2>&1"
  if ($LASTEXITCODE -gt 0) {
    throw "python $($PythonArgv -join ' ') failed (exit $LASTEXITCODE): $out"
  }
  return $out
}

function Test-PipAvailable {
  cmd /c "`"$PyExe`" -m pip --version >nul 2>&1"
  return ($LASTEXITCODE -eq 0)
}

function Ensure-Pip {
  if (Test-PipAvailable) { return }
  $getPip = Join-Path $env:TEMP "atp-get-pip-$([guid]::NewGuid().ToString('n')).py"
  $urls = @(
    "https://bootstrap.pypa.io/get-pip.py"
  )
  $ok = $false
  foreach ($u in $urls) {
    try {
      Write-Host "Bootstrapping pip from $u ..."
      Invoke-WebRequest -Uri $u -OutFile $getPip -UseBasicParsing
      & $PyExe $getPip "--no-warn-script-location" 2>&1 | Write-Host
      $ok = Test-PipAvailable
      if ($ok) { break }
    } catch {
      Write-Warning "get-pip from $u failed: $_"
    }
  }
  if (-not $ok) {
    throw "pip is not available and get-pip bootstrap failed. Check network or copy pip into embed python."
  }
}

function Ensure-WheelCache {
  New-Item -ItemType Directory -Force -Path $WheelsCache | Out-Null
  $existing = @(Get-ChildItem -Path $WheelsCache -Filter "*.whl" -ErrorAction SilentlyContinue)
  if ($SkipDownload -and $existing.Count -eq 0) {
    throw "SkipDownload set but no .whl in $WheelsCache"
  }
  if ($SkipDownload) { return }

  Ensure-Pip
  $bootstrap = @("-m", "pip", "download", "-d", $WheelsCache, "--prefer-binary", "pip", "setuptools", "wheel")
  Invoke-Python $bootstrap | Write-Host
  $dlArgs = @("-m", "pip", "download", "-d", $WheelsCache, "--prefer-binary")
  foreach ($rf in $ReqFiles) {
    $dlArgs += @("-r", $rf)
  }
  Write-Host "Downloading wheels -> $WheelsCache"
  try {
    Invoke-Python $dlArgs | Write-Host
  } catch {
    if ($existing.Count -gt 0) {
      Write-Warning "Download failed; continuing with $($existing.Count) cached wheel(s). Error: $_"
    } else {
      throw "Wheel download failed and cache is empty: $_"
    }
  }
  Ensure-PyperclipWheel
}

function Ensure-PyperclipWheel {
  if (Get-ChildItem -Path $WheelsCache -Filter "pyperclip-*.whl" -ErrorAction SilentlyContinue) {
    return
  }
  Ensure-Pip
  Write-Host "Building pyperclip wheel into cache (mitmproxy has no PyPI wheel for 1.9.x) ..."
  foreach ($ver in @("1.9.0", "1.8.2")) {
    try {
      Invoke-Python @(
        "-m", "pip", "wheel", "pyperclip==$ver", "-w", $WheelsCache, "--no-deps", "--no-build-isolation"
      ) | Write-Host
      if (Get-ChildItem -Path $WheelsCache -Filter "pyperclip-*.whl" -ErrorAction SilentlyContinue) { break }
    } catch {
      Write-Warning "pyperclip==$ver wheel build failed: $_"
    }
  }
  Get-ChildItem -Path $WheelsCache -Filter "pyperclip-*.tar.gz" -ErrorAction SilentlyContinue | Remove-Item -Force
  if (-not (Get-ChildItem -Path $WheelsCache -Filter "pyperclip-*.whl" -ErrorAction SilentlyContinue)) {
    throw "No pyperclip .whl in $WheelsCache; offline mitmproxy install will fail."
  }
}

& "$PSScriptRoot\configure-python-embed.ps1" -PythonRoot $PythonRoot
Ensure-WheelCache

if ($DownloadOnly) {
  Write-Host "DownloadOnly: wheels ready under $WheelsCache"
  exit 0
}

Ensure-Pip
Ensure-PyperclipWheel
$sitePackages = Join-Path $PythonRoot "Lib\site-packages"
New-Item -ItemType Directory -Force -Path $sitePackages | Out-Null

$installArgs = @(
  "-m", "pip", "install",
  "--no-index",
  "--find-links", $WheelsCache,
  "--upgrade",
  "--no-warn-script-location",
  "--no-build-isolation"
)
foreach ($rf in $ReqFiles) {
  $installArgs += @("-r", $rf)
}
Write-Host "Installing offline wheels into $sitePackages ..."
Invoke-Python $installArgs | Write-Host

$ver = (Invoke-Python @("--version") | Out-String).Trim()
$wheelCount = @(Get-ChildItem -Path $WheelsCache -Filter "*.whl").Count
Write-Host "Done. $ver @ $PythonRoot | cache=$wheelCount wheel(s) in $WheelsCache"