<#
.SYNOPSIS
  So sánh trạng thái timeline của trạm/relay ở 4 khung 1h, 24h, 7d, 30d
  tại cùng một thời điểm. Dùng để tái hiện lỗi và nghiệm thu kế hoạch 09.

.DESCRIPTION
  Script đăng nhập bằng tài khoản seed (đọc mật khẩu từ .env.local, không in ra),
  gọi API timeline, rồi đối chiếu trạng thái tại các mốc thời gian truyền vào.
  Trả mã thoát 1 nếu có mốc lệch trạng thái giữa các khung hoặc tổng thời lượng
  không khớp độ dài khung.

.PARAMETER Kind
  station hoặc relay.

.PARAMETER Id
  ID trạm hoặc relay job.

.PARAMETER Direction
  upstream/downstream, chỉ dùng cho relay.

.PARAMETER Instants
  Danh sách mốc thời gian ISO-8601, ví dụ:
  "2026-11-02T00:30:00+07:00","2026-11-02T04:00:00+07:00"

.PARAMETER BaseUrl
  Địa chỉ server Node, mặc định http://127.0.0.1:4000.

.EXAMPLE
  powershell -File scripts/verify-timeline.ps1 -Kind station -Id 480 `
    -Instants "2026-11-02T00:30:00+07:00","2026-11-02T04:00:00+07:00"

.EXAMPLE
  powershell -File scripts/verify-timeline.ps1 -Kind relay -Id 227 `
    -Direction upstream -Instants "2026-11-02T01:00:00+07:00"
#>
[CmdletBinding()]
param(
  [ValidateSet('station', 'relay')]
  [string]$Kind = 'station',
  [int]$Id = 480,
  [ValidateSet('upstream', 'downstream')]
  [string]$Direction = 'upstream',
  [string[]]$Instants = @(),
  [string]$BaseUrl = 'http://127.0.0.1:4000'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env.local'
if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Không tìm thấy .env.local tại $envPath"
}

$password = $null
foreach ($line in Get-Content -LiteralPath $envPath -Encoding UTF8) {
  if ($line -match '^\s*SEED_SUPERADMIN_PASSWORD\s*=\s*(.+)$') {
    $password = $Matches[1].Trim()
    break
  }
}
if ([string]::IsNullOrWhiteSpace($password)) {
  throw 'Không đọc được SEED_SUPERADMIN_PASSWORD từ .env.local'
}

function ConvertTo-LocalText {
  param([datetimeoffset]$Value)
  return $Value.ToOffset([TimeSpan]::FromHours(7)).ToString('dd/MM/yyyy HH:mm:ss')
}

function Get-Segments {
  param($Timeline)
  if ($Timeline.segments -and $Timeline.segments.Count -gt 0) {
    return @($Timeline.segments)
  }
  return @($Timeline.buckets)
}

function Get-StatusAt {
  param($Timeline, [datetimeoffset]$Instant)
  $from = [datetimeoffset]::Parse($Timeline.rangeFrom)
  $to = [datetimeoffset]::Parse($Timeline.to)
  if ($Instant -lt $from -or $Instant -ge $to) {
    return $null
  }
  foreach ($segment in (Get-Segments -Timeline $Timeline)) {
    $segmentFrom = [datetimeoffset]::Parse($segment.from)
    $segmentTo = [datetimeoffset]::Parse($segment.to)
    if ($Instant -ge $segmentFrom -and $Instant -lt $segmentTo) {
      $reason = $segment.reason
      if ([string]::IsNullOrWhiteSpace($reason)) {
        return [string]$segment.status
      }
      return ('{0} ({1})' -f $segment.status, $reason)
    }
  }
  return 'không xác định'
}

function Get-SegmentSeconds {
  param($Timeline)
  $total = 0.0
  foreach ($segment in (Get-Segments -Timeline $Timeline)) {
    $total += ([datetimeoffset]::Parse($segment.to) - [datetimeoffset]::Parse($segment.from)).TotalSeconds
  }
  return [math]::Round($total, 0)
}

$body = @{ username = 'superadmin'; password = $password } | ConvertTo-Json -Compress
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
try {
  $login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" `
    -ContentType 'application/json; charset=utf-8' -Body $body -WebSession $session
} catch {
  throw "Đăng nhập thất bại: $($_.Exception.Message)"
}
if (-not $login.user) {
  throw 'Đăng nhập không trả về thông tin người dùng'
}

$ranges = @('1h', '24h', '7d', '1m')
$timelines = @{}
foreach ($range in $ranges) {
  $uri = if ($Kind -eq 'relay') {
    "$BaseUrl/api/relay-jobs/$Id/timeline?range=$range&direction=$Direction"
  } else {
    "$BaseUrl/api/stations/$Id/timeline?range=$range"
  }
  try {
    $timelines[$range] = Invoke-RestMethod -Uri $uri -WebSession $session
  } catch {
    throw "Không tải được timeline $range cho $Kind ${Id}: $($_.Exception.Message)"
  }
}

$instantsToCheck = @()
foreach ($text in $Instants) {
  $instantsToCheck += [datetimeoffset]::Parse($text)
}
if ($instantsToCheck.Count -eq 0) {
  # Mặc định: 6 mốc quanh hiện tại để phát hiện lệch khung.
  $now = [datetimeoffset]::UtcNow
  foreach ($minutes in @(10, 60, 180, 480, 1440, 4320)) {
    $instantsToCheck += $now.AddMinutes(-$minutes)
  }
}
$instantsToCheck = @($instantsToCheck | Sort-Object)

Write-Output '=== KIỂM TRA TIMELINE THEO KHUNG ==='
Write-Output ("Đối tượng : {0} #{1} {2}" -f $Kind, $Id, $(if ($Kind -eq 'relay') { $Direction } else { '' }))
Write-Output ("Server    : {0}" -f $BaseUrl)
Write-Output ''

$coverageFailures = @()
foreach ($range in $ranges) {
  $timeline = $timelines[$range]
  $window = ([datetimeoffset]::Parse($timeline.to) - [datetimeoffset]::Parse($timeline.rangeFrom)).TotalSeconds
  $covered = Get-SegmentSeconds -Timeline $timeline
  $status = if ([math]::Abs($window - $covered) -le 2) { 'PASS' } else { 'FAIL' }
  if ($status -eq 'FAIL') {
    $coverageFailures += "$range (khung=$([math]::Round($window))s, segment=$($covered)s)"
  }
  Write-Output ("Độ phủ {0,-4}: {1} | khung {2}s | segment {3}s | asOf {4}" -f `
    $range, $status, [math]::Round($window), $covered, (ConvertTo-LocalText ([datetimeoffset]::Parse($timeline.to))))
}
Write-Output ''

$mismatches = @()
$rows = @()
foreach ($instant in $instantsToCheck) {
  $values = @{}
  $covering = 0
  foreach ($range in $ranges) {
    $value = Get-StatusAt -Timeline $timelines[$range] -Instant $instant
    if ($null -ne $value) {
      $values[$range] = $value
      $covering++
    } else {
      $values[$range] = '—'
    }
  }
  $distinct = @($values.Values | Where-Object { $_ -ne '—' } | Sort-Object -Unique)
  $result = if ($covering -lt 2) {
    'bỏ qua'
  } elseif ($distinct.Count -eq 1) {
    'PASS'
  } else {
    'FAIL'
    $mismatches += (ConvertTo-LocalText $instant)
  }
  $rows += [pscustomobject]@{
    'Thời điểm' = ConvertTo-LocalText $instant
    '1 giờ' = $values['1h']
    '24 giờ' = $values['24h']
    '7 ngày' = $values['7d']
    '30 ngày' = $values['1m']
    'Kết quả' = $result
  }
}

$rows | Format-Table -AutoSize | Out-String -Width 220 | Write-Output

if ($mismatches.Count -gt 0) {
  Write-Output ("KẾT QUẢ: FAIL — lệch trạng thái tại: {0}" -f ($mismatches -join ', '))
}
if ($coverageFailures.Count -gt 0) {
  Write-Output ("KẾT QUẢ: FAIL — tổng thời lượng không khớp khung: {0}" -f ($coverageFailures -join '; '))
}
if ($mismatches.Count -eq 0 -and $coverageFailures.Count -eq 0) {
  Write-Output 'KẾT QUẢ: PASS — các khung nhất quán và phủ kín khoảng thời gian.'
  exit 0
}
exit 1
