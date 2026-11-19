# Copy customer docs into pack-staging/docs for Full edition installer.
$ErrorActionPreference = "Stop"
$DesktopRoot = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent $DesktopRoot
$Staging = Join-Path $DesktopRoot "pack-staging\docs"
$SrcDocs = Join-Path $RepoRoot "docs"

if (Test-Path $Staging) {
    Remove-Item -Recurse -Force $Staging
}
New-Item -ItemType Directory -Force -Path $Staging | Out-Null

$names = @(
    "PRODUCT-MANUAL.pdf",
    "PRODUCT-MANUAL.html",
    "PRODUCT-MANUAL.md",
    "ROADMAP-DELIVERY.md",
    "DELIVERY-LAYOUT.md"
)
$copied = 0
foreach ($n in $names) {
    $src = Join-Path $SrcDocs $n
    if (Test-Path $src) {
        Copy-Item $src $Staging -Force
        $copied++
    }
}
Write-Host "Delivery docs staged: $copied files -> $Staging"