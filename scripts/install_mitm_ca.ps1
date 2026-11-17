# Install mitmproxy CA into Current User Trusted Root (no mitm.it browser step).
$ErrorActionPreference = "Stop"
$mitmDir = Join-Path $env:USERPROFILE ".mitmproxy"
$cer = Join-Path $mitmDir "mitmproxy-ca-cert.cer"
$pem = Join-Path $mitmDir "mitmproxy-ca-cert.pem"

function Ensure-MitmCaFiles {
    if (Test-Path $cer) { return $cer }
    if (Test-Path $pem) {
        $cerOut = $cer
        # PEM -> CER for certutil (optional; Import-Certificate accepts PEM on newer PS)
        Copy-Item $pem $cerOut -Force
        return $cerOut
    }
    $repo = Resolve-Path (Join-Path $PSScriptRoot "..")
    $venvMitm = Join-Path $repo ".venv\Scripts\mitmdump.exe"
    $mitm = if (Test-Path $venvMitm) { $venvMitm } else { "mitmdump" }
    Write-Host "Generating mitmproxy CA (first run)..."
    $p = Start-Process -FilePath $mitm -ArgumentList @("--listen-port", "18081") -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 3
    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    if (-not (Test-Path $cer) -and (Test-Path $pem)) {
        Copy-Item $pem $cer -Force
    }
    if (-not (Test-Path $cer)) {
        throw "未找到 $cer 。请先 pip install mitmproxy 并启动一次 MITM 代理。"
    }
    return $cer
}

$certPath = Ensure-MitmCaFiles
Write-Host "Installing: $certPath"

if ($PSVersionTable.PSVersion.Major -ge 5) {
    Import-Certificate -FilePath $certPath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
} else {
    certutil -addstore -user Root $certPath | Out-Null
}

Write-Host "OK: mitmproxy CA added to Cert:\CurrentUser\Root"
Write-Host "Restart browser if HTTPS still fails."