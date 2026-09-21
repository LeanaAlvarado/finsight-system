-- Run after the application schema. Also works if the earlier audit migration
-- was never applied. Run the entire file in Supabase SQL Editor as postgres.
begin;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb not null default '{}'::jsonb
);

-- History owns its snapshots: deleting a source row or account cannot cascade
-- into history (including ON DELETE SET NULL, which would rewrite evidence).
do $$
declare item record;
begin
  for item in select conname from pg_constraint
    where conrelid = 'public.audit_logs'::regclass and contype = 'f'
  loop
    execute format('alter table public.audit_logs drop constraint %I', item.conname);
  end loop;
end $$;

alter table public.audit_logs alter column occurred_at set default clock_timestamp();
create index if not exists audit_logs_occurred_at_id_idx
  on public.audit_logs (occurred_at desc, id desc);
create index if not exists audit_logs_table_record_idx
  on public.audit_logs (table_name, record_id);

-- User rows and nested local-storage mirrors contain credentials. Preserve
-- business evidence without making a second permanent copy of those secrets.
create or replace function public.audit_safe_snapshot(value jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare result jsonb; item record;
begin
  if jsonb_typeof(value) = 'object' then
    result := '{}'::jsonb;
    for item in select * from jsonb_each(value) loop
      if item.key ~* '(password|passwd|secret|token|otp|api_key|authorization)' then
        result := result || jsonb_build_object(item.key, '[REDACTED]');
      else
        result := result || jsonb_build_object(item.key, public.audit_safe_snapshot(item.value));
      end if;
    end loop;
    return result;
  elsif jsonb_typeof(value) = 'array' then
    select coalesce(jsonb_agg(public.audit_safe_snapshot(element)), '[]'::jsonb)
      into result from jsonb_array_elements(value) as elements(element);
    return result;
  end if;
  return value;
end $$;

create or replace function public.write_audit_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare before_row jsonb; after_row jsonb; affected_id text;
begin
  if tg_op <> 'INSERT' then before_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_row := to_jsonb(new); end if;
  affected_id := coalesce(after_row ->> 'id', before_row ->> 'id',
    after_row ->> 'uuid', before_row ->> 'uuid',
    after_row ->> 'storage_key', before_row ->> 'storage_key');

  insert into public.audit_logs
    (actor_id, action, table_name, record_id, old_data, new_data, metadata)
  values (auth.uid(), tg_op, tg_table_schema || '.' || tg_table_name, affected_id,
    public.audit_safe_snapshot(before_row), public.audit_safe_snapshot(after_row),
    jsonb_build_object('source', 'database_trigger', 'trigger_name', tg_name,
      'actor_email', auth.jwt() ->> 'email',
      'credential_fields_changed', case when tg_op = 'UPDATE' then
        (before_row - array(select key from jsonb_object_keys(before_row) as keys(key)
          where key !~* '(password|passwd|secret|token|otp|api_key|authorization)'))
        is distinct from
        (after_row - array(select key from jsonb_object_keys(after_row) as keys(key)
          where key !~* '(password|passwd|secret|token|otp|api_key|authorization)'))
        else false end));
  -- No exception handler: a business write must roll back if its audit fails.
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.prevent_audit_log_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Audit history is permanent. Updating, deleting or clearing it is not allowed.'
    using errcode = '42501';
end $$;

drop trigger if exists audit_logs_append_only on public.audit_logs;
create trigger audit_logs_append_only
  before update or delete or truncate on public.audit_logs
  for each statement execute function public.prevent_audit_log_change();
alter table public.audit_logs enable always trigger audit_logs_append_only;

-- Cover every current application table, including local-storage-backed
-- settings, billing/quotation inputs and cloud sync activity. No audit recursion.
-- TRUNCATE has no OLD rows; forbid it on business tables so row deletes remain
-- auditable. Future business-table migrations must install these triggers too.
do $$
declare item record;
begin
  for item in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not c.relispartition and c.relname <> 'audit_logs'
      and not exists (select 1 from pg_depend d where d.objid = c.oid
        and d.classid = 'pg_class'::regclass and d.deptype = 'e')
  loop
    execute format('drop trigger if exists finsight_audit_crud on public.%I', item.relname);
    execute format('create trigger finsight_audit_crud after insert or update or delete on public.%I for each row execute function public.write_audit_log()', item.relname);
    execute format('alter table public.%I enable always trigger finsight_audit_crud', item.relname);
    execute format('drop trigger if exists finsight_audit_no_truncate on public.%I', item.relname);
    execute format('create trigger finsight_audit_no_truncate before truncate on public.%I for each statement execute function public.prevent_audit_log_change()', item.relname);
    execute format('alter table public.%I enable always trigger finsight_audit_no_truncate', item.relname);
  end loop;
end $$;

alter table public.audit_logs enable row level security;
-- Remove legacy permissive policies. Only the trigger/RPC owner can append.
do $$
declare item record;
begin
  for item in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'audit_logs'
  loop
    execute format('drop policy %I on public.audit_logs', item.policyname);
  end loop;
end $$;
create policy audit_logs_authenticated_select on public.audit_logs
  for select to authenticated using (true);
revoke all on public.audit_logs from public, anon, authenticated, service_role;
grant select on public.audit_logs to authenticated, service_role;

create or replace function public.record_audit_event(
  p_action text, p_table_name text default 'application',
  p_record_id text default null, p_metadata jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare audit_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to record application activity.' using errcode = '42501';
  end if;
  if nullif(btrim(p_action), '') is null or length(p_action) > 200
    or length(p_table_name) > 120 or length(p_record_id) > 500
    or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 16384 then
    raise exception 'Invalid audit event.' using errcode = '22023';
  end if;
  insert into public.audit_logs (actor_id, action, table_name, record_id, metadata)
    values (auth.uid(), 'EVENT', coalesce(nullif(p_table_name, ''), 'application'), p_record_id,
      public.audit_safe_snapshot(coalesce(p_metadata, '{}'::jsonb)) ||
      jsonb_build_object('event', p_action, 'source', 'application_event',
        'actor_email', auth.jwt() ->> 'email')) returning id into audit_id;
  return audit_id;
end $$;
revoke all on function public.record_audit_event(text, text, text, jsonb) from public, anon;
grant execute on function public.record_audit_event(text, text, text, jsonb) to authenticated;
revoke all on function public.write_audit_log() from public, anon, authenticated, service_role;
revoke all on function public.prevent_audit_log_change() from public, anon, authenticated, service_role;
revoke all on function public.audit_safe_snapshot(jsonb) from public, anon, authenticated, service_role;

comment on table public.audit_logs is
  'Permanent audit snapshots with no source foreign keys. Application administrators cannot edit, delete or truncate history.';
notify pgrst, 'reload schema';
commit;
