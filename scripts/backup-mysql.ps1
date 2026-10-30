param(
  [string]$OutDir = 'F:\3.Laptrinh\1. Project\1. GNSS\Backup',
  [switch]$NoCompress
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
  }
  $container = (& docker compose ps -q mysql).Trim()
  if (-not $container) { throw 'mysql container is not running' }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $name = "cors-mysql-$stamp.sql"
  $hostFile = Join-Path $OutDir $name
  $containerFile = "/tmp/$name"

  $dumpCmd = 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --databases cors_admin cors_runtime --result-file=' + $containerFile
  & docker compose exec -T mysql sh -c $dumpCmd
  if ($LASTEXITCODE -ne 0) { throw 'mysqldump failed' }
  & docker cp "${container}:$containerFile" $hostFile
  if ($LASTEXITCODE -ne 0) { throw 'docker cp failed' }
  & docker compose exec -T mysql rm -f $containerFile | Out-Null

  if (-not $NoCompress) {
    $zip = "$hostFile.zip"
    Compress-Archive -LiteralPath $hostFile -DestinationPath $zip -Force
    Remove-Item -LiteralPath $hostFile
    $hostFile = $zip
  }

  $hash = Get-FileHash -LiteralPath $hostFile -Algorithm SHA256
  Write-Output "BACKUP_OK $hostFile"
  Write-Output "SHA256 $($hash.Hash)"
  Write-Output 'Backup stored outside repo. Do not commit dumps.'
} finally {
  Pop-Location
}
