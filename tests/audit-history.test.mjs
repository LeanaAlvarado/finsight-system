import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readAuditLogs } from "../js/audit-history.js";

// npm install --no-save @electric-sql/pglite, or point PGLITE_MODULE to a
// downloaded dist/index.js. Uses an isolated PostgreSQL database in memory.
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const migration = await readFile(new URL("../supabase/migrations/20260921010000_enforce_permanent_audit_history.sql", import.meta.url), "utf8");
const previous = await readFile(new URL("../supabase/migrations/20260921000000_append_only_audit_logs.sql", import.meta.url), "utf8");
const schema = await readFile(new URL("../supabase/cloud_required_schema.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/verify_permanent_audit_history.sql", import.meta.url), "utf8");
const tables = schema.slice(schema.indexOf("create table if not exists public.projects"), schema.indexOf("alter table public.projects"));
const actor = "11111111-1111-4111-8111-111111111111";

async function database(withLegacy = false) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    ${tables}
    grant select, insert, update, delete on all tables in schema public to authenticated;
    select set_config('request.jwt.claims', '{"sub":"${actor}","email":"admin@example.test"}', false);
  `);
  if (withLegacy) {
    // gen_random_uuid is built into PostgreSQL; PGlite does not need pgcrypto.
    await db.exec(previous.replace("create extension if not exists pgcrypto;", ""));
    await db.exec(`
      insert into inventory(id, name, qty) values ('legacy-item', 'Legacy material', 4);
      alter table audit_logs add constraint legacy_source_fk foreign key(record_id)
        references inventory(id) on delete cascade;
    `);
  }
  await db.exec(migration);
  return db;
}

for (const legacy of [false, true]) {
  const db = await database(legacy);
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  await db.exec(migration); // Safe rerun, without removing existing history.
  for (const check of await rows(verify)) assert.equal(check.passed, true, check.check_name);
  if (legacy) {
    await db.exec("delete from inventory where id = 'legacy-item'");
    assert.equal((await rows("select * from audit_logs where record_id='legacy-item'")).length, 2);
  }
  await db.exec("set role authenticated");
  await db.exec("insert into inventory(id,name,qty) values ('test-item','Cable',10)");
  await db.exec("update inventory set qty=8 where id='test-item'");
  await db.exec("delete from inventory where id='test-item'");
  const history = await rows("select * from audit_logs where record_id='test-item' order by occurred_at, id");
  assert.deepEqual(history.map(row => row.action), ['INSERT', 'UPDATE', 'DELETE']);
  assert.equal(history[0].new_data.qty, 10);
  assert.equal(history[1].old_data.qty, 10);
  assert.equal(history[2].old_data.name, 'Cable');
  assert.equal(history[2].old_data.qty, 8);
  assert.equal(history[2].actor_id, actor);
  assert.equal(history[2].metadata.actor_email, 'admin@example.test');
  assert.equal((await rows("select * from inventory where id='test-item'")).length, 0);
  await db.exec("reset role");

  for (const role of ['authenticated', 'anon', 'service_role', null]) {
    if (role) await db.exec(`set role ${role}`);
    for (const statement of ["delete from audit_logs", "update audit_logs set action='EVENT'", "truncate audit_logs"]) {
      await assert.rejects(db.exec(statement), /permission denied|permanent/i);
    }
    if (role) {
      await assert.rejects(db.exec("insert into audit_logs(action,table_name) values ('DELETE','inventory')"), /permission denied/i);
    }
    await db.exec("reset role");
  }
  assert.deepEqual(await rows("select * from audit_logs where record_id='test-item' order by occurred_at, id"), history);
  await assert.rejects(db.exec("truncate inventory"), /permanent/i);

  await db.exec(`
    insert into users(id,email,password_hash) values ('u1','staff@example.test','secret-hash');
    update users set password_hash='new-secret-hash' where id='u1';
    insert into app_local_storage(storage_key,storage_value)
      values ('lemyu_users','[{"email":"staff@example.test","password":"plain-secret"}]');
    insert into cloud_sync_audit(source_key,synced_count) values ('test', 1);
  `);
  const snapshots = await rows("select * from audit_logs where record_id='u1' order by occurred_at");
  assert.equal(snapshots[0].new_data.password_hash, '[REDACTED]');
  assert.equal(snapshots[1].metadata.credential_fields_changed, true);
  const mirror = await rows("select * from audit_logs where table_name='public.app_local_storage'");
  assert.equal(mirror[0].new_data.storage_value[0].password, '[REDACTED]');
  assert.equal((await rows("select * from audit_logs where table_name='public.cloud_sync_audit'")).length, 1);
  const coverage = await rows(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname<>'audit_logs'
    and not exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='finsight_audit_crud')`);
  assert.deepEqual(coverage, []);

  await db.exec("set role authenticated");
  await db.query("select record_audit_event($1,$2,$3,$4)", ['Module opened','page:Inventory',null,
    { source: 'database_trigger', actor_email: 'forged@example.test', event: 'forged', password: 'do-not-store' }]);
  const event = (await rows("select * from audit_logs where table_name='page:Inventory'"))[0];
  assert.equal(event.action, 'EVENT');
  assert.equal(event.metadata.source, 'application_event');
  assert.equal(event.metadata.actor_email, 'admin@example.test');
  assert.equal(event.metadata.event, 'Module opened');
  assert.equal(event.metadata.password, '[REDACTED]');
  await db.exec("reset role; set role anon");
  await assert.rejects(db.exec("select record_audit_event('Forged login')"), /permission denied/i);
  await db.exec("reset role; select set_config('request.jwt.claims','{}',false)");
  await assert.rejects(db.exec("select record_audit_event('Missing session')"), /Sign in/i);

  // Audit failure must roll back the business mutation, rather than lose evidence.
  await db.exec(`
    insert into inventory(id,name,qty) values ('rollback-item','Keep me',5);
    create function fail_audit_test() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end $$;
    create trigger fail_audit_test before insert on audit_logs for each row execute function fail_audit_test();
  `);
  await assert.rejects(db.exec("delete from inventory where id='rollback-item'"), /audit unavailable/);
  assert.equal((await rows("select qty from inventory where id='rollback-item'"))[0].qty, 5);
  await db.close();
  console.log(`PASS database: ${legacy ? 'legacy cascading schema upgrade' : 'fresh install'}, rerun, CRUD snapshots, roles, truncate, redaction, coverage, RPC, rollback`);
}

// Simulate a server cap lower than the requested limit, equal timestamps, and
// a new event arriving between page requests. Existing pages must stay intact.
const expected = Array.from({ length: 1523 }, (_, i) => ({
  id: String(i + 1).padStart(8, '0') + '-0000-4000-8000-000000000000',
  occurred_at: '2026-09-21T00:00:00+00:00'
})).reverse();
let calls = 0;
const client = {
  from() {
    let filter = null;
    return {
      select() { return this; }, order() { return this; }, limit() { return this; },
      or(value) { filter = value; return this; },
      then(resolve) {
        calls++;
        const id = filter?.match(/id\.lt\.([\w-]+)/)?.[1];
        const current = calls > 1 ? [{ id: '99999999-0000-4000-8000-000000000000', occurred_at: expected[0].occurred_at }, ...expected] : expected;
        resolve({ data: current.filter(row => !id || row.id < id).slice(0, 73), error: null });
      }
    };
  }
};
assert.deepEqual((await readAuditLogs(client)).data, expected);
assert.ok(calls > 20);
const failingClient = { from() { return { select() { return this; }, order() { return this; }, limit() { return this; }, then(resolve) { resolve({error: {message: 'offline'}}); } }; } };
assert.deepEqual(await readAuditLogs(failingClient), {data: [], error: {message: 'offline'}});
console.log('PASS viewer: 1,523 events, server cap, tied timestamps, concurrent append, read error');
