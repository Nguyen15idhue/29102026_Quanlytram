param(
  [switch]$Execute,
  [switch]$ClearRuntime,
  [string]$BackupDir = 'F:\3.Laptrinh\1. Project\1. GNSS\Backup'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $envMap = @{}
  Get-Content (Join-Path $root '.env.local') -Encoding UTF8 | ForEach-Object {
    if ($_ -match '^([A-Za-z0-9_]+)=(.*)$') { $envMap[$matches[1]] = $matches[2] }
  }
  $password = $envMap['MYSQL_ROOT_PASSWORD']
  if (-not $password) { throw 'MYSQL_ROOT_PASSWORD is missing from .env.local' }

  $mysql = {
    param([string]$Sql)
    $Sql | docker compose exec -T -e MYSQL_PWD="$password" mysql mysql -uroot --default-character-set=utf8mb4
    if ($LASTEXITCODE -ne 0) { throw "mysql failed with exit $LASTEXITCODE" }
  }

  $backup = Get-ChildItem -LiteralPath $BackupDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^cors-mysql-.*\.(sql|sql\.zip)$' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $backup) { throw "No MySQL backup found in $BackupDir" }
  if ($backup.Length -le 0) { throw "Backup is empty: $($backup.FullName)" }
  Write-Output "BACKUP $($backup.FullName) $($backup.Length) bytes"

  $countSql = @'
SELECT 'stations' AS k, COUNT(*) AS v FROM cors_admin.stations
UNION ALL SELECT 'mountpoints', COUNT(*) FROM cors_admin.mountpoints
UNION ALL SELECT 'station_sources', COUNT(*) FROM cors_admin.station_sources
UNION ALL SELECT 'station_probes', COUNT(*) FROM cors_admin.station_probes
UNION ALL SELECT 'ntrip_accounts', COUNT(*) FROM cors_admin.ntrip_accounts
UNION ALL SELECT 'caster_connections', COUNT(*) FROM cors_runtime.caster_connections
UNION ALL SELECT 'relay_jobs_enabled', COUNT(*) FROM cors_admin.relay_jobs WHERE deleted_at IS NULL AND enabled = 1;
'@

  Write-Output '--- BEFORE ---'
  & $mysql $countSql

  $resetSql = @'
USE cors_admin;
START TRANSACTION;

UPDATE relay_jobs r
  JOIN mountpoints m ON m.name = r.upstream_mount OR m.name = r.downstream_mount
   SET r.enabled = 0,
       r.desired_revision = r.desired_revision + 1
 WHERE r.deleted_at IS NULL
   AND r.paused_by_station_id IS NULL;

DELETE FROM caster_listener_mountpoints
 WHERE mountpoint_id IN (SELECT id FROM mountpoints);

DELETE FROM account_mountpoint_acl
 WHERE mountpoint_id IN (SELECT id FROM mountpoints);

DELETE FROM account_listener_acl;

DELETE FROM station_probes;
DELETE FROM station_sources;
DELETE FROM mountpoints;
DELETE FROM stations;

COMMIT;
'@

  $runtimeSql = @'
DELETE FROM cors_runtime.caster_connections;
'@

  if (-not $Execute) {
    Write-Output 'DRY_RUN: no data changed. Re-run with -Execute after reviewing the counts.'
    Write-Output 'WOULD_RUN:'
    Write-Output $resetSql
    if ($ClearRuntime) { Write-Output 'WOULD_RUN_RUNTIME:'; Write-Output $runtimeSql }
    exit 0
  }

  Write-Output '--- EXECUTING RESET ---'
  & $mysql $resetSql
  if ($ClearRuntime) {
    Write-Output '--- CLEARING RUNTIME TEST DATA ---'
    & $mysql $runtimeSql
  }

  Write-Output '--- AFTER ---'
  & $mysql $countSql
  Write-Output 'RESET_OK'
} finally {
  Pop-Location
}
