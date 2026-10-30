param(
  [int]$Port = 2102,
  [string]$Api = 'http://127.0.0.1:4000',
  [string]$MockHost = 'host.docker.internal'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$mockDir = Join-Path $PSScriptRoot 'mock-ntrip'
$fixture = Join-Path $PSScriptRoot 'fixtures\rtcm3-valid.hex'
$capture = Join-Path $env:TEMP 'cors-e2e-capture.bin'
$mockOut = Join-Path $env:TEMP 'cors-e2e-mock.out.log'
$mockErr = Join-Path $env:TEMP 'cors-e2e-mock.err.log'
$exe = Join-Path $env:TEMP 'cors-mock-ntrip.exe'

function Get-EnvMap {
  $map = @{}
  Get-Content (Join-Path $root '.env.local') | ForEach-Object {
    if ($_ -match '^([A-Z0-9_]+)=(.*)$') {
      $map[$matches[1]] = $matches[2]
    }
  }
  return $map
}

function Read-Fixture([string]$path) {
  $hex = ''
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#')) { $hex += $line }
  }
  $bytes = New-Object byte[] ($hex.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    $bytes[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16)
  }
  return $bytes
}

function Wait-Until([scriptblock]$Condition, [int]$TimeoutMs, [string]$Message) {
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 200
  }
  throw "timeout: $Message"
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

Remove-Item $capture, $mockOut, $mockErr -ErrorAction SilentlyContinue
$mock = Start-Process -FilePath $exe -WorkingDirectory $root -ArgumentList @(
  '-mode', 'caster',
  '-addr', "0.0.0.0:$Port",
  '-fixture', ('"' + $fixture + '"'),
  '-chunked',
  '-fragment', '15',
  '-repeat',
  '-delay', '50ms',
  '-capture', ('"' + $capture + '"')
) -RedirectStandardOutput $mockOut -RedirectStandardError $mockErr -PassThru

$jobId = $null
try {
  Wait-Until {
    try {
      $client = New-Object Net.Sockets.TcpClient
      $client.Connect('127.0.0.1', $Port)
      $client.Close()
      return $true
    } catch {
      return $false
    }
  } 5000 'mock listener did not start'

  $login = Invoke-RestMethod -Uri "$Api/api/auth/login" -Method Post -ContentType 'application/json' `
    -Body (@{ username = 'superadmin'; password = $password } | ConvertTo-Json -Compress) `
    -SessionVariable session
  $csrf = @{ 'X-CSRF-Token' = $login.csrfToken }

  $adminPassword = $envMap['SEED_ADMIN_PASSWORD']
  if ($adminPassword) {
    $null = Invoke-RestMethod -Uri "$Api/api/auth/login" -Method Post -ContentType 'application/json' `
      -Body (@{ username = 'admin'; password = $adminPassword } | ConvertTo-Json -Compress) `
      -SessionVariable adminSession
    $null = Invoke-RestMethod -Uri "$Api/api/relay-jobs" -WebSession $adminSession
  }
  $userPassword = $envMap['SEED_USER_PASSWORD']
  if ($userPassword) {
    $null = Invoke-RestMethod -Uri "$Api/api/auth/login" -Method Post -ContentType 'application/json' `
      -Body (@{ username = 'user1'; password = $userPassword } | ConvertTo-Json -Compress) `
      -SessionVariable userSession
    $null = Invoke-RestMethod -Uri "$Api/api/relay-jobs" -WebSession $userSession
  }

  $suffix = Get-Date -Format 'HHmmssfff'
  $secret = 'e2e-' + [Guid]::NewGuid().ToString('N')
  $body = @{
    externalKey = "e2e-$suffix"
    name = "e2e-mock-$suffix"
    enabled = $true
    upstream = @{
      host = $MockHost; port = $Port; mount = "UP$suffix"; ntripVersion = 'v2'
    }
    downstream = @{
      host = $MockHost; port = $Port; mount = "DOWN$suffix"; ntripVersion = 'v2'
    }
    upstreamCredential = @{ username = 'e2e-user'; password = $secret }
    downstreamMode = 'source'
  } | ConvertTo-Json -Depth 6

  $created = Invoke-RestMethod -Uri "$Api/api/relay-jobs" -Method Post -ContentType 'application/json' `
    -Headers $csrf -Body $body -WebSession $session
  $jobId = $created.item.id
  $createdRaw = $created | ConvertTo-Json -Depth 10 -Compress
  if ($createdRaw.Contains($secret)) { throw 'API response leaked the credential password' }
  if (-not $created.item.upstream.credential.hasSecret) { throw 'hasSecret was not set' }

  $expected = Read-Fixture $fixture
  Wait-Until {
    if (-not (Test-Path $capture)) { return $false }
    return (Get-Item $capture).Length -ge $expected.Length
  } 15000 'downstream capture did not receive bytes'

  $state = $null
  Wait-Until {
    $detail = Invoke-RestMethod -Uri "$Api/api/relay-jobs/$jobId" -WebSession $session
    $script:state = $detail.item.state
    return ($script:state -and $script:state.runtimeState -eq 'streaming')
  } 15000 'runtime state did not reach streaming'

  $stream = [IO.File]::Open($capture, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try {
    $captured = New-Object byte[] $stream.Length
    [void]$stream.Read($captured, 0, $captured.Length)
  } finally {
    $stream.Close()
  }
  for ($i = 0; $i -lt $expected.Length; $i++) {
    if ($captured[$i] -ne $expected[$i]) { throw "byte mismatch at $i" }
  }

  $testResult = Invoke-RestMethod -Uri "$Api/api/relay-jobs/$jobId/test" -Method Post -Headers $csrf `
    -WebSession $session -Body '{}'
  if (-not $testResult.result.ok) { throw "test action failed: $($testResult.result | ConvertTo-Json -Compress)" }

  $null = Invoke-RestMethod -Uri "$Api/api/relay-jobs/$jobId/disable" -Method Post -Headers $csrf -WebSession $session
  Wait-Until {
    $detail = Invoke-RestMethod -Uri "$Api/api/relay-jobs/$jobId" -WebSession $session
    return ($detail.item.state -and $detail.item.state.runtimeState -eq 'disabled')
  } 15000 'runtime state did not reach disabled'

  $deleteResponse = Invoke-WebRequest -Uri "$Api/api/relay-jobs/$jobId" -Method Delete -Headers $csrf -WebSession $session -UseBasicParsing
  if ($deleteResponse.StatusCode -ne 204) { throw "delete returned $($deleteResponse.StatusCode)" }
  $list = Invoke-RestMethod -Uri "$Api/api/relay-jobs?q=$suffix" -WebSession $session
  if ($list.total -ne 0) { throw "soft-deleted job still listed (total=$($list.total))" }

  "PASS capture=$($captured.Length) bytes state=$($script:state.runtimeState) test=$($testResult.result.ok) job=$jobId"
} catch {
  "FAIL $($_.Exception.Message)"
  if (Test-Path $mockErr) { Get-Content $mockErr -Tail 20 }
  if (Test-Path $mockOut) { Get-Content $mockOut -Tail 5 }
  exit 1
} finally {
  if ($mock -and -not $mock.HasExited) { Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue }
}
