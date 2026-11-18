# FinSight backups on Supabase Free

For scheduled backups that run while this computer is off, see [encrypted GitHub Actions data backups](github-data-backups.md). That workflow requires separate GitHub Secrets setup and a successful first run.

These Windows tools make a private, manual database-and-files backup. They do not change the website or live database. Creating the scripts does **not** mean a live backup has already happened. A dated folder and a successful verification are required.

## First setup on this computer

1. Obtain PostgreSQL client tools from [the official Windows downloads](https://www.postgresql.org/download/windows/). The `bin` folder needs `pg_dump.exe`, `pg_dumpall.exe`, `pg_restore.exe`, `psql.exe` and their DLLs. Use the same or a newer major version than the Supabase server. The setup also detects locally prepared portable tools when available. No local database server needs to run for a real Supabase backup.
2. Open Supabase project `azjmgkxyciynpiowqfii`, then **Connect > Session pooler**. Have the **host** and **database password** ready. Use port **5432**, not transaction pooler port 6543. Do not reset an existing password merely for backup setup unless you intend to update other connections using it.
3. In **Project Settings > API Keys**, obtain a **secret key** or legacy **service_role key**. A publishable/anon browser key cannot export all private files. Enter secrets only into the local hidden prompts below, never chat, GitHub, HTML or JavaScript.
4. In the VS Code PowerShell terminal, starting inside `.push-worktree`, run:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup\Initialize-FinSightBackup.ps1
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup\Backup-FinSight.ps1 -CheckOnly
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup\Backup-FinSight.ps1
   ```

The default private location is `%LOCALAPPDATA%\FinSightBackup`. `config.clixml` protects credential fields with Windows DPAPI, tied to this Windows user and computer. Backup copies go in its `copies` subfolder. Credentials must be configured again if you move to another computer; the backup data itself is portable. A custom output directory is allowed **outside the source repository**. Prefer a dedicated folder, with enough free disk space, then copy completed backup folders to a separate private drive/location.

The setup never uploads backups to GitHub. Backup data is not encrypted as a portable archive: newly created backup directories have restricted Windows permissions. Use a private encrypted drive/storage destination when transporting or keeping an off-computer copy.

## What a successful backup contains

- `database.dump`: a native PostgreSQL custom archive of the accessible database, including schema, functions, RLS policies, application records, authentication data, and permanent audit history. No schema/data exclusions are silently added. A permission or version failure aborts the run.
- `roles.sql`: database role definitions/memberships, without role passwords. Supabase-managed roles already exist on a new Supabase project; review this file before restoring any custom roles.
- `database-toc.txt`: archive contents, checked for required application tables. The whole dump is also parsed/decompressed locally with `pg_restore`.
- `storage-inventory.json`: bucket configuration and object metadata from all Storage buckets. Downloaded files are stored under `storage/` using hashes of their exact original bucket/name, avoiding Windows filename restrictions and case collisions. The inventory preserves the original names. Last-access timestamps are excluded because reads can change them.
- `source-code.zip` and its recorded commit, when the local Git checkout is available. Only committed source is included.
- `manifest.json`: project reference, export versions, timestamps, object counts, file sizes and SHA-256 checksums. It deliberately records `restoreTested: false` until a separate recovery drill has actually been performed.

Database export uses a consistent PostgreSQL snapshot. Storage is a separate service, so its inventory is checked again after downloads: if files/buckets changed, the run fails and must be retried during a quieter period. This check cannot create a single atomic snapshot across both services. The script never updates/deletes production rows or Storage objects.

Failures keep a clearly named `.incomplete` folder with failed/incomplete status and return a nonzero exit code. Only a fully verified run is renamed to a completed dated folder. Old backups are never automatically deleted. Watch free disk space and available Supabase download quota as backup size grows.

## Check a backup

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup\Test-FinSightBackup.ps1 -BackupPath "C:\path\to\completed-backup"
```

This detects missing or changed files and missing Storage objects. Checksums detect accidental corruption; they are not proof against an attacker who can also rewrite the manifest. A real restore test is still necessary.

## Optional daily backup

After the first successful manual backup, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup\Register-FinSightBackupTask.ps1 -Time "18:00"
```

This creates a Windows Task Scheduler task at 6 PM in the computer's timezone. The computer must be on, online and the same Windows account signed in. Missed runs can run when the task is next available; this is not a cloud backup that works while the computer is off. Keep the scripts and config at their configured locations. Task Scheduler's **Last Run Result** must be 0 and a new completed dated backup folder must exist; a registered task alone does not prove backups are working.

## Recovery procedure

Restore into a **separate empty test project/database first**, preserving the live project and these immutable backup copies. This repository does not provide a one-click production restore.

1. Verify the files and inspect `database-toc.txt`. Provision a compatible PostgreSQL/Supabase target and the required extensions. Supabase project settings, API keys, SMTP/OAuth configuration, Edge Function secrets and encryption root keys are not reconstructed from this dump; retain/configure them separately. See [Supabase's backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) for managed-schema and encrypted-data requirements.
2. For the application `public` schema, use `pg_restore` with an explicitly reviewed archive list and `--no-owner --exit-on-error --single-transaction` against the new target. Preserve the archive's normal **pre-data, data, post-data order**. Do not install audit triggers before restoring data: this app has `ENABLE ALWAYS` audit triggers, so `session_replication_role=replica` alone will not disable them. Loading data before post-data trigger definitions preserves original history without inventing duplicate audit events.
3. Restore required `auth` data into compatible Supabase-managed tables using a reviewed `pg_restore --use-list` selection. Exclude existing migration bookkeeping and managed schema definitions as appropriate to the target. Review custom roles/grants instead of blindly replacing Supabase-managed roles. A full archive is retained so this review does not discard source data.
4. Recreate the Storage buckets from the saved configuration and re-upload each local `.bin` file through Supabase Storage using the original `bucket_id` and `name` in the inventory. Derive its local filename with `Get-ObjectLocalName` from `Backup.Common.ps1`. Restore files through the Storage API; restoring `storage.objects` metadata alone does not restore file bytes. Existing URLs referring to the old project must be deliberately migrated when switching projects. Do not silently overwrite a live bucket.
5. Compare database row counts, verify inventory/payroll/audit samples, verify original file bytes, and run `supabase/verify_permanent_audit_history.sql` on the target. Test login, uploaded files, inventory create/update/delete and audit retention. Record the recovery-test date and outcome separately before treating the backup as proven recovery.

This requires database-owner access on the isolated recovery target. Normal application administrators remain unable to edit/delete audit history; the backup tools do not weaken those protections.

## References

- [Supabase Free-plan export guidance and Storage backup limits](https://supabase.com/docs/guides/platform/backups)
- [Supabase database connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)
- [PostgreSQL pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)
