# Permanent audit history

## Deploy to the existing Supabase project

1. Open the SQL Editor for Supabase project `azjmgkxyciynpiowqfii`.
2. Run the **entire** file [`20260921010000_enforce_permanent_audit_history.sql`](../supabase/migrations/20260921010000_enforce_permanent_audit_history.sql) as the database owner. It works with the existing audit migration or on its own after the business schema. It runs in one transaction and can be rerun safely. It does not delete or update existing audit entries.
3. Run [`verify_permanent_audit_history.sql`](../supabase/verify_permanent_audit_history.sql). Every `passed` value must be true.
4. Deploy the frontend commit through the existing GitHub deployment, then reload the site. All HTML entry points use the new script version.
5. In Inventory, create a disposable material, update it, then delete it. In Reports & Audit Logs, search its name. The created, updated, and deleted entries must all remain after a reload. Confirm the User column and timestamps. Use a test account/material rather than existing business records.

**Pushing frontend code to GitHub does not apply Supabase SQL.** This repository has no configured database migration deployment. The SQL Editor step is required to activate the database guarantees.

## Behavior and coverage

- Every committed insert, update, or delete on every current application table in `public` records independent before/after snapshots in `audit_logs`. This includes inventory, materials, projects, expenses, payroll, feedback, files, contracts, users, roles, alerts, cloud sync and local-storage-backed settings. An audit failure rolls back the associated database mutation.
- No foreign keys in `audit_logs` point to source records or users. Removing them preserves both old evidence and the deletion event.
- No application role, including System Administrator or Owner/Manager, can update, delete, or clear audit history. Direct inserts are revoked as well; database triggers and the authenticated event RPC append records. A statement trigger also rejects `TRUNCATE`, including when row-level security would not protect it. Business-table truncation is blocked because it bypasses per-row deletion evidence.
- Login/logout, session expiry, denied module access, report generation, module visits, control activations, form attempts, field/filter changes and print requests are recorded as application events. A click or submission attempt does **not** claim that the resulting operation succeeded. Database entries establish which changes committed. Inputs, credentials and query-string tokens are not captured by UI tracking.
- Application events use the authenticated Supabase identity. Client-supplied metadata cannot override the stored event label, source or actor email. Credential keys are recursively redacted from new snapshots, including nested user mirrors. Existing history is left intact.
- The viewer reads persistent audit records independently of current business records, displays actor/time information, and fetches all pages with a stable cursor so Supabase's response cap does not hide older history.
- Activity descriptions use the saved snapshots: item creation/deletion includes the item name and quantity; updates list changed fields with before/after values, including nested quotation settings. Longer updates have expandable details. Existing rows receive the same descriptions without rewriting history.
- The default **Recorded actions** view shows committed business changes, module visits and other recorded actions. **Interface interactions** contains clicks and submission attempts; **Background synchronization** contains duplicate saved copies, cloud sync and writes that changed only timestamps. **All recorded events** includes every loaded audit row. Changes to standalone billing/settings remain in Recorded actions. No rows are deleted by these filters.

The descriptive activity viewer is a frontend-only update. Once the permanent-history migration above has been applied, deploying the viewer requires no additional Supabase SQL.

## Practical limits

Previously deleted history cannot be recreated without a database backup. Existing records are not presented as invented historical events. New tables added by future migrations must install `finsight_audit_crud` and `finsight_audit_no_truncate`; rerunning this migration also installs them. Extension-owned tables and Supabase-managed `auth`/`storage` internals are outside the application-table trigger scope. The `project_files` rows record the application's file metadata changes.

Read-only browser events need a network connection and a valid Supabase session. They use keepalive requests during navigation; if saving fails while the page remains open, the app displays a warning. Unsynced local-only drafts, unauthenticated failed login attempts and actions performed outside the app are not guaranteed by browser instrumentation. Failed authentication is available through Supabase Auth logs. Business changes committed to Supabase are always covered by the database triggers.

The database owner can deliberately change schema, disable protections or drop tables; an application rule cannot remove PostgreSQL ownership powers. Keep database-owner credentials separate from application administrators. This change prevents normal database operations from altering audit records even when a caller bypasses row-level security. Read access remains authenticated, as in the existing migration.

Implementation follows [PostgreSQL trigger semantics](https://www.postgresql.org/docs/current/sql-createtrigger.html) and [Supabase function security guidance](https://supabase.com/docs/guides/database/functions).

## Verification performed locally

`tests/audit-history.test.mjs` uses an isolated PostgreSQL runtime (PGlite 0.5.8). Run with Node and `@electric-sql/pglite`, or set `PGLITE_MODULE` to its `dist/index.js`. It checks fresh install and upgrade from a cascading legacy FK, migration reruns, retained snapshots after inventory deletion, application/service/database-owner immutability, denied direct inserts, truncation guards, credential redaction, trigger coverage, RPC identity validation, transactional rollback, and fetching 1,523 records with a lower server cap and concurrent inserts. It does not mutate the hosted database.
