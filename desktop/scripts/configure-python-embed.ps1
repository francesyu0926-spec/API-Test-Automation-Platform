# Enable site-packages for Windows embeddable Python in pack-staging or runtime-dev.
param(
    [Parameter(Mandatory = $true)]
    [string]$PythonRoot
)
$ErrorActionPreference = "Stop"
$pth = Get-ChildItem -Path $PythonRoot -Filter "python*._pth" | Select-Object -First 1
if (-not $pth) {
    throw "No python*._pth in $PythonRoot"
}
$content = Get-Content $pth.FullName -Raw
$content = $content -replace "#\s*import site", "import site"
if ($content -notmatch "Lib\\site-packages") {
    $content = $content.TrimEnd() + "`nLib\site-packages`n"
}
# Embeddable python reads paths literally; UTF-8 BOM breaks the first line (python311.zip).
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($pth.FullName, $content.TrimEnd() + "`r`n", $utf8NoBom)
Write-Host "Updated $($pth.Name) for embedded site-packages."
Write-Host "Next: & '$PythonRoot\python.exe' -m pip install -r requirements.txt -r requirements-capture.txt (from repo root)"