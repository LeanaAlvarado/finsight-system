. (Join-Path $PSScriptRoot '../scripts/backup/Backup.Common.ps1')
function Assert-True($Value, [string]$Message) { if (-not $Value) { throw "FAIL: $Message" } }
function Assert-Fails([scriptblock]$Action, [string]$Pattern) {
    $caught = $false
    try { & $Action | Out-Null } catch { $caught = $true; Assert-True ($_.Exception.Message -match $Pattern) "Unexpected error: $($_.Exception.Message)" }
    Assert-True $caught 'Expected the operation to fail'
}

$backupScripts = Get-ChildItem (Join-Path $PSScriptRoot '../scripts/backup') -Filter '*.ps1'
foreach ($script in $backupScripts) {
    $tokens = $null; $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$errors)
    Assert-True ($errors.Count -eq 0) "Parse error in $($script.Name): $errors"
}
Write-Host 'PASS: PowerShell syntax for all backup tools'
Assert-Fails { Assert-OutsideRepository (Join-Path $PSScriptRoot '../backups') } 'outside'
Assert-ServerKey 'sb_secret_example-for-test-only'
Assert-Fails { Assert-ServerKey 'sb_publishable_not-a-server-key' } 'secret key'
$h1 = Get-ObjectLocalName 'photos' '../CON:Test.JPG'
$h2 = Get-ObjectLocalName 'photos' '../con:test.jpg'
Assert-True ($h1 -match '^[a-f0-9]{64}\.bin$' -and $h1 -cne $h2) 'Remote path traversal and case collisions must be neutralized'
Assert-True ((Get-StorageObjectUrl 'azjmgkxyciynpiowqfii' 'my bucket' 'folder/a #1.jpg') -eq 'https://azjmgkxyciynpiowqfii.supabase.co/storage/v1/object/authenticated/my%20bucket/folder/a%20%231.jpg') 'Object paths must be URL encoded'
Assert-Fails { Get-StorageObjectUrl 'azjmgkxyciynpiowqfii' 'inventory' '../file.jpg' } 'dot segment'
Assert-Fails { Assert-InventoryUnchanged @{objects=@(1)} @{objects=@(1,2)} } 'changed'
Assert-InventoryUnchanged @{objects=@(1)} @{objects=@(1)}
Write-Host 'PASS: secret-key validation, safe paths, object naming, and concurrent Storage change detection'

$powershell = Join-Path $PSHOME 'powershell.exe'
$fakeSecret = 'test-secret-with-$-and-&-characters'
$out = Invoke-BackupProcess $powershell @('-NoProfile','-Command','[Console]::Write($env:PGPASSWORD)') @{PGPASSWORD=$fakeSecret}
Assert-True ($out -ceq $fakeSecret) 'Environment values must reach child process without shell interpretation'
$beforePassword = [Environment]::GetEnvironmentVariable('PGPASSWORD')
try {
    $null = Invoke-BackupProcess $powershell @('-NoProfile','-Command','[Console]::Error.Write($env:PGPASSWORD); exit 3') @{PGPASSWORD=$fakeSecret}
    throw 'Failure was not detected'
} catch {
    Assert-True ($_.Exception.Message -match 'exit 3' -and -not $_.Exception.Message.Contains($fakeSecret)) 'Tool failure must be detected and secrets redacted'
}
Assert-True ([Environment]::GetEnvironmentVariable('PGPASSWORD') -ceq $beforePassword) 'Child secrets must not change the parent environment'
Write-Host 'PASS: native process errors, secret redaction and isolated environment'

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('finsight-backup-test-' + [Guid]::NewGuid().ToString('N'))
New-PrivateDirectory $tempRoot
New-PrivateDirectory (Join-Path $tempRoot 'storage')
$object = [pscustomobject]@{ bucket_id='inventory'; name='folder/test.png'; metadata=@{size=4} }
$inventory = [pscustomobject]@{buckets=@(@{id='inventory'}); objects=@($object)}
Write-BackupJson (Join-Path $tempRoot 'storage-inventory.json') $inventory
foreach ($name in @('database.dump','database-toc.txt','roles.sql')) { [IO.File]::WriteAllText((Join-Path $tempRoot $name), 'test fixture') }
$objectName = 'storage/' + (Get-ObjectLocalName $object.bucket_id $object.name)
[IO.File]::WriteAllBytes((Join-Path $tempRoot $objectName), [byte[]]@(0,1,2,3))
$files = @(@('database.dump','database-toc.txt','roles.sql','storage-inventory.json', $objectName) | ForEach-Object { Get-BackupFileEntry $tempRoot $_ })
$manifest = @{formatVersion=1;status='complete';storageObjectCount=1;files=$files}
Write-BackupJson (Join-Path $tempRoot 'manifest.json') $manifest
$null = Test-BackupFiles $tempRoot
[IO.File]::WriteAllBytes((Join-Path $tempRoot $objectName), [byte[]]@(0,1,2,4))
Assert-Fails { Test-BackupFiles $tempRoot } 'damaged or changed'
[IO.File]::WriteAllBytes((Join-Path $tempRoot $objectName), [byte[]]@(0,1,2,3))
$manifest.storageObjectCount = 2
Write-BackupJson (Join-Path $tempRoot 'manifest.json') $manifest
Assert-Fails { Test-BackupFiles $tempRoot } 'count'
$manifest.storageObjectCount = 1
$manifest.files = @($files | Where-Object { $_.path -ne $objectName })
Write-BackupJson (Join-Path $tempRoot 'manifest.json') $manifest
Assert-Fails { Test-BackupFiles $tempRoot } 'absent'
$manifest.files = @($files) + @(@{path='../outside';bytes=0;sha256='fake'})
Write-BackupJson (Join-Path $tempRoot 'manifest.json') $manifest
Assert-Fails { Test-BackupFiles $tempRoot } 'Invalid path'
$manifest.files = $files
$manifest.status = 'failed'
Write-BackupJson (Join-Path $tempRoot 'manifest.json') $manifest
Assert-Fails { Test-BackupFiles $tempRoot } 'completed'
Write-Host 'PASS: complete file verification; reject corruption, missing objects, wrong counts, traversal and incomplete backups'

# Mock only the HTTP transport: no real credentials or remote calls.
$script:requests = @()
function Invoke-WebRequest {
    param([switch]$UseBasicParsing, $Uri, $Headers, $OutFile, $TimeoutSec, $MaximumRedirection)
    $script:requests += [pscustomobject]@{Uri=$Uri;Headers=$Headers;Redirects=$MaximumRedirection}
    [IO.File]::WriteAllBytes($OutFile, [byte[]]@(0,1,2,3))
}
$storageConfig = [pscustomobject]@{ ProjectRef='azjmgkxyciynpiowqfii';StorageKey=(ConvertTo-SecureString 'sb_secret_test-only' -AsPlainText -Force) }
Save-StorageObject $storageConfig $object (Join-Path $tempRoot 'download.bin')
Assert-True ($script:requests.Count -eq 1 -and $script:requests[0].Redirects -eq 0) 'Credentials must not follow redirects'
Assert-True ($script:requests[0].Headers.apikey -eq 'sb_secret_test-only' -and -not $script:requests[0].Headers.ContainsKey('Authorization')) 'Opaque secret keys must not be used as JWTs'
$script:tries = 0
function Invoke-WebRequest { param($Uri,$Headers,$OutFile,$TimeoutSec,$MaximumRedirection,[switch]$UseBasicParsing); $script:tries++; throw 'synthetic HTTP failure with fake secret' }
function Start-Sleep { param($Seconds) }
Assert-Fails { Save-StorageObject $storageConfig $object (Join-Path $tempRoot 'failed-download.bin') } 'incomplete'
Assert-True ($script:tries -eq 3) 'File downloads must retry at most three times'
Write-Host 'PASS: Storage download headers, safe redirects, bounded retries and explicit failure'
Write-Host "Only synthetic fixtures used. Test artifacts: $tempRoot"
