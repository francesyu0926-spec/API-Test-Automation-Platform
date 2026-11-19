# Stage embedded Python + JMeter for electron-builder "Full" edition (POC).
# Set before run:
#   $env:ATP_EMBED_PYTHON = "C:\path\to\python-embed"   # folder with python.exe
#   $env:ATP_EMBED_JRE     = "C:\path\to\jre-17"              # folder with bin\java.exe
#   $env:ATP_EMBED_JMETER  = "C:\path\to\apache-jmeter-5.6.3"
$ErrorActionPreference = "Stop"
$DesktopRoot = Split-Path -Parent $PSScriptRoot
$Staging = Join-Path $DesktopRoot "pack-staging\runtime"
$PyDst = Join-Path $Staging "python"
$JreDst = Join-Path $Staging "jre"
$JmDst = Join-Path $Staging "jmeter"

if (Test-Path $Staging) {
    Remove-Item -Recurse -Force $Staging
}
New-Item -ItemType Directory -Force -Path $Staging | Out-Null

function Copy-Tree($From, $To) {
    if (-not (Test-Path $From)) { return $false }
    New-Item -ItemType Directory -Force -Path $To | Out-Null
    & robocopy $From $To /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed $LASTEXITCODE : $From -> $To" }
    return $true
}

$pySrc = $env:ATP_EMBED_PYTHON
if (-not $pySrc) {
    $repoRoot = Split-Path -Parent $DesktopRoot
    $guess = @(
        (Join-Path $repoRoot ".venv"),
        "C:\Python311",
        "$env:LOCALAPPDATA\Programs\Python\Python311"
    )
    foreach ($g in $guess) {
        if (Test-Path (Join-Path $g "python.exe")) { $pySrc = $g; break }
        if (Test-Path (Join-Path $g "Scripts\python.exe")) {
            Write-Warning "ATP_EMBED_PYTHON should be embeddable root, not venv Scripts. Trying parent..."
        }
    }
}

$jmSrc = $env:ATP_EMBED_JMETER
if (-not $jmSrc) {
    if ($env:JMETER_HOME -and (Test-Path (Join-Path $env:JMETER_HOME "bin\jmeter.bat"))) {
        $jmSrc = $env:JMETER_HOME
    }
}

$jreSrc = $env:ATP_EMBED_JRE
if (-not $jreSrc) {
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
        $jreSrc = $env:JAVA_HOME
    }
}

$hasPy = $false
$hasJre = $false
$hasJm = $false
if ($pySrc -and (Test-Path (Join-Path $pySrc "python.exe"))) {
    $hasPy = Copy-Tree $pySrc $PyDst
} else {
    Write-Warning "未设置 ATP_EMBED_PYTHON 或未找到 python.exe；完整版将不含内置 Python。"
}
if ($jreSrc -and (Test-Path (Join-Path $jreSrc "bin\java.exe"))) {
    $hasJre = Copy-Tree $jreSrc $JreDst
} else {
    Write-Warning "未设置 ATP_EMBED_JRE；JMeter 将依赖客户本机 Java。"
}
if ($jmSrc -and (Test-Path (Join-Path $jmSrc "bin\jmeter.bat"))) {
    $hasJm = Copy-Tree $jmSrc $JmDst
} else {
    Write-Warning "未设置 ATP_EMBED_JMETER 或未找到 JMeter；完整版将不含内置 JMeter。"
}
if ($hasPy) {
    & "$PSScriptRoot\configure-python-embed.ps1" -PythonRoot $PyDst
}

$pyVer = ""
if ($hasPy) {
    $pyExe = Join-Path $PyDst "python.exe"
    try { $pyVer = (& $pyExe --version 2>&1 | Out-String).Trim() } catch { }
}

$manifest = @{
    edition  = if ($hasPy -and $hasJre -and $hasJm) { "full" } else { "partial" }
    stagedAt = (Get-Date).ToUniversalTime().ToString("o")
    python   = if ($hasPy) { @{ version = $pyVer; path = "python/python.exe" } } else { $null }
    jre      = if ($hasJre) { @{ home = "jre" } } else { $null }
    jmeter   = if ($hasJm) { @{ home = "jmeter" } } else { $null }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $Staging "runtime-manifest.json") -Encoding UTF8

@"
ATP Full Runtime (POC)
======================
python: $(if ($hasPy) { 'OK' } else { 'MISSING — set ATP_EMBED_PYTHON' })
jre:    $(if ($hasJre) { 'OK' } else { 'MISSING — set ATP_EMBED_JRE' })
jmeter: $(if ($hasJm) { 'OK' } else { 'MISSING — set ATP_EMBED_JMETER' })

Layout (install dir / resources):
  runtime/python/   python.exe, python*._pth, Lib/site-packages/
  runtime/jre/      bin/java.exe
  runtime/jmeter/   bin/jmeter.bat, lib/

Dev smoke test without installer:
  Copy into desktop\runtime-dev\  (same tree)
  npm run dev  -> main process resolves bundledRuntime from runtime-dev
"@ | Set-Content (Join-Path $Staging "README.txt") -Encoding UTF8

Write-Host "Runtime staging -> $Staging (python=$hasPy jre=$hasJre jmeter=$hasJm)"
if (-not ($hasPy -and $hasJre -and $hasJm)) {
    Write-Host "POC: pack will include runtime folder but edition may be partial."
    exit 0
}