param(
  [string]$Api = 'http://127.0.0.1:4000',
  [int]$TestPort = 15999,
  [switch]$Enabled
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $envMap = @{}
  Get-Content (Join-Path $root '.env.local') -Encoding UTF8 | ForEach-Object {
    if ($_ -match '^([A-Za-z0-9_]+)=(.*)$') { $envMap[$matches[1]] = $matches[2] }
  }
  $password = $envMap['SEED_SUPERADMIN_PASSWORD']
  if (-not $password) { throw 'SEED_SUPERADMIN_PASSWORD is missing from .env.local' }

  $login = Invoke-RestMethod -Uri "$Api/api/auth/login" -Method Post `
    -ContentType 'application/json' `
    -Body (@{ username = 'superadmin'; password = $password } | ConvertTo-Json -Compress) `
    -SessionVariable session
  $headers = @{ 'X-CSRF-Token' = $login.csrfToken }

  $listeners = Invoke-RestMethod -Uri "$Api/api/caster/listeners?page=1&pageSize=100" -WebSession $session
  $listener = $listeners.items | Where-Object { [int]$_.port -eq $TestPort } | Select-Object -First 1
  if (-not $listener) {
    $listener = Invoke-RestMethod -Uri "$Api/api/caster/listeners" -Method Post -WebSession $session `
      -Headers $headers -ContentType 'application/json' `
      -Body (@{
        name = "E2E caster $TestPort"
        port = $TestPort
        enabled = $true
        role = 'both'
        description = 'Realtime CRUD test listener'
      } | ConvertTo-Json -Compress)
    $listener = $listener.item
  }

  $suffix = Get-Date -Format 'yyyyMMddHHmmss'
  $secret = 'E2E-' + [Guid]::NewGuid().ToString('N').Substring(0, 16)

  $stations = @(
    @{
      name = "E2E Caster Ingest $suffix"
      port = $TestPort
      source_type = 'caster_ingest'
      source_role = 'ntrip_caster'
      caster_listener_id = [int]$listener.id
      caster_username = "e2e_caster_$suffix"
      caster_password = $secret
      caster_requires_auth = $true
      enabled = [bool]$Enabled
    },
    @{
      name = "E2E Relay Caster $suffix"
      port = $TestPort
      source_type = 'relay_caster'
      source_role = 'ntrip_caster'
      caster_listener_id = [int]$listener.id
      caster_username = "e2e_relay_$suffix"
      caster_password = $secret
      caster_requires_auth = $true
      enabled = [bool]$Enabled
    },
    @{
      name = "E2E Ntrip Client $suffix"
      port = 1509
      source_type = 'probe_client'
      source_role = 'ntrip_client'
      client_host = '127.0.0.1'
      client_port = 15999
      client_mount = "E2E_UPSTREAM_$suffix"
      client_username = "e2e_client_$suffix"
      client_password = $secret
      client_tls = $false
      client_send_gga = $false
      enabled = [bool]$Enabled
    }
  )

  $created = @()
  foreach ($station in $stations) {
    $result = Invoke-RestMethod -Uri "$Api/api/stations" -Method Post -WebSession $session `
      -Headers $headers -ContentType 'application/json' `
      -Body ($station | ConvertTo-Json -Compress)
    $created += $result.item
  }

  Write-Output "SEED_OK listener=$($listener.id) port=$TestPort"
  $created | ForEach-Object {
    Write-Output ("STATION {0} {1} mountpoint={2} account={3}" -f $_.id, $_.name, $_.mountpoint_name, $_.account_username)
  }
} finally {
  Pop-Location
}
