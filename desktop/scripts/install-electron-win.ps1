# Manual Electron binary install when npm postinstall / TLS fails.
$ErrorActionPreference = "Stop"
$DesktopRoot = Split-Path -Parent $PSScriptRoot
$ElectronDir = Join-Path $DesktopRoot "node_modules\electron"
$Pkg = Get-Content (Join-Path $ElectronDir "package.json") | ConvertFrom-Json
$Ver = $Pkg.version
$Dist = Join-Path $ElectronDir "dist"
$ZipName = "electron-v$Ver-win32-x64.zip"
$Urls = @(
    "https://github.com/electron/electron/releases/download/v$Ver/$ZipName",
    "https://npmmirror.com/mirrors/electron/v$Ver/$ZipName",
    "https://cdn.npmmirror.com/binaries/electron/v$Ver/$ZipName"
)
$CacheZip = Join-Path $env:TEMP $ZipName

if (Test-Path (Join-Path $ElectronDir "path.txt")) {
    $exe = Join-Path $Dist "electron.exe"
    if (Test-Path $exe) {
        Write-Host "Electron already installed: $exe"
        exit 0
    }
}

New-Item -ItemType Directory -Force -Path $Dist | Out-Null
$downloaded = $false
foreach ($url in $Urls) {
    try {
        Write-Host "Downloading $url ..."
        if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
            & curl.exe -Lf --connect-timeout 60 -o $CacheZip $url
            if ($LASTEXITCODE -eq 0) { $downloaded = $true; break }
        } else {
            Invoke-WebRequest -Uri $url -OutFile $CacheZip -UseBasicParsing
            $downloaded = $true
            break
        }
    } catch {
        Write-Warning $_
    }
}
if (-not $downloaded) {
    throw "Download failed. Try VPN/proxy or download $ZipName manually and extract to $Dist"
}

Write-Host "Extracting..."
Expand-Archive -Path $CacheZip -DestinationPath $Dist -Force
Set-Content -Path (Join-Path $Dist "version") -Value "v$Ver" -NoNewline
Set-Content -Path (Join-Path $ElectronDir "path.txt") -Value "electron.exe" -NoNewline
Write-Host "Done. Run: npm run dev"