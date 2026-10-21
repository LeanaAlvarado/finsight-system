# Encrypted Supabase data backups with GitHub Actions

This repository includes `.github/workflows/finsight-backup.yml`. It exports the database and Storage file bytes with the existing read-only Windows backup scripts, verifies file hashes, packages the completed folder, encrypts it with GnuPG AES-256, and checks that decryption reproduces the exact archive bytes before uploading **only `backup.zip.gpg`** as a workflow artifact. It never commits database exports or credentials to GitHub. This is a prepared workflow, not evidence that a live backup has run.

## Activate

1. Review and merge the backup scripts and workflow into the repository's default branch (`main`). Scheduled workflows run from that branch. GitHub Actions must be enabled.
2. Open [repository Actions secrets](https://github.com/LeanaAlvarado/finsight-system/settings/secrets/actions). Use **New repository secret** for each entry below. Enter values directly in GitHub, never in chat, source code, or a commit.

| Secret name | Value |
| --- | --- |
| `SUPABASE_DB_HOST` | Host only from this Supabase project's **Connect > Session pooler**, port 5432. No `postgresql://` prefix, username, or password. |
| `SUPABASE_DB_PASSWORD` | The project's database password. This is different from your Supabase website login. |
| `SUPABASE_STORAGE_KEY` | This project's secret API key or legacy `service_role` key. A browser publishable/anon key cannot back up all private files. |
| `FINSIGHT_BACKUP_PASSPHRASE` | A unique, randomly generated single-line password of at least 32 characters. Save a second copy in a password manager outside GitHub; losing it makes the backups unrecoverable. Keep old passphrases for older backups after rotation. |

3. Open [Actions](https://github.com/LeanaAlvarado/finsight-system/actions), select **FinSight encrypted data backup**, then **Run workflow** on `main`.
4. Require a green run with the encrypted artifact present. Download it and test recovery in a separate database/project using [the recovery procedure](free-plan-backups.md#recovery-procedure). A green run verifies exported files and encryption, not a full database restore.

The workflow uses project `azjmgkxyciynpiowqfii`; ensure the host, database password, and API key all belong to that project. Its PostgreSQL client must be the same or newer major version as the server. The workflow uses the hosted Windows runner's PostgreSQL tools and deliberately fails on a server/client version mismatch. If that happens, update the runner/tool configuration rather than skipping validation.

## Schedule and retention

- Runs daily at **6:17 PM Philippine time** (10:17 UTC), plus manual runs. The computer can be off. GitHub may delay scheduled runs; check the latest successful run regularly and enable Actions failure notifications.
- Artifacts are retained for **7 days**, subject to repository limits. Download periodic copies to a separate private location before expiration. These artifacts are a short rolling recovery window, not permanent archival storage.
- Public repository schedules may be disabled after 60 days without activity. Re-enable and check the workflow after inactivity. Do not depend on an unchecked schedule.
- People with read access to the repository can download its artifacts. Because this repository is public, treat the ciphertext as publicly downloadable; use a strong unique encryption passphrase and keep it private.
- GitHub Actions minutes and artifact storage have plan limits. Monitor usage and billing rather than assuming all backup sizes are free. This workflow does not upgrade Supabase or purchase services.
- Credentials and unencrypted working files exist only on the ephemeral hosted runner. Do not change this workflow to a persistent self-hosted runner without adding suitable private storage and cleanup.

## Open a downloaded backup on Windows

Extract the GitHub artifact wrapper first to obtain `backup.zip.gpg`. From the repository root, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup\Protect-FinSightArchive.ps1 -Decrypt -InputPath "C:\PrivateRecovery\backup.zip.gpg" -OutputPath "C:\PrivateRecovery\backup.zip"
```

Enter the encryption passphrase at the hidden prompt. GnuPG is required (Git for Windows includes it). Output must be outside the repository and must not already exist. Extract `backup.zip` to a private directory, then verify the enclosed dated folder:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup\Test-FinSightBackup.ps1 -BackupPath "C:\PrivateRecovery\extracted\DATED-FOLDER"
```

Follow the separate-test-project recovery instructions in [free-plan-backups.md](free-plan-backups.md#recovery-procedure). Project settings, SMTP/OAuth configuration, Edge Function secrets, API keys and encryption root keys still require separate recovery records. Database and Storage are exported separately; the scripts reject detected Storage changes but cannot produce a single atomic snapshot across services.

## References

- [GitHub scheduled events, default branch and inactivity limits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Artifact access and downloads](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)
- [Artifact retention](https://docs.github.com/en/actions/tutorials/store-and-share-data)
- [Windows hosted runner tools](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)
- [GnuPG command options](https://www.gnupg.org/documentation/manuals/gnupg26/gpg.1.html)
