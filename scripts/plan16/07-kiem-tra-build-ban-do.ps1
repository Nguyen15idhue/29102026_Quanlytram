<#
.SYNOPSIS
    Kiểm tra bản build frontend có worker MapLibre hay không.
.DESCRIPTION
    MapLibre v6 tự tạo worker bằng new URL('./maplibre-gl-worker.mjs', import.meta.url).
    Nếu Vite không copy file này vào dist/assets thì bản build sẽ không tải được tile/marker.
    Script trả mã 1 nếu thiếu file.
.VI_DU
    powershell -File scripts/plan16/07-kiem-tra-build-ban-do.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

$goc = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$worker = Join-Path $goc 'frontend/dist/assets/maplibre-gl-worker.mjs'

Write-Host "» Đang kiểm tra worker MapLibre trong bản build..." -ForegroundColor Cyan

if (Test-Path $worker) {
    $kichThuoc = [Math]::Round((Get-Item $worker).Length / 1KB, 1)
    Write-Host "  [ĐẠT] Có maplibre-gl-worker.mjs ($kichThuoc KB)" -ForegroundColor Green
    exit 0
}

Write-Host "  [KHÔNG ĐẠT] Thiếu frontend/dist/assets/maplibre-gl-worker.mjs" -ForegroundColor Red
Write-Host "  Gợi ý: chạy 'cd frontend; npm run build' rồi kiểm tra lại." -ForegroundColor Yellow
exit 1
