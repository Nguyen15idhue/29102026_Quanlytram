<#
.SYNOPSIS
  Kiểm tra hiệu năng API quản lý trạm CORS (Kế hoạch 20).

.DESCRIPTION
  Đăng nhập bằng tài khoản seed (đọc mật khẩu từ .env.local nếu không truyền),
  đo thời gian phản hồi các endpoint nóng, in bảng p50/p90/max và kiểm tra các
  index hiệu năng đã được migrate hay chưa.

  Script KHÔNG in mật khẩu, KHÔNG ghi mật khẩu ra file bằng chứng.
  Mã thoát: 0 = đạt ngưỡng; 1 = có endpoint vượt ngưỡng p90 hoặc lỗi đăng nhập.

.PARAMETER BaseUrl
  Địa chỉ Node API, mặc định http://127.0.0.1:4000.

.PARAMETER TenDangNhap
  Tài khoản đăng nhập, mặc định superadmin.

.PARAMETER MatKhau
  Mật khẩu; để trống thì đọc SEED_SUPERADMIN_PASSWORD trong .env.local.

.PARAMETER SoLan
  Số lần gọi mỗi endpoint (mặc định 10).

.PARAMETER NguongP90Ms
  Ngưỡng p90 cho phép của các endpoint dữ liệu (mặc định 400 ms).

.PARAMETER BangChung
  Đường dẫn file ghi bằng chứng (tuỳ chọn). Không ghi mật khẩu.

.PARAMETER MysqlContainer
  Tên container MySQL để kiểm tra index (mặc định cors-mvp-mysql-1).

.PARAMETER BoQuaIndex
  Bỏ qua bước kiểm tra index trong MySQL.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/kiem-tra-hieu-nang.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/kiem-tra-hieu-nang.ps1 `
    -SoLan 20 -BangChung "C:\Temp\hieu-nang.txt"
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://127.0.0.1:4000',
  [string]$TenDangNhap = 'superadmin',
  [string]$MatKhau = '',
  [int]$SoLan = 10,
  [int]$NguongP90Ms = 400,
  [string]$BangChung = '',
  [string]$MysqlContainer = 'cors-mvp-mysql-1',
  [switch]$BoQuaIndex
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$gocRepo = Split-Path -Parent $PSScriptRoot
$dongBangChung = New-Object System.Collections.Generic.List[string]

function Ghi-BangChung([string]$noiDung) {
  Write-Host $noiDung
  $dongBangChung.Add($noiDung) | Out-Null
}

function Doc-MatKhauTuEnv {
  $tep = Join-Path $gocRepo '.env.local'
  if (-not (Test-Path $tep)) { return '' }
  foreach ($dong in Get-Content $tep -Encoding UTF8) {
    if ($dong -match '^\s*SEED_SUPERADMIN_PASSWORD\s*=\s*(.*)\s*$') {
      return $Matches[1].Trim('"').Trim("'")
    }
  }
  return ''
}

function Do-ThoiGian([string]$duongDan, $phien) {
  $batDau = [Diagnostics.Stopwatch]::StartNew()
  $null = Invoke-WebRequest -UseBasicParsing -Uri ($BaseUrl + $duongDan) `
    -WebSession $phien -TimeoutSec 120
  $batDau.Stop()
  return [math]::Round($batDau.Elapsed.TotalMilliseconds, 0)
}

function Tinh-PhanVi($mang, [double]$tiLe) {
  $sapXep = @($mang | Sort-Object)
  if ($sapXep.Count -eq 0) { return 0 }
  $viTri = [int][math]::Floor($sapXep.Count * $tiLe) - 1
  if ($viTri -lt 0) { $viTri = 0 }
  if ($viTri -ge $sapXep.Count) { $viTri = $sapXep.Count - 1 }
  return [int]$sapXep[$viTri]
}

if ([string]::IsNullOrWhiteSpace($MatKhau)) {
  $MatKhau = Doc-MatKhauTuEnv
}
if ([string]::IsNullOrWhiteSpace($MatKhau)) {
  Write-Host 'LỖI: chưa có mật khẩu. Truyền -MatKhau hoặc đặt SEED_SUPERADMIN_PASSWORD trong .env.local.' -ForegroundColor Red
  exit 1
}

Ghi-BangChung ('=== KIỂM TRA HIỆU NĂNG API — ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ===')
Ghi-BangChung ('Địa chỉ: ' + $BaseUrl + ' | tài khoản: ' + $TenDangNhap + ' | số lần: ' + $SoLan)

try {
  $noiDungDangNhap = @{ username = $TenDangNhap; password = $MatKhau } | ConvertTo-Json
  $null = Invoke-RestMethod -Method Post -Uri ($BaseUrl + '/api/auth/login') `
    -Body $noiDungDangNhap -ContentType 'application/json' -SessionVariable phien
} catch {
  Write-Host ('LỖI: đăng nhập thất bại: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
Ghi-BangChung 'Đăng nhập: OK'

# Lấy một ID trạm thật để đo endpoint chi tiết (tránh 404).
$idTram = 1
try {
  $danhSach = Invoke-RestMethod -Uri ($BaseUrl + '/api/stations?page=1&pageSize=1') -WebSession $phien
  if ($danhSach.items -and $danhSach.items.Count -gt 0) {
    $idTram = [int]$danhSach.items[0].id
  }
} catch { }

$kichBan = @(
  @{ Ten = 'Danh sách trạm'; DuongDan = '/api/stations?page=1&pageSize=50'; Nguong = $NguongP90Ms },
  @{ Ten = 'Chi tiết trạm'; DuongDan = ('/api/stations/' + $idTram); Nguong = $NguongP90Ms },
  @{ Ten = 'Bản đồ vận hành'; DuongDan = '/api/map/overview?layer=stations'; Nguong = $NguongP90Ms },
  @{ Ten = 'Danh sách online'; DuongDan = '/api/connections'; Nguong = $NguongP90Ms },
  @{ Ten = 'Health Node'; DuongDan = '/health'; Nguong = 50 }
)

Ghi-BangChung ''
Ghi-BangChung ('{0,-22} {1,8} {2,8} {3,8} {4,10}' -f 'Endpoint', 'p50(ms)', 'p90(ms)', 'max(ms)', 'Kết luận')
Ghi-BangChung ('{0,-22} {1,8} {2,8} {3,8} {4,10}' -f ('-' * 22), ('-' * 8), ('-' * 8), ('-' * 8), ('-' * 10))

$viPham = 0
foreach ($muc in $kichBan) {
  $mau = @()
  $loi = ''
  for ($lan = 0; $lan -lt $SoLan; $lan++) {
    try {
      $mau += (Do-ThoiGian $muc.DuongDan $phien)
    } catch {
      $loi = $_.Exception.Message
      break
    }
  }
  if ($loi -ne '') {
    Ghi-BangChung ('{0,-22} {1,8} {2,8} {3,8} {4,10}' -f $muc.Ten, '-', '-', '-', 'LỖI')
    Write-Host ('  Chi tiết: ' + $loi) -ForegroundColor Red
    $viPham++
    continue
  }
  $p50 = Tinh-PhanVi $mau 0.5
  $p90 = Tinh-PhanVi $mau 0.9
  $max = ($mau | Measure-Object -Maximum).Maximum
  $ketLuan = 'ĐẠT'
  if ($p90 -gt $muc.Nguong) {
    $ketLuan = 'VƯỢT'
    $viPham++
  }
  Ghi-BangChung ('{0,-22} {1,8} {2,8} {3,8} {4,10}' -f $muc.Ten, $p50, $p90, $max, $ketLuan)
}

if (-not $BoQuaIndex) {
  Ghi-BangChung ''
  Ghi-BangChung '--- Kiểm tra index hiệu năng (migration runtime 011) ---'
  $cauLenhIndex = "SELECT index_name FROM information_schema.statistics WHERE table_schema='cors_runtime' AND index_name IN ('idx_quality_samples_latest','idx_quality_samples_target_dir_ts','idx_relay_sessions_open','idx_quality_alerts_open') GROUP BY index_name ORDER BY index_name;"
  try {
    Push-Location $gocRepo
    $ketQuaIndex = $cauLenhIndex | docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N' 2>$null
    $coIndex = @($ketQuaIndex | Where-Object { $_ -and $_.Trim() -ne '' })
    if ($coIndex.Count -eq 4) {
      Ghi-BangChung ('Index: ĐỦ 4/4 (' + ($coIndex -join ', ') + ')')
    } else {
      Ghi-BangChung ('Index: THIẾU — mới có ' + $coIndex.Count + '/4. Chạy migration runtime 011.')
      $viPham++
    }
  } catch {
    Ghi-BangChung 'Index: BỎ QUA (không chạy được docker compose trên máy này)'
  } finally {
    Pop-Location
  }
}

Ghi-BangChung ''
if ($viPham -eq 0) {
  Ghi-BangChung 'KẾT QUẢ: ĐẠT — tất cả endpoint trong ngưỡng và index đầy đủ.'
} else {
  Ghi-BangChung ('KẾT QUẢ: CÓ ' + $viPham + ' mục cần xử lý.')
}

if (-not [string]::IsNullOrWhiteSpace($BangChung)) {
  $thuMuc = Split-Path -Parent $BangChung
  if ($thuMuc -and -not (Test-Path $thuMuc)) {
    New-Item -ItemType Directory -Path $thuMuc -Force | Out-Null
  }
  $dongBangChung | Set-Content -Path $BangChung -Encoding UTF8
  Write-Host ('Đã ghi bằng chứng: ' + $BangChung)
}

if ($viPham -eq 0) { exit 0 } else { exit 1 }
