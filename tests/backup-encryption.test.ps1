. (Join-Path $PSScriptRoot '../scripts/backup/Backup.Common.ps1')
$protect = Join-Path $PSScriptRoot '../scripts/backup/Protect-FinSightArchive.ps1'
$root = Join-Path ([IO.Path]::GetTempPath()) ('finsight-encryption-test-' + [Guid]::NewGuid().ToString('N'))
New-PrivateDirectory $root
$inputFile = Join-Path $root 'fixture.zip'
$encrypted = Join-Path $root 'fixture.zip.gpg'
$decrypted = Join-Path $root 'restored.zip'
$key = ConvertTo-SecureString 'synthetic-only-passphrase-with-$-&-123456789' -AsPlainText -Force
$wrongKey = ConvertTo-SecureString 'wrong-synthetic-only-passphrase-123456789' -AsPlainText -Force
[IO.File]::WriteAllBytes($inputFile, [byte[]](0..255))
& $protect -InputPath $inputFile -OutputPath $encrypted -Passphrase $key
& $protect -InputPath $encrypted -OutputPath $decrypted -Passphrase $key -Decrypt
if ((Get-FileHash -LiteralPath $inputFile).Hash -ne (Get-FileHash -LiteralPath $decrypted).Hash) { throw 'Encryption round trip changed file bytes.' }
$failed = $false
try { & $protect -InputPath $encrypted -OutputPath (Join-Path $root 'wrong.zip') -Passphrase $wrongKey -Decrypt } catch { $failed = $true }
if (-not $failed -or (Test-Path -LiteralPath (Join-Path $root 'wrong.zip'))) { throw 'Wrong passphrase must fail and remove partial plaintext.' }
$failed = $false
try { & $protect -InputPath $encrypted -OutputPath $decrypted -Passphrase $key -Decrypt } catch { $failed = $true }
if (-not $failed) { throw 'Existing output must never be overwritten.' }
$bytes = [IO.File]::ReadAllBytes($encrypted)
$bytes[$bytes.Length - 5] = $bytes[$bytes.Length - 5] -bxor 1
[IO.File]::WriteAllBytes((Join-Path $root 'corrupt.gpg'), $bytes)
$failed = $false
try { & $protect -InputPath (Join-Path $root 'corrupt.gpg') -OutputPath (Join-Path $root 'corrupt.zip') -Passphrase $key -Decrypt } catch { $failed = $true }
if (-not $failed -or (Test-Path -LiteralPath (Join-Path $root 'corrupt.zip'))) { throw 'Corrupted ciphertext must fail and remove partial plaintext.' }
Write-Host 'PASS: real GnuPG byte-for-byte round trip; wrong keys, corruption, and output overwrite rejected.'
Write-Host "Only synthetic fixtures used. Test artifacts: $root"
