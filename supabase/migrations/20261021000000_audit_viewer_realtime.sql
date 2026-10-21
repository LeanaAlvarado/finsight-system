-- Audit viewer only: no changes to business rows, triggers, RLS, or grants.
-- Run in the Supabase SQL Editor as postgres to enable WebSocket updates.
begin;

create index if not exists audit_logs_occurred_at_id_idx
  on public.audit_logs (occurred_at desc, id desc);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audit_logs'
     ) then
    alter publication supabase_realtime add table public.audit_logs;
  end if;
end;
$$;

commit;
