# Verify soft-delete frees endpoint keys: create -> delete -> recreate same endpoints (expect 201).
[CmdletBinding()]
param(
  [string]$Api = 'http://127.0.0.1:4000',
  [string]$Envs = ''
)

if (-not $Envs) { $Envs = Join-Path $PSScriptRoot '..\.env.local' }

$envMap = @{}
Get-Content $Envs | ForEach-Object {
  if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') { $envMap[$matches[1]] = $matches[2] }
}
$password = $envMap['SEED_SUPERADMIN_PASSWORD']
if (-not $password) { throw 'SEED_SUPERADMIN_PASSWORD missing' }

$login = Invoke-RestMethod -Uri "$Api/api/auth/login" -Method Post -ContentType 'application/json' `
  -Body (@{ username = 'superadmin'; password = $password } | ConvertTo-Json -Compress) `
  -SessionVariable session
$csrf = @{ 'X-CSRF-Token' = $login.csrfToken }

$suffix = Get-Date -Format 'HHmmssfff'
$eps = @{
  upstream   = @{ host = 'verify-fix.invalid'; port = 2101; mount = "FIXA$suffix"; ntripVersion = 'v2' }
  downstream = @{ host = 'verify-fix.invalid'; port = 2101; mount = "FIXB$suffix"; ntripVersion = 'v2' }
}
$body = @{
  externalKey = "fixverify-$suffix"
  name        = "fixverify-$suffix"
  enabled     = $false
  upstream    = $eps.upstream
  downstream  = $eps.downstream
} | ConvertTo-Json -Depth 6

$first = Invoke-RestMethod -Uri "$Api/api/relay-jobs" -Method Post -ContentType 'application/json' `
  -Headers $csrf -Body $body -WebSession $session
if (-not $first.item.id) { throw 'first create failed' }
$id1 = $first.item.id
Write-Output "created first id=$id1"

$del = Invoke-WebRequest -Uri "$Api/api/relay-jobs/$id1" -Method Delete -Headers $csrf `
  -WebSession $session -UseBasicParsing
if ($del.StatusCode -ne 204) { throw "delete returned $($del.StatusCode)" }

$recreated = Invoke-RestMethod -Uri "$Api/api/relay-jobs" -Method Post -ContentType 'application/json' `
  -Headers $csrf -Body $body -WebSession $session
if (-not $recreated.item.id) { throw 'RECREATE FAILED - unique index still blocking' }
$id2 = $recreated.item.id
Write-Output "RECREATE_OK id=$id2"

$null = Invoke-WebRequest -Uri "$Api/api/relay-jobs/$id2" -Method Delete -Headers $csrf `
  -WebSession $session -UseBasicParsing
Write-Output 'CLEANUP_DELETE_OK'
Write-Output "PROBE_IDS=$id1,$id2"
