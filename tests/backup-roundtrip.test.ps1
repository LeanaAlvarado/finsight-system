[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$PgBin)
. (Join-Path $PSScriptRoot '../scripts/backup/Backup.Common.ps1')
$PgBin = [IO.Path]::GetFullPath($PgBin)
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('finsight-recovery-drill-' + [Guid]::NewGuid().ToString('N'))
New-PrivateDirectory $testRoot
$data = Join-Path $testRoot 'postgres-data'
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$envForTest = @{PGHOST='127.0.0.1';PGPORT=[string]$port;PGUSER='postgres';PGDATABASE='postgres';PGSSLMODE='disable';PGCONNECT_TIMEOUT='10'}
$psql = Join-Path $PgBin 'psql.exe'
$pgctl = Join-Path $PgBin 'pg_ctl.exe'
function Invoke-TestServerControl([string[]]$Arguments) {
    # Windows descendants may inherit redirected pipes. The background test
    # server writes its own log; do not capture daemon-control output pipes.
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $pgctl
    $info.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $process = [Diagnostics.Process]::Start($info)
    try {
        if (-not $process.WaitForExit(90000)) { $process.Kill(); throw 'Local test server control timed out' }
        if ($process.ExitCode -ne 0) { throw 'Local test server control failed' }
    } finally { $process.Dispose() }
}
$started = $false
try {
    $null = Invoke-BackupProcess (Join-Path $PgBin 'initdb.exe') @('-D',$data,'-U','postgres','--auth=trust','--no-locale','--encoding=UTF8')
    Invoke-TestServerControl @('-D',$data,'-l',(Join-Path $testRoot 'postgres.log'),'-o',("-h 127.0.0.1 -p $port"),'-w','start')
    $started = $true
    $schema = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../supabase/cloud_required_schema.sql')
    $tables = $schema.Substring($schema.IndexOf('create table if not exists public.projects'))
    $tables = $tables.Substring(0, $tables.IndexOf('alter table public.projects'))
    $fixture = @'
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select '11111111-1111-4111-8111-111111111111'::uuid $$;
create function auth.jwt() returns jsonb language sql as $$ select '{"email":"backup-test@example.test"}'::jsonb $$;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean);
create table storage.objects(id uuid primary key, bucket_id text, name text, metadata jsonb, last_accessed_at timestamptz);
'@
    $fixture += "`n" + $tables + "`n" + (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../supabase/migrations/20260921010000_enforce_permanent_audit_history.sql'))
    $fixture += "`ninsert into inventory(id,name,qty) values ('backup-fixture','Backup test cable',10); update inventory set qty=8 where id='backup-fixture'; delete from inventory where id='backup-fixture';"
    $fixturePath = Join-Path $testRoot 'fixture.sql'
    [IO.File]::WriteAllText($fixturePath,$fixture,(New-Object Text.UTF8Encoding($false)))
    $null = Invoke-BackupProcess $psql @('-X','--set=ON_ERROR_STOP=1','--file',$fixturePath) $envForTest
    $config = [pscustomobject]@{
        Version=1;ProjectRef='azjmgkxyciynpiowqfii';DbHost='127.0.0.1';DbPort=$port;DbUser='postgres'
        DbPassword=(ConvertTo-SecureString 'synthetic-test-only' -AsPlainText -Force)
        StorageKey=(ConvertTo-SecureString 'sb_secret_synthetic-test-only' -AsPlainText -Force)
        PgBin=$PgBin;OutputRoot=(Join-Path $testRoot 'copies');SourceRepo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    }
    $configPath = Join-Path $testRoot 'config.clixml'
    $config | Export-Clixml -LiteralPath $configPath
    $script = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/backup/Backup-FinSight.ps1'))
    $output = Invoke-BackupProcess (Join-Path $PSHOME 'powershell.exe') @('-NoProfile','-ExecutionPolicy','Bypass','-File',$script,'-ConfigPath',$configPath)
    Write-Host $output
    $complete = @(Get-ChildItem -LiteralPath $config.OutputRoot -Directory | Where-Object { $_.Name -notlike '*.incomplete' })
    if ($complete.Count -ne 1) { throw 'Expected exactly one completed backup' }
    $null = Test-BackupFiles $complete[0].FullName
    $null = Invoke-BackupProcess $psql @('-X','--set=ON_ERROR_STOP=1','--command','create database finsight_restore_test') $envForTest
    $targetEnvironment = $envForTest.Clone()
    $targetEnvironment.PGDATABASE = 'finsight_restore_test'
    $null = Invoke-BackupProcess (Join-Path $PgBin 'pg_restore.exe') @('--no-owner','--exit-on-error','--single-transaction','--dbname=finsight_restore_test',(Join-Path $complete[0].FullName 'database.dump')) $targetEnvironment
    $result = (Invoke-BackupProcess $psql @('-X','-t','-A','--set=ON_ERROR_STOP=1','--command',"select count(*) || ':' || string_agg(action,',' order by occurred_at) from public.audit_logs") $targetEnvironment).Trim()
    if ($result -ne '3:INSERT,UPDATE,DELETE') { throw "Restored audit history changed: $result" }
    $verify = Invoke-BackupProcess $psql @('-X','-t','-A','--set=ON_ERROR_STOP=1','--file',[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../supabase/verify_permanent_audit_history.sql'))) $targetEnvironment
    if ($verify -match '\|f') { throw 'Restored audit protections failed verification' }
    Write-Host 'PASS: real PostgreSQL export, archive parsing, full restore, exact audit-history preservation and restored audit protections'

    # A structurally incomplete source must produce a failed staging folder,
    # while preserving the previously successful backup. Synthetic database only.
    $null = Invoke-BackupProcess $psql @('-X','--set=ON_ERROR_STOP=1','--command','alter table public.audit_logs rename to test_missing_audit_logs') $envForTest
    $failed = $false
    try { $null = Invoke-BackupProcess (Join-Path $PSHOME 'powershell.exe') @('-NoProfile','-ExecutionPolicy','Bypass','-File',$script,'-ConfigPath',$configPath) }
    catch { $failed = $_.Exception.Message -match 'missing application table data' }
    if (-not $failed) { throw 'Incomplete database did not fail the backup' }
    $incomplete = @(Get-ChildItem -LiteralPath $config.OutputRoot -Directory | Where-Object { $_.Name -like '*.incomplete' })
    if ($incomplete.Count -ne 1) { throw 'Failed backup was not left in an incomplete directory' }
    $status = Get-Content -LiteralPath (Join-Path $incomplete[0].FullName 'status.json') -Raw | ConvertFrom-Json
    if ($status.status -ne 'failed') { throw 'Failed backup was reported as successful' }
    $null = Test-BackupFiles $complete[0].FullName
    Write-Host 'PASS: failed export cannot replace or masquerade as a successful backup'
} finally {
    if ($started) { Invoke-TestServerControl @('-D',$data,'-m','fast','-w','stop') }
    Write-Host "Only synthetic local databases were used. Recovery-drill artifacts: $testRoot"
}
