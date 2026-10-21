[CmdletBinding()]
param([string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'FinSightBackup/config.clixml'))
. (Join-Path $PSScriptRoot 'Backup.Common.ps1')

$ConfigPath = Assert-OutsideRepository $ConfigPath
if (Test-Path -LiteralPath $ConfigPath) { throw 'A configuration already exists. Keep it, or specify a new -ConfigPath to configure another backup.' }
Write-Host 'FinSight private backup setup. Enter secrets here, never in chat or GitHub.'
Write-Host 'Install PostgreSQL Command Line Tools first (pg_dump, pg_dumpall, pg_restore and psql).'
$portableBin = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../tmp_backup_tools/pgsql/bin'))
if (Test-Path -LiteralPath (Join-Path $portableBin 'pg_dump.exe')) { Write-Host "Prepared tools found. Press Enter to use: $portableBin" }
$pgBin = Read-Host 'PostgreSQL bin folder, e.g. C:\Program Files\PostgreSQL\17\bin'
if (-not $pgBin.Trim() -and (Test-Path -LiteralPath (Join-Path $portableBin 'pg_dump.exe'))) { $pgBin = $portableBin }
foreach ($exe in @('pg_dump.exe', 'pg_dumpall.exe', 'pg_restore.exe', 'psql.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $pgBin $exe))) { throw "Cannot find $exe in that folder. Install PostgreSQL command-line tools, then rerun setup." }
}
Write-Host 'Supabase Dashboard > Connect > Session pooler. Copy its host only (no password).'
$dbHost = (Read-Host 'Session pooler host').Trim()
$projectRef = 'azjmgkxyciynpiowqfii'
$dbPassword = Read-Host 'Database password (hidden)' -AsSecureString
Write-Host 'Supabase Project Settings > API Keys: use a secret key, or the legacy service_role key.'
$storageKey = Read-Host 'Server-side Storage key (hidden)' -AsSecureString
Assert-ServerKey (Get-PlainSecret $storageKey)
$outputRoot = Read-Host 'Private backup folder (Enter for the default folder on this computer)'
if (-not $outputRoot.Trim()) { $outputRoot = Join-Path $env:LOCALAPPDATA 'FinSightBackup/copies' }
$outputRoot = Assert-OutsideRepository $outputRoot
New-PrivateDirectory (Split-Path -Parent $ConfigPath)
New-PrivateDirectory $outputRoot
$config = [pscustomobject]@{
    Version = 1; ProjectRef = $projectRef; DbHost = $dbHost; DbPort = 5432
    DbUser = 'postgres.' + $projectRef; DbPassword = $dbPassword; StorageKey = $storageKey
    PgBin = [IO.Path]::GetFullPath($pgBin); OutputRoot = $outputRoot
    SourceRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
}
# PowerShell protects SecureString fields with Windows DPAPI for this account.
$config | Export-Clixml -LiteralPath $ConfigPath
try { $null = Read-BackupConfig $ConfigPath }
catch { throw "Configuration needs correction. Use a new -ConfigPath on the next setup run. $($_.Exception.Message)" }
Write-Host "Configuration saved privately to $ConfigPath. No backup has run yet."
Write-Host 'Now run Backup-FinSight.ps1 -CheckOnly, followed by Backup-FinSight.ps1.'
