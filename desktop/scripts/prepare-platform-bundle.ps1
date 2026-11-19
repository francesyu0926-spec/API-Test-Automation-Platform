# Stage repo platform files (atp, schemas, projects, runs) for electron-builder extraResources.
$ErrorActionPreference = "Stop"
$DesktopRoot = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent $DesktopRoot
$Staging = Join-Path $DesktopRoot "pack-staging\platform"

if (Test-Path $Staging) {
    Remove-Item -Recurse -Force $Staging
}
New-Item -ItemType Directory -Force -Path $Staging | Out-Null

$ExcludeDirNames = @("__pycache__", "report", "bower_components", "node_modules", ".venv")

function Test-SkipDir([string]$Name) {
    if ($ExcludeDirNames -contains $Name) { return $true }
    if ($Name -like "run_*") { return $true }
    return $false
}

function Copy-TreeFiltered {
    param(
        [string]$From,
        [string]$To
    )
    if (-not (Test-Path $From)) {
        Write-Warning "Skip missing: $From"
        return
    }
    New-Item -ItemType Directory -Force -Path $To | Out-Null
    Get-ChildItem -LiteralPath $From -Force | ForEach-Object {
        if ($_.PSIsContainer) {
            if (Test-SkipDir $_.Name) { return }
            Copy-TreeFiltered -From $_.FullName -To (Join-Path $To $_.Name)
        } else {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $To $_.Name) -Force
        }
    }
}

Write-Host "Staging platform bundle -> $Staging"
Copy-TreeFiltered -From (Join-Path $RepoRoot "atp") -To (Join-Path $Staging "atp")
Copy-TreeFiltered -From (Join-Path $RepoRoot "schemas") -To (Join-Path $Staging "schemas")
Copy-TreeFiltered -From (Join-Path $RepoRoot "projects") -To (Join-Path $Staging "projects")

$runsSrc = Join-Path $RepoRoot "runs"
$runsDst = Join-Path $Staging "runs"
New-Item -ItemType Directory -Force -Path (Join-Path $runsDst "by-month") | Out-Null
if (Test-Path (Join-Path $runsSrc "index.json")) {
    Copy-Item (Join-Path $runsSrc "index.json") $runsDst -Force
} else {
    @"
{
  "version": 1,
  "updated_at": null,
  "runs": []
}
"@ | Set-Content -Path (Join-Path $runsDst "index.json") -Encoding UTF8
}

foreach ($f in @("requirements.txt", "requirements-capture.txt")) {
    $src = Join-Path $RepoRoot $f
    if (Test-Path $src) {
        Copy-Item $src $Staging -Force
    }
}

$readme = @"
API Test Automation Platform — bundled data directory
=====================================================
Python CLI: atp\cli.py (use system Python or create .venv here)
Optional: pip install -r requirements.txt
Override data root: set ATP_REPO_ROOT to another folder.
"@
Set-Content -Path (Join-Path $Staging "README.txt") -Value $readme -Encoding UTF8

Write-Host "Done. Platform root ready under pack-staging\platform"