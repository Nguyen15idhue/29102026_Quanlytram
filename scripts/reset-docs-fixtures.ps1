<#
.SYNOPSIS
  Xoá dữ liệu minh họa của trang hướng dẫn (tiền tố DOCS).

.DESCRIPTION
  Chỉ xoá các bản ghi do scripts/seed-docs-fixtures.mjs tạo ra.
  Mặc định là chạy thử (dry-run); dùng -Apply để xoá thật.

.EXAMPLE
  .\scripts\reset-docs-fixtures.ps1 -DryRun
  .\scripts\reset-docs-fixtures.ps1 -Apply
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
try { chcp 65001 > $null } catch {}
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $root

if ($DryRun -and $Apply) {
  throw 'Chọn một trong hai: -DryRun hoặc -Apply.'
}
$isApply = [bool]$Apply

$envFile = Join-Path $root '.env.local'
if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'Không tìm thấy file .env.local ở thư mục gốc dự án.'
}

$mysqlPassword = $null
Get-Content -LiteralPath $envFile -Encoding UTF8 | ForEach-Object {
  if ($_ -match '^MYSQL_ROOT_PASSWORD=(.*)$') { $mysqlPassword = $Matches[1] }
}
if ([string]::IsNullOrWhiteSpace($mysqlPassword)) {
  throw 'Không đọc được MYSQL_ROOT_PASSWORD trong .env.local.'
}

$database = 'cors_admin'
$queries = @(
  "SELECT 'alert' AS loai, COUNT(*) AS so_dong FROM alerts WHERE dedupe_key LIKE 'DOCS-%'",
  "SELECT 'relay_job' AS loai, COUNT(*) AS so_dong FROM relay_jobs WHERE name LIKE 'DOCS-%'",
  "SELECT 'listener' AS loai, COUNT(*) AS so_dong FROM caster_listeners WHERE name LIKE 'DOCS Caster%'",
  "SELECT 'ntrip_account' AS loai, COUNT(*) AS so_dong FROM ntrip_accounts WHERE username LIKE 'docs\_%'",
  "SELECT 'mountpoint' AS loai, COUNT(*) AS so_dong FROM mountpoints WHERE name LIKE 'DOCS\_%'",
  "SELECT 'station' AS loai, COUNT(*) AS so_dong FROM stations WHERE name LIKE 'DOCS-%'",
  "SELECT 'web_user' AS loai, COUNT(*) AS so_dong FROM web_users WHERE username IN ('docs.admin','docs.user')",
  "SELECT 'company' AS loai, COUNT(*) AS so_dong FROM companies WHERE code = 'DOCS_DEMO'"
)

function Invoke-Mysql([string]$sql) {
  $output = & docker compose exec -T -e "MYSQL_PWD=$mysqlPassword" mysql `
    mysql -uroot --batch --skip-column-names -e "USE $database; $sql" 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Lệnh MySQL thất bại: $output"
  }
  return $output
}

Write-Host 'Dữ liệu minh họa hiện có:' -ForegroundColor Cyan
$total = 0
foreach ($query in $queries) {
  $line = Invoke-Mysql $query
  Write-Host ("  {0}" -f $line)
  $parts = ($line -split "`t")
  if ($parts.Count -ge 2 -and $parts[1] -match '^\d+$') { $total += [int]$parts[1] }
}

if ($total -eq 0) {
  Write-Host 'Không có dữ liệu minh họa nào cần xoá.' -ForegroundColor Green
  exit 0
}

if (-not $isApply) {
  Write-Host ("Chạy thử: sẽ xoá {0} bản ghi. Thêm -Apply để xoá thật." -f $total) -ForegroundColor Yellow
  exit 0
}

Write-Host 'Đang xoá dữ liệu minh họa...' -ForegroundColor Yellow
Invoke-Mysql "DELETE FROM alerts WHERE dedupe_key LIKE 'DOCS-%'" | Out-Null
Invoke-Mysql "DELETE FROM relay_jobs WHERE name LIKE 'DOCS-%'" | Out-Null
Invoke-Mysql "DELETE FROM caster_listeners WHERE name LIKE 'DOCS Caster%'" | Out-Null
Invoke-Mysql "DELETE FROM ntrip_accounts WHERE username LIKE 'docs\_%'" | Out-Null
Invoke-Mysql "DELETE FROM mountpoints WHERE name LIKE 'DOCS\_%'" | Out-Null
Invoke-Mysql "DELETE FROM stations WHERE name LIKE 'DOCS-%'" | Out-Null
Invoke-Mysql "DELETE FROM web_users WHERE username = 'docs.user'" | Out-Null
Invoke-Mysql "DELETE FROM web_users WHERE username = 'docs.admin'" | Out-Null
Invoke-Mysql "DELETE FROM companies WHERE code = 'DOCS_DEMO'" | Out-Null

Write-Host 'Đã xoá xong dữ liệu minh họa DOCS.' -ForegroundColor Green
