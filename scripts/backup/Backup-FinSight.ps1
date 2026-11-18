[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'FinSightBackup/config.clixml'),
    [switch]$CheckOnly
)
. (Join-Path $PSScriptRoot 'Backup.Common.ps1')
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$config = Read-BackupConfig $ConfigPath
$dbEnvironment = Get-DatabaseEnvironment $config
$pgDump = Join-Path $config.PgBin 'pg_dump.exe'
$pgRestore = Join-Path $config.PgBin 'pg_restore.exe'
$psql = Join-Path $config.PgBin 'psql.exe'
$version = (Invoke-BackupProcess $pgDump @('--version')).Trim()
$server = (Invoke-BackupProcess $psql @('--no-password', '--no-psqlrc', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1', '--command', 'show server_version_num') $dbEnvironment).Trim()
$clientMajor = [int]([regex]::Match($version, '(\d+)\.').Groups[1].Value)
if ($clientMajor -lt [math]::Floor([int]$server / 10000)) { throw 'PostgreSQL client tools are older than the server. Install the matching or a newer major version.' }
$before = Get-StorageInventory $config $dbEnvironment
if ($CheckOnly) {
    Write-Host "Database reachable; $version; server version $server. Storage inventory: $(@($before.objects).Count) object(s)."
    Write-Host 'Configuration/database checks passed. Storage download permission is checked during the full backup. No backup was created.'
    exit 0
}

$root = Assert-OutsideRepository $config.OutputRoot
New-PrivateDirectory $root
$lock = $null
$stage = $null
try {
    # Prevent scheduled and manual runs from overlapping; a process crash releases the handle.
    $lock = [IO.File]::Open((Join-Path $root 'backup.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    $name = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $stage = Join-Path $root ($name + '.incomplete')
    New-PrivateDirectory $stage
    New-PrivateDirectory (Join-Path $stage 'storage')
    $started = [DateTime]::UtcNow.ToString('o')
    Write-BackupJson (Join-Path $stage 'status.json') @{ status = 'incomplete'; startedAt = $started }
    Write-BackupJson (Join-Path $stage 'storage-inventory.json') $before

    Write-Host 'Exporting the database (read-only, including application data, auth data and audit history)...'
    $null = Invoke-BackupProcess $pgDump @('--no-password', '--format=custom', '--file', (Join-Path $stage 'database.dump')) $dbEnvironment
    $dumpFile = Get-Item -LiteralPath (Join-Path $stage 'database.dump')
    if ($dumpFile.Length -lt 5) { throw 'Database export is empty.' }
    $toc = Invoke-BackupProcess $pgRestore @('--list', (Join-Path $stage 'database.dump'))
    foreach ($table in @('projects', 'inventory', 'material_catalog', 'users', 'roles', 'expenses', 'payroll', 'feedback', 'project_files', 'audit_logs')) {
        if ($toc -notmatch ('(?m) TABLE DATA public ' + [regex]::Escape($table) + ' ')) { throw "Database dump is missing application table data: $table" }
    }
    # Parse/decompress the entire archive too, rather than just checking its header.
    $null = Invoke-BackupProcess $pgRestore @('--file=NUL', (Join-Path $stage 'database.dump'))
    [IO.File]::WriteAllText((Join-Path $stage 'database-toc.txt'), $toc, (New-Object Text.UTF8Encoding($false)))
    $null = Invoke-BackupProcess (Join-Path $config.PgBin 'pg_dumpall.exe') @('--no-password', '--roles-only', '--no-role-passwords', '--file', (Join-Path $stage 'roles.sql')) $dbEnvironment

    $files = New-Object 'Collections.Generic.List[object]'
    foreach ($relative in @('database.dump', 'database-toc.txt', 'roles.sql', 'storage-inventory.json')) { $files.Add((Get-BackupFileEntry $stage $relative)) }
    $completed = 0
    foreach ($object in $before.objects) {
        $relative = 'storage/' + (Get-ObjectLocalName $object.bucket_id $object.name)
        $destination = Join-Path $stage $relative
        Save-StorageObject $config $object $destination
        if ($null -ne $object.metadata -and $null -ne $object.metadata.PSObject.Properties['size']) {
            if ([long]$object.metadata.size -ne (Get-Item -LiteralPath $destination).Length) { throw 'Downloaded file size differs from Storage metadata. Retry the backup.' }
        }
        $files.Add((Get-BackupFileEntry $stage $relative))
        $completed++
        Write-Progress -Activity 'Backing up uploaded files' -Status "$completed of $(@($before.objects).Count)" -PercentComplete (100 * $completed / [math]::Max(1, @($before.objects).Count))
    }
    Write-Progress -Activity 'Backing up uploaded files' -Completed
    Assert-InventoryUnchanged $before (Get-StorageInventory $config $dbEnvironment)

    $commit = ''
    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($git -and (Test-Path -LiteralPath (Join-Path $config.SourceRepo '.git'))) {
        $commit = (Invoke-BackupProcess $git.Source @('-C', $config.SourceRepo, 'rev-parse', 'HEAD')).Trim()
        $null = Invoke-BackupProcess $git.Source @('-C', $config.SourceRepo, 'archive', '--format=zip', '--output', (Join-Path $stage 'source-code.zip'), 'HEAD')
        $files.Add((Get-BackupFileEntry $stage 'source-code.zip'))
    }
    $manifest = [ordered]@{
        formatVersion = 1; status = 'complete'; projectRef = $config.ProjectRef
        startedAt = $started; completedAt = [DateTime]::UtcNow.ToString('o')
        databaseServerVersion = $server; pgDumpVersion = $version; sourceCommit = $commit
        storageObjectCount = @($before.objects).Count; storageBucketCount = @($before.buckets).Count
        restoreTested = $false; files = @($files.ToArray())
    }
    Write-BackupJson (Join-Path $stage 'manifest.json') $manifest
    $null = Test-BackupFiles $stage
    Write-BackupJson (Join-Path $stage 'status.json') @{ status = 'complete'; completedAt = $manifest.completedAt }
    $destination = Join-Path $root $name
    # Both validated absolute paths are children of the selected backup root.
    if (-not ([IO.Path]::GetFullPath($stage)).StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFullPath($destination)).StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup destination escaped the selected directory.' }
    [IO.Directory]::Move($stage, $destination)
    $stage = $null
    Write-Host "BACKUP COMPLETE AND FILE HASHES VERIFIED: $destination"
    Write-Host 'A restore into a separate test project is still required to verify disaster recovery. No old backups were deleted.'
} catch {
    if ($stage -and (Test-Path -LiteralPath $stage)) {
        Write-BackupJson (Join-Path $stage 'status.json') @{ status = 'failed'; failedAt = [DateTime]::UtcNow.ToString('o') }
    }
    throw
} finally {
    if ($lock) { $lock.Dispose() }
    $dbEnvironment.Clear()
}
