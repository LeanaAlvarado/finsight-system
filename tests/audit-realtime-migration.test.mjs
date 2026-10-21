import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const migration = await readFile(new URL('../supabase/migrations/20261021000000_audit_viewer_realtime.sql', import.meta.url), 'utf8');
for (const publication of [false, true]) {
  const db = new PGlite();
  await db.exec(`create table inventory(id text primary key);
    create table audit_logs(id uuid primary key, occurred_at timestamptz not null);
    insert into inventory values ('keep-this-record');
    insert into audit_logs values ('11111111-1111-4111-8111-111111111111', now());
    alter table audit_logs enable row level security;`);
  if (publication) await db.exec('create publication supabase_realtime for table inventory;');
  await db.exec(migration);
  await db.exec(migration);
  assert.equal((await db.query('select * from inventory')).rows[0].id, 'keep-this-record');
  assert.equal((await db.query('select * from audit_logs')).rows.length, 1);
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='audit_logs'::regclass")).rows[0].relrowsecurity, true);
  assert.equal((await db.query("select count(*)::int as total from pg_indexes where indexname='audit_logs_occurred_at_id_idx'")).rows[0].total, 1);
  const names = (await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename")).rows.map(row => row.tablename);
  assert.deepEqual(names, publication ? ['audit_logs', 'inventory'] : []);
  await db.close();
}
console.log('PASS audit migration: repeatable index and publication membership; existing tables, records, RLS and subscriptions preserved; absent publication tolerated');
