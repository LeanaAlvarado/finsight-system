-- Cost Overrun Alerts for the Business Intelligence Dashboard.
-- Run this in Supabase SQL Editor, or apply it as a migration.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.cost_overrun_alerts (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  alert_type text not null default 'budget_utilization',
  severity text not null check (severity in ('Warning', 'Critical')),
  budget_amount numeric not null default 0,
  actual_expenses numeric not null default 0,
  utilization_percentage numeric not null default 0,
  exceeded_amount numeric not null default 0,
  status text not null default 'Active' check (status in ('Active', 'Viewed', 'Resolved')),
  created_at timestamptz not null default now(),
  viewed_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.cost_overrun_alerts add column if not exists project_id text;
alter table public.cost_overrun_alerts add column if not exists alert_type text default 'budget_utilization';
alter table public.cost_overrun_alerts add column if not exists severity text;
alter table public.cost_overrun_alerts add column if not exists budget_amount numeric default 0;
alter table public.cost_overrun_alerts add column if not exists actual_expenses numeric default 0;
alter table public.cost_overrun_alerts add column if not exists utilization_percentage numeric default 0;
alter table public.cost_overrun_alerts add column if not exists exceeded_amount numeric default 0;
alter table public.cost_overrun_alerts add column if not exists status text default 'Active';
alter table public.cost_overrun_alerts add column if not exists created_at timestamptz default now();
alter table public.cost_overrun_alerts add column if not exists viewed_at timestamptz;
alter table public.cost_overrun_alerts add column if not exists resolved_at timestamptz;
alter table public.cost_overrun_alerts add column if not exists updated_at timestamptz default now();

create index if not exists cost_overrun_alerts_project_id_idx on public.cost_overrun_alerts (project_id);
create index if not exists cost_overrun_alerts_status_idx on public.cost_overrun_alerts (status);
create index if not exists cost_overrun_alerts_severity_idx on public.cost_overrun_alerts (severity);

create unique index if not exists cost_overrun_alerts_active_project_severity_uidx
on public.cost_overrun_alerts (project_id, severity)
where status in ('Active', 'Viewed');

drop trigger if exists set_cost_overrun_alerts_updated_at on public.cost_overrun_alerts;
create trigger set_cost_overrun_alerts_updated_at
before update on public.cost_overrun_alerts
for each row execute function public.set_updated_at();

create or replace function public.lemyu_can_manage_cost_overrun_alerts()
returns boolean
language sql
stable
as $$
  select lower(coalesce(
    auth.jwt() ->> 'app_role',
    auth.jwt() ->> 'role_name',
    auth.jwt() ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role',
    auth.jwt() -> 'app_metadata' ->> 'role',
    ''
  )) in ('owner', 'owner/manager', 'manager', 'administrator', 'admin', 'system administrator');
$$;

alter table public.cost_overrun_alerts enable row level security;

drop policy if exists "cost_overrun_alerts_authorized_select" on public.cost_overrun_alerts;
create policy "cost_overrun_alerts_authorized_select"
on public.cost_overrun_alerts for select
to authenticated
using (public.lemyu_can_manage_cost_overrun_alerts());

drop policy if exists "cost_overrun_alerts_authorized_insert" on public.cost_overrun_alerts;
create policy "cost_overrun_alerts_authorized_insert"
on public.cost_overrun_alerts for insert
to authenticated
with check (public.lemyu_can_manage_cost_overrun_alerts());

drop policy if exists "cost_overrun_alerts_authorized_update" on public.cost_overrun_alerts;
create policy "cost_overrun_alerts_authorized_update"
on public.cost_overrun_alerts for update
to authenticated
using (public.lemyu_can_manage_cost_overrun_alerts())
with check (public.lemyu_can_manage_cost_overrun_alerts());

do $$
begin
  begin
    alter publication supabase_realtime add table public.cost_overrun_alerts;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;
