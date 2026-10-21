# Audit Log viewer loading

The viewer previously read every permanent audit record in successive 500-row requests and waited for five business-report queries before rendering the first ten rows. The audit viewer now starts independently, reads at most 50 raw audit records per batch using the existing stable `(occurred_at, id)` cursor, and renders ten matching records per page. Next loads additional batches only when needed (at most three per click); Load older records continues browsing explicitly. A lower PostgREST response cap does not silently cut off history.

The first batch's presentation data is cached in sessionStorage for 90 seconds, with a 200,000-character limit, scoped to the authenticated Supabase user and application role. Opening the viewer can show that batch immediately while revalidating it. Raw before/after snapshots are not cached. The cache uses a separate `finsight:` key, so the application's `lemyu_` cloud mirror does not upload or audit cache writes. Signed-out or changed accounts lose access to the displayed cached records. Disabled browser storage falls back to normal loading.

Filters search the loaded history. The summary and explanatory text make that scope explicit; Load older records extends the search. Oldest first starts with an ascending database cursor rather than simply reversing the recent batch. Module A-Z sorts loaded records. The Audit Events metric is explicitly marked as a loaded count, with `+` while more history is available. This avoids presenting a partial count as the database total.

## Enable live WebSocket updates

Apply `supabase/migrations/20261021000000_audit_viewer_realtime.sql` through the project's migration process or Supabase SQL Editor as postgres. It adds only the audit table to the existing `supabase_realtime` publication and ensures the audit cursor index exists. Reapplying it is safe. It does not change existing publications' other members, RLS, grants, immutable-history protections, audit-writing triggers, or business records.

The viewer subscribes only to audit INSERT events, coalesces a burst into a refresh of the first batch on the newest first page, and displays a new-activity button instead of shifting older pages being reviewed. A lightweight newest-ID check runs every 60 seconds while visible and on returning to the tab to recover missed events, including when the audit table has not yet been enabled for Realtime. Page exit removes its channel, pending request, timers and auth listener; a browser back/forward-cache restore reconnects the viewer. Requests time out after 15 seconds and preserve loaded rows on failure.

Only the reports/audit page uses the new viewer. Business report calculations and queries, other page modules, the audit writer, and the full-history reader/exporter remain unchanged. The common page loader changes the module cache version only for `reports-audit.html`.

## Validation

```text
node tests/audit-feed.test.mjs
node --experimental-vm-modules tests/audit-viewer-page.test.mjs
node --experimental-vm-modules tests/audit-frontend.test.mjs
node tests/audit-presentation.test.mjs
node tests/audit-history.test.mjs
node tests/audit-realtime-migration.test.mjs
```

The last two commands need `@electric-sql/pglite` installed, or `PGLITE_MODULE` set to its local `dist/index.js` file URL. Tests use isolated fixtures; they do not write to production. They cover one-batch initial loading, 1,523 rows with tied timestamps and a lower server cap, concurrent inserts, cache isolation and expiry, ordering, stale responses, errors/retries, audit-only realtime events and cleanup, rendering while business queries are stalled, and existing append-only database protections.

Reference: [Supabase Postgres Changes setup and table publication](https://supabase.com/docs/guides/realtime/postgres-changes).
