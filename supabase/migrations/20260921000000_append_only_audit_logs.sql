-- Permanent audit history for FinSight.
-- Each event keeps snapshots instead of a foreign-key link to the source row.
-- A source record can be deleted without deleting or changing its audit entry.

create extension if not exists pgcrypto;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE', 'EVENT')),
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb not null default '{}'::jsonb
);

-- audit_logs must not reference projects, payroll, expenses, or any other
-- business table. Remove legacy foreign keys that could cascade a deletion.
do $$
declare
  audit_fk record;
begin
  for audit_fk in
    select conname from pg_constraint
    where conrelid = 'public.audit_logs'::regclass and contype = 'f'
  loop
    execute format('alter table public.audit_logs drop constraint %I', audit_fk.conname);
  end loop;
end;
$$;

create index if not exists audit_logs_occurred_at_idx on public.audit_logs (occurred_at desc);
create index if not exists audit_logs_table_record_idx on public.audit_logs (table_name, record_id);

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row jsonb;
  after_row jsonb;
  affected_id text;
begin
  if tg_op = 'INSERT' then
    after_row := to_jsonb(new);
    affected_id := coalesce(after_row ->> 'id', after_row ->> 'uuid');
  elsif tg_op = 'UPDATE' then
    before_row := to_jsonb(old);
    after_row := to_jsonb(new);
    affected_id := coalesce(after_row ->> 'id', before_row ->> 'id', after_row ->> 'uuid', before_row ->> 'uuid');
  else
    before_row := to_jsonb(old);
    affected_id := coalesce(before_row ->> 'id', before_row ->> 'uuid');
  end if;

  insert into public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data, metadata)
  values (auth.uid(), tg_op, tg_table_schema || '.' || tg_table_name, affected_id, before_row, after_row,
          jsonb_build_object('trigger_name', tg_name));

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_audit_log_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Audit log entries are append-only and cannot be updated or deleted.';
end;
$$;

drop trigger if exists audit_logs_append_only on public.audit_logs;
create trigger audit_logs_append_only
before update or delete on public.audit_logs
for each row execute function public.prevent_audit_log_change();

-- Log all CRUD actions in the operational tables that exist in this project.
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'projects', 'inventory', 'material_catalog', 'expenses', 'payroll',
    'feedback', 'project_files', 'smart_contracts', 'users', 'roles',
    'cost_overrun_alerts'
  ]
  loop
    if to_regclass('public.' || target_table) is not null then
      execute format('drop trigger if exists finsight_audit_crud on public.%I', target_table);
      execute format(
        'create trigger finsight_audit_crud after insert or update or delete on public.%I for each row execute function public.write_audit_log()',
        target_table
      );
    end if;
  end loop;
end;
$$;

alter table public.audit_logs enable row level security;
drop policy if exists "audit_logs_authenticated_select" on public.audit_logs;
create policy "audit_logs_authenticated_select"
on public.audit_logs for select to authenticated using (true);

-- This RPC supports non-CRUD events such as login, logout, printing, and
-- report generation. It is intentionally INSERT-only.
create or replace function public.record_audit_event(
  p_action text,
  p_table_name text default 'application',
  p_record_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  audit_id uuid;
begin
  insert into public.audit_logs (actor_id, action, table_name, record_id, metadata)
  values (auth.uid(), 'EVENT', coalesce(p_table_name, 'application'), p_record_id,
          jsonb_build_object('event', p_action) || coalesce(p_metadata, '{}'::jsonb))
  returning id into audit_id;
  return audit_id;
end;
$$;
