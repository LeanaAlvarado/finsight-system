[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$BackupPath)
. (Join-Path $PSScriptRoot 'Backup.Common.ps1')
$status = Get-Content -LiteralPath (Join-Path $BackupPath 'status.json') -Raw | ConvertFrom-Json
if ($status.status -ne 'complete' -or $BackupPath.TrimEnd('\', '/').EndsWith('.incomplete')) { throw 'Backup did not complete successfully.' }
$manifest = Test-BackupFiles ([IO.Path]::GetFullPath($BackupPath))
Write-Host "PASS: all listed files and $($manifest.storageObjectCount) Storage object(s) match the recorded SHA-256 hashes."
Write-Host 'This verifies file integrity, not a database restore. Preserve manifest.json with the backup.'
