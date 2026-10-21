[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [switch]$Decrypt,
    [Security.SecureString]$Passphrase
)
. (Join-Path $PSScriptRoot 'Backup.Common.ps1')
$InputPath = [IO.Path]::GetFullPath($InputPath)
$OutputPath = Assert-OutsideRepository $OutputPath
if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) { throw 'Input archive is missing.' }
if (Test-Path -LiteralPath $OutputPath) { throw 'Output already exists; refusing to overwrite it.' }
if (-not $Passphrase) { $Passphrase = Read-Host 'Backup encryption passphrase' -AsSecureString }
$secret = Get-PlainSecret $Passphrase
if ($secret.Length -lt 32 -or $secret -match '[\r\n]') { throw 'Use a single-line encryption passphrase of at least 32 characters.' }
$gpg = Get-Command gpg.exe -ErrorAction SilentlyContinue
$executable = if ($gpg) { $gpg.Source } else { Join-Path $env:ProgramFiles 'Git/usr/bin/gpg.exe' }
if (-not (Test-Path -LiteralPath $executable)) { throw 'GnuPG is required (included with Git for Windows).' }
New-PrivateDirectory (Split-Path -Parent $OutputPath)
# An isolated keyring avoids personal configuration and cached passphrases.
$gpgHome = Join-Path ([IO.Path]::GetTempPath()) ('fsg-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
New-PrivateDirectory $gpgHome
function ConvertTo-GpgPath([string]$Path) {
    # Git for Windows bundles an MSYS executable, which expects POSIX paths.
    if ($executable.Replace('\', '/') -match '/Git/usr/bin/') {
        return '/' + $Path.Substring(0, 1).ToLowerInvariant() + $Path.Substring(2).Replace('\', '/')
    }
    return $Path
}
$process = $null
try {
    $arguments = @('--no-options', '--homedir', (ConvertTo-GpgPath $gpgHome), '--batch', '--no-tty', '--pinentry-mode', 'loopback', '--passphrase-fd', '0', '--no-symkey-cache', '--output', (ConvertTo-GpgPath $OutputPath))
    if ($Decrypt) { $arguments += '--decrypt' } else { $arguments += @('--cipher-algo', 'AES256', '--symmetric') }
    $arguments += @('--', (ConvertTo-GpgPath $InputPath))
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $executable
    $info.Arguments = (($arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardError = $true
    # Do not pass CI credentials to the encryption process.
    foreach ($name in @($info.EnvironmentVariables.Keys)) {
        if ([string]$name -match '^(FINSIGHT_|SUPABASE_)') { $info.EnvironmentVariables.Remove([string]$name) }
    }
    $process = [Diagnostics.Process]::Start($info)
    $stderr = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.WriteLine($secret)
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(600000)) { $process.Kill(); throw 'Archive encryption/decryption timed out.' }
    if ($process.ExitCode -ne 0) { throw ('Archive encryption/decryption failed: ' + $stderr.Result.Replace($secret, '[REDACTED]')) }
    Write-Host 'Archive operation completed.'
} catch {
    if (Test-Path -LiteralPath $OutputPath -PathType Leaf) { Remove-Item -LiteralPath $OutputPath -Force }
    throw
} finally {
    $secret = $null
    if ($process) { $process.Dispose() }
    $gpgconf = Join-Path (Split-Path -Parent $executable) 'gpgconf.exe'
    if (Test-Path -LiteralPath $gpgconf) {
        $null = Invoke-BackupProcess $gpgconf @('--homedir', (ConvertTo-GpgPath $gpgHome), '--kill', 'gpg-agent')
    }
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolvedHome = [IO.Path]::GetFullPath($gpgHome)
    if (-not $resolvedHome.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolvedHome) -notmatch '^fsg-[a-f0-9]{12}$') { throw 'Refusing cleanup outside the generated temporary keyring.' }
    [IO.Directory]::Delete($resolvedHome, $true)
}
