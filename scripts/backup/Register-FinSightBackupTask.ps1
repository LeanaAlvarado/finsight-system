[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'FinSightBackup/config.clixml'),
    [ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')][string]$Time = '18:00'
)
. (Join-Path $PSScriptRoot 'Backup.Common.ps1')
$config = Read-BackupConfig $ConfigPath
$completed = @(Get-ChildItem -LiteralPath $config.OutputRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike '*.incomplete' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'manifest.json')) } | Sort-Object Name -Descending)
if (-not $completed.Count) { throw 'Run a successful manual backup before registering a daily schedule.' }
$null = Test-BackupFiles $completed[0].FullName
$name = 'FinSight daily private backup'
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { throw 'The backup task already exists. Review it in Windows Task Scheduler; it will not be silently replaced.' }
$script = Join-Path $PSScriptRoot 'Backup-FinSight.ps1'
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + (ConvertTo-NativeArgument $script) + ' -ConfigPath ' + (ConvertTo-NativeArgument ([IO.Path]::GetFullPath($ConfigPath)))
$action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At ([DateTime]::ParseExact($Time, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture))
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 4)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Read-only Supabase database and Storage backup; requires this Windows user to be signed in.' | Out-Null
Write-Host "Daily backup scheduled at $Time (computer local time). Computer must be on, online and this Windows user signed in."
Write-Host 'Check Last Run Result in Windows Task Scheduler and verify dated backup folders regularly.'
