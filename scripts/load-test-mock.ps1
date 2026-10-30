param(
  [int]$Jobs = 20,
  [int]$Port = 2102,
  [string]$Api = 'http://127.0.0.1:4000',
  [string]$MockHost = 'host.docker.internal',
  [int]$WaitSeconds = 8,
  [switch]$Keep
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$mockDir = Join-Path $PSScriptRoot 'mock-ntrip'
$fixture = Join-Path $PSScriptRoot 'fixtures\rtcm3-valid.hex'
$mockOut = Join-Path $env:TEMP 'cors-load-mock.out.log'
$mockErr = Join-Path $env:TEMP 'cors-load-mock.err.log'
$exe = Join-Path $env:TEMP 'cors-mock-ntrip-load.exe'

function Get-EnvMap {
  $map = @{}
  Get-Content (Join-Path $root '.env.local') | ForEach-Object {
    if ($_ -match '^([A-Z0-9_]+)=(.*)$') { $map[$matches[1]] = $matches[2] }
  }
  return $map
}

$envMap = Get-EnvMap
$password = $envMap['SEED_SUPERADMIN_PASSWORD']
if (-not $password) { throw 'SEED_SUPERADMIN_PASSWORD is missing from .env.local' }

Push-Location $mockDir
try {
  & go build -o $exe .
  if ($LASTEXITCODE -ne 0) { throw 'mock build failed' }
} finally {
  Pop-Location
}

Remove-Item $mockOut, $mockErr -ErrorAction SilentlyContinue
$mock = Start-Process -FilePath $exe -WorkingDirectory $root -ArgumentList @(
  '-mode', 'caster',
  '-addr', "0.0.0.0:$Port",
  '-fixture', ('"' + $fixture + '"'),
  '-chunked',
  '-fragment', '64',
  '-repeat',
  '-delay', '20ms'
) -RedirectStandardOutput $mockOut -RedirectStandardError $mockErr -PassThru

$jobIds = @()
$rovers = @()
$login = $null
try {
  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $deadline) {
    try {
      $client = New-Object Net.Sockets.TcpClient
      $client.Connect('127.0.0.1', $Port)
      $client.Close()
      break
    } catch {
      Start-Sleep -Milliseconds 200
    }
  }

  $login = Invoke-RestMethod -Uri "$Api/api/auth/login" -Method Post -ContentType 'application/json' `
    -Body (@{ username = 'superadmin'; password = $password } | ConvertTo-Json -Compress) `
    -SessionVariable session
  $csrf = @{ 'X-CSRF-Token' = $login.csrfToken }

  $suffix = Get-Date -Format 'HHmmss'
  for ($i = 1; $i -le $Jobs; $i++) {
    $body = @{
      externalKey = "load-$suffix-$i"
      name = "load-mock-$suffix-$i"
      enabled = $true
      upstream = @{ host = $MockHost; port = $Port; mount = "LOAD_UP_${suffix}_$i"; ntripVersion = 'v2' }
      downstream = @{ host = $MockHost; port = $Port; mount = "LOAD_DOWN_${suffix}_$i"; ntripVersion = 'v2' }
      downstreamMode = 'source'
    } | ConvertTo-Json -Depth 6
    $created = Invoke-RestMethod -Uri "$Api/api/relay-jobs" -Method Post -Headers $csrf `
      -ContentType 'application/json' -Body $body -WebSession $session
    $jobIds += [int]$created.item.id
  }
  Write-Output "CREATED $($jobIds.Count) relay jobs -> mock $MockHost`:$Port"

  foreach ($id in $jobIds) {
    $down = "LOAD_DOWN_${suffix}_$($jobIds.IndexOf($id) + 1)"
    $rovers += Start-Process -FilePath $exe -WorkingDirectory $root -ArgumentList @(
      '-mode', 'rover',
      '-addr', "127.0.0.1:$Port",
      '-mount', $down,
      '-expect', ('"' + $fixture + '"'),
      '-timeout', '20s'
    ) -RedirectStandardOutput (Join-Path $env:TEMP "cors-load-rover-$id.out.log") `
      -RedirectStandardError (Join-Path $env:TEMP "cors-load-rover-$id.err.log") -PassThru
  }
  Write-Output "STARTED $($rovers.Count) mock rovers"

  Start-Sleep -Seconds $WaitSeconds
  $snapshot = Invoke-RestMethod -Uri "$Api/api/snapshot" -WebSession $session
  $selected = @($snapshot.item.relays | Where-Object { $jobIds -contains $_.jobId })
  $streaming = @($selected | Where-Object { $_.state -eq 'streaming' }).Count
  Write-Output "SNAPSHOT relays=$($selected.Count) streaming=$streaming connections=$($snapshot.item.summary.connections)"
  if ($streaming -lt $Jobs) {
    $states = ($selected | Group-Object state | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ','
    Write-Output "LOAD_RESULT FAIL streaming=$streaming/$Jobs states=$states"
    exit 1
  }
  Write-Output "LOAD_RESULT PASS streaming=$streaming/$Jobs (mock only, port $Port)"
} finally {
  foreach ($process in $rovers) {
    try { if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force } } catch {}
  }
  if ($login -and -not $Keep) {
    foreach ($id in $jobIds) {
      try {
        Invoke-RestMethod -Uri "$Api/api/relay-jobs/$id" -Method Delete -Headers $csrf -WebSession $session | Out-Null
      } catch {}
    }
  }
  if ($Keep) {
    Write-Output "KEEP jobs=$($jobIds -join ',') mockPid=$($mock.Id) mockPort=$Port"
  } else {
    try { if (-not $mock.HasExited) { Stop-Process -Id $mock.Id -Force } } catch {}
  }
  Write-Output 'DONE load test (mock only). Không dùng endpoint thật.'
}
