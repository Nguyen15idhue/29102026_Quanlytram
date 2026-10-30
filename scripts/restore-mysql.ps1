param(
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  if (-not (Test-Path -LiteralPath $BackupFile)) { throw "backup file not found: $BackupFile" }
  if (-not $Force) {
    Write-Output 'Restore overwrites cors_admin/cors_runtime. Add -Force to confirm.'
    exit 2
  }

  $container = (& docker compose ps -q mysql).Trim()
  if (-not $container) { throw 'mysql container is not running' }

  $tempDir = Join-Path $env:TEMP ('cors-restore-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempDir | Out-Null
  try {
    $source = $BackupFile
    if ($BackupFile.EndsWith('.zip')) {
      Expand-Archive -LiteralPath $BackupFile -DestinationPath $tempDir -Force
      $source = Get-ChildItem -LiteralPath $tempDir -Filter '*.sql' | Select-Object -First 1 -ExpandProperty FullName
      if (-not $source) { throw 'zip does not contain a .sql file' }
    }
    $containerFile = '/tmp/cors-restore.sql'
    & docker cp $source "${container}:$containerFile"
    if ($LASTEXITCODE -ne 0) { throw 'docker cp failed' }
    $restoreCmd = 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" < ' + $containerFile
    & docker compose exec -T mysql sh -c $restoreCmd
    if ($LASTEXITCODE -ne 0) { throw 'mysql restore failed' }
    & docker compose exec -T mysql rm -f $containerFile | Out-Null
    Write-Output "RESTORE_OK $BackupFile"
  } finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
} finally {
  Pop-Location
}
