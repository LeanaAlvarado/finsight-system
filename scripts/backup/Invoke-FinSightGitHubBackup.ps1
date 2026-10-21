[CmdletBinding()]
param()
. (Join-Path $PSScriptRoot 'Backup.Common.ps1')
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) { throw 'Run this adapter only on a GitHub-hosted Windows runner.' }
foreach ($name in @('SUPABASE_DB_HOST', 'SUPABASE_DB_PASSWORD', 'SUPABASE_STORAGE_KEY', 'FINSIGHT_BACKUP_PASSPHRASE')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { throw "Missing GitHub Actions secret: $name" }
}
$root = Join-Path $env:RUNNER_TEMP ('finsight-private-' + [Guid]::NewGuid().ToString('N'))
New-PrivateDirectory $root
$output = Join-Path $root 'copies'
$project = 'azjmgkxyciynpiowqfii'
$pgBin = $env:PGBIN
if (-not $pgBin) { $pgBin = Join-Path $env:ProgramFiles 'PostgreSQL/17/bin' }
$configPath = Join-Path $root 'config.clixml'
$passphrase = ConvertTo-SecureString $env:FINSIGHT_BACKUP_PASSPHRASE -AsPlainText -Force
# Fail before contacting production if encryption cannot be configured.
if ($env:FINSIGHT_BACKUP_PASSPHRASE.Length -lt 32 -or $env:FINSIGHT_BACKUP_PASSPHRASE -match '[\r\n]') { throw 'Backup passphrase must be a single line of at least 32 characters.' }
$config = [pscustomobject]@{
    Version = 1; ProjectRef = $project; DbHost = $env:SUPABASE_DB_HOST; DbPort = 5432
    DbUser = ('postgres.' + $project)
    DbPassword = (ConvertTo-SecureString $env:SUPABASE_DB_PASSWORD -AsPlainText -Force)
    StorageKey = (ConvertTo-SecureString $env:SUPABASE_STORAGE_KEY -AsPlainText -Force)
    PgBin = $pgBin; OutputRoot = $output; SourceRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
}
if ($config.DbHost.StartsWith('db.')) { $config.DbUser = 'postgres' }
try {
    $config | Export-Clixml -LiteralPath $configPath
    & (Join-Path $PSScriptRoot 'Backup-FinSight.ps1') -ConfigPath $configPath
    $completed = @(Get-ChildItem -LiteralPath $output -Directory | Where-Object { $_.Name -notlike '*.incomplete' })
    if ($completed.Count -ne 1) { throw 'Expected exactly one completed backup.' }
    & (Join-Path $PSScriptRoot 'Test-FinSightBackup.ps1') -BackupPath $completed[0].FullName
    $archive = Join-Path $root 'backup.zip'
    $null = Invoke-BackupProcess (Get-Command tar.exe).Source @('-a', '-c', '-f', $archive, '-C', $output, $completed[0].Name)
    $encrypted = Join-Path $root 'backup.zip.gpg'
    & (Join-Path $PSScriptRoot 'Protect-FinSightArchive.ps1') -InputPath $archive -OutputPath $encrypted -Passphrase $passphrase
    $roundtrip = Join-Path $root 'roundtrip.zip'
    & (Join-Path $PSScriptRoot 'Protect-FinSightArchive.ps1') -InputPath $encrypted -OutputPath $roundtrip -Passphrase $passphrase -Decrypt
    if ((Get-FileHash -LiteralPath $archive).Hash -ne (Get-FileHash -LiteralPath $roundtrip).Hash) { throw 'Encrypted backup failed its decryption round-trip check.' }
    # Publish one encrypted file only, after verification. Never upload this directory.
    $artifactDir = Join-Path $env:RUNNER_TEMP 'finsight-encrypted-artifact'
    New-PrivateDirectory $artifactDir
    Copy-Item -LiteralPath $encrypted -Destination (Join-Path $artifactDir 'backup.zip.gpg') -ErrorAction Stop
    Write-Host 'Encrypted backup verified and ready for artifact upload. A database recovery drill is still required.'
} finally {
    if (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath -Force }
    foreach ($name in @('SUPABASE_DB_PASSWORD', 'SUPABASE_STORAGE_KEY', 'FINSIGHT_BACKUP_PASSPHRASE')) {
        [Environment]::SetEnvironmentVariable($name, $null)
    }
    # The remaining plaintext exists only on this ephemeral hosted runner.
}
