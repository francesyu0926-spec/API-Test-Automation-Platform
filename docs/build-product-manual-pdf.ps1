# 将 PRODUCT-MANUAL.md 转为 PRODUCT-MANUAL.pdf（需本机 pandoc + Microsoft Edge）
$ErrorActionPreference = "Stop"
$docs = Split-Path -Parent $MyInvocation.MyCommand.Path
$md = Join-Path $docs "PRODUCT-MANUAL.md"
$html = Join-Path $docs "PRODUCT-MANUAL.html"
$pdf = Join-Path $docs "PRODUCT-MANUAL.pdf"

$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) {
  $edge = "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
}
if (-not (Test-Path $edge)) {
  throw "未找到 Microsoft Edge，无法打印 PDF"
}

pandoc $md `
  -o $html `
  --standalone `
  --embed-resources `
  --resource-path=$docs `
  --metadata title="API Test Platform 产品说明书"

$uri = ([System.Uri]::new($html)).AbsoluteUri
& $edge --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$pdf" $uri | Out-Null

if (-not (Test-Path $pdf)) {
  throw "PDF 生成失败"
}

Write-Host "Generated: $pdf"