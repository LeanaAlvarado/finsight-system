Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-OutsideRepository([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')).TrimEnd('\', '/')
    if ($resolved.Equals($repo, [StringComparison]::OrdinalIgnoreCase) -or
        $resolved.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Choose a backup/config directory outside the source repository and website.'
    }
    return $resolved
}

function New-PrivateDirectory([string]$Path) {
    # Never replace the ACL of an existing user-selected parent directory.
    if (Test-Path -LiteralPath $Path -PathType Container) { return }
    [IO.Directory]::CreateDirectory($Path) | Out-Null
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Write-BackupJson([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 60), (New-Object Text.UTF8Encoding($false)))
}

function Get-PlainSecret([Security.SecureString]$Secret) {
    return (New-Object Management.Automation.PSCredential('backup', $Secret)).GetNetworkCredential().Password
}

function Assert-ServerKey([string]$Key) {
    if ($Key.StartsWith('sb_secret_')) { return }
    try {
        $payload = $Key.Split('.')[1].Replace('-', '+').Replace('_', '/')
        $payload = $payload.PadRight($payload.Length + ((4 - $payload.Length % 4) % 4), '=')
        $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
        if ($claims.role -eq 'service_role') { return }
    } catch { }
    throw 'Use a Supabase secret key or legacy service_role key. A publishable/anon key cannot make a complete backup.'
}

function Read-BackupConfig([string]$Path) {
    $config = Import-Clixml -LiteralPath (Assert-OutsideRepository $Path)
    if ($config.ProjectRef -notmatch '^[a-z]{20}$') { throw 'Invalid Supabase project reference.' }
    $localDrill = $config.DbHost -in @('127.0.0.1', 'localhost')
    if (-not $localDrill -and $config.DbHost -notmatch '^(aws-[a-z0-9-]+\.pooler\.supabase\.com|db\.[a-z]{20}\.supabase\.(co|com))$') {
        throw 'Use the Supabase Connect panel Session pooler or direct database hostname.'
    }
    if (-not $localDrill -and $config.DbPort -ne 5432) { throw 'Use Session pooler port 5432, not transaction pooler port 6543.' }
    if ($localDrill -and ($config.DbPort -lt 1024 -or $config.DbPort -gt 65535)) { throw 'Invalid local recovery-drill port.' }
    if ($config.DbUser -notin @('postgres', ('postgres.' + $config.ProjectRef))) { throw 'Use the database owner connection for complete backups.' }
    if ($config.DbHost.StartsWith('db.') -and -not $config.DbHost.StartsWith('db.' + $config.ProjectRef + '.')) { throw 'Database and Storage project references differ.' }
    if ($config.DbPassword -isnot [Security.SecureString] -or $config.StorageKey -isnot [Security.SecureString]) {
        throw 'Credentials must be saved by Initialize-FinSightBackup.ps1 as protected Windows secrets.'
    }
    Assert-ServerKey (Get-PlainSecret $config.StorageKey)
    $null = Assert-OutsideRepository $config.OutputRoot
    foreach ($exe in @('pg_dump.exe', 'pg_dumpall.exe', 'pg_restore.exe', 'psql.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $config.PgBin $exe) -PathType Leaf)) {
            throw "Missing $exe. Install PostgreSQL command-line tools and configure their bin directory."
        }
    }
    return $config
}

function ConvertTo-NativeArgument([string]$Value) {
    # Windows CRT quoting; no shell evaluation, interpolation, or cmd.exe.
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Invoke-BackupProcess([string]$Executable, [string[]]$Arguments, [hashtable]$Environment = @{}, [int]$TimeoutSeconds = 3600) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($name in $Environment.Keys) { $info.EnvironmentVariables[$name] = $Environment[$name] }
    $process = [Diagnostics.Process]::Start($info)
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill()
            throw "Backup tool timed out: $([IO.Path]::GetFileName($Executable))"
        }
        $output = $stdout.Result
        $errors = $stderr.Result
        if ($process.ExitCode -ne 0) {
            foreach ($name in $Environment.Keys) {
                if ($name -match 'PASSWORD|KEY' -and $Environment[$name]) { $errors = $errors.Replace($Environment[$name], '[REDACTED]') }
            }
            throw "$([IO.Path]::GetFileName($Executable)) failed (exit $($process.ExitCode)): $errors"
        }
        if ($errors.Trim()) { Write-Warning $errors.Trim() }
        return $output
    } finally { $process.Dispose() }
}

function Get-DatabaseEnvironment($Config) {
    return @{
        PGHOST = $Config.DbHost; PGPORT = [string]$Config.DbPort; PGUSER = $Config.DbUser
        PGDATABASE = 'postgres'; PGPASSWORD = (Get-PlainSecret $Config.DbPassword)
        PGSSLMODE = $(if ($Config.DbHost -in @('127.0.0.1', 'localhost')) { 'disable' } else { 'require' }); PGCONNECT_TIMEOUT = '20'; PGAPPNAME = 'finsight-readonly-backup'
        PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=1800000'
    }
}

function Get-StorageInventory($Config, [hashtable]$DatabaseEnvironment) {
    $sql = @'
select json_build_object(
 'buckets', coalesce((select json_agg(to_jsonb(b) order by b.id) from storage.buckets b), '[]'::json),
 'objects', coalesce((select json_agg(to_jsonb(o) - 'last_accessed_at' order by o.bucket_id, o.name) from storage.objects o), '[]'::json)
);
'@
    $json = Invoke-BackupProcess (Join-Path $Config.PgBin 'psql.exe') @('--no-password', '--no-psqlrc', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1', '--command', $sql) $DatabaseEnvironment
    $inventory = $json.Trim() | ConvertFrom-Json
    if ($null -eq $inventory.buckets -or $null -eq $inventory.objects) { throw 'Storage inventory is incomplete.' }
    return $inventory
}

function Get-ObjectLocalName([string]$Bucket, [string]$Name) {
    # Remote names may contain ../, reserved Windows names or case collisions.
    # Hash the exact case-sensitive bucket/name pair; preserve names in inventory.
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Bucket + "`n" + $Name)))).Replace('-', '').ToLowerInvariant() + '.bin' }
    finally { $sha.Dispose() }
}

function Get-StorageObjectUrl([string]$ProjectRef, [string]$Bucket, [string]$Name) {
    if (@($Name.Split('/') | Where-Object { $_ -in @('.', '..') }).Count) { throw 'Unsupported dot segment in Storage object name; refusing to download a different normalized path.' }
    $path = (($Name.Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/')
    return 'https://' + $ProjectRef + '.supabase.co/storage/v1/object/authenticated/' + [Uri]::EscapeDataString($Bucket) + '/' + $path
}

function Save-StorageObject($Config, $Object, [string]$Destination) {
    $key = Get-PlainSecret $Config.StorageKey
    $headers = @{ apikey = $key }
    if (-not $key.StartsWith('sb_secret_')) { $headers.Authorization = 'Bearer ' + $key }
    $url = Get-StorageObjectUrl $Config.ProjectRef $Object.bucket_id $Object.name
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $url -Headers $headers -OutFile $Destination -TimeoutSec 300 -MaximumRedirection 0 | Out-Null
            return
        } catch {
            if ($attempt -eq 3) { throw 'A Storage file download failed. Backup is incomplete; check the key, connectivity and whether files changed during backup.' }
            Start-Sleep -Seconds 2
        }
    }
}

function Assert-InventoryUnchanged($Before, $After) {
    # Canonical DB ordering and complete rows detect additions, deletions and replacements.
    if ((ConvertTo-Json -InputObject $Before -Depth 60 -Compress) -cne (ConvertTo-Json -InputObject $After -Depth 60 -Compress)) {
        throw 'Storage changed while backup was running. No successful backup was published. Retry when uploads/deletions have stopped.'
    }
}

function Get-BackupFileEntry([string]$Root, [string]$RelativePath) {
    $path = Join-Path $Root $RelativePath
    $file = Get-Item -LiteralPath $path
    return [pscustomobject]@{ path = $RelativePath; bytes = $file.Length; sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
}

function Test-BackupFiles([string]$Root) {
    $manifest = Get-Content -LiteralPath (Join-Path $Root 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.status -ne 'complete' -or $manifest.formatVersion -ne 1) { throw 'This is not a completed, supported backup.' }
    $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (@($manifest.files).Count -lt 4) { throw 'Backup manifest is incomplete.' }
    $seen = @{}
    foreach ($entry in $manifest.files) {
        $path = [IO.Path]::GetFullPath((Join-Path $Root $entry.path))
        if ([IO.Path]::IsPathRooted($entry.path) -or -not $path.StartsWith($fullRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid path in backup manifest.' }
        if ($seen.ContainsKey($path)) { throw 'Duplicate path in backup manifest.' }
        $seen[$path] = $true
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Backup file missing: $($entry.path)" }
        if ((Get-Item -LiteralPath $path).Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $entry.sha256) {
            throw "Backup file damaged or changed: $($entry.path)"
        }
    }
    foreach ($required in @('database.dump', 'database-toc.txt', 'roles.sql', 'storage-inventory.json')) {
        if (-not $seen.ContainsKey((Join-Path $fullRoot $required))) { throw "Required backup file missing from manifest: $required" }
    }
    $inventory = Get-Content -LiteralPath (Join-Path $Root 'storage-inventory.json') -Raw | ConvertFrom-Json
    if (@($inventory.objects).Count -ne $manifest.storageObjectCount) { throw 'Storage object count does not match the manifest.' }
    foreach ($object in $inventory.objects) {
        $name = 'storage/' + (Get-ObjectLocalName $object.bucket_id $object.name)
        if (-not $seen.ContainsKey([IO.Path]::GetFullPath((Join-Path $Root $name)))) { throw 'A Storage object is absent from the verified backup.' }
    }
    return $manifest
}
