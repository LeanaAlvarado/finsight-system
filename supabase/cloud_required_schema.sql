-- LEMYU cloud schema required by the static Netlify/Supabase frontend.
-- Run this in Supabase Dashboard > SQL Editor for project azjmgkxyciynpiowqfii.
--
-- This app is currently a browser-only system that uses the public anon key.
-- The policies below intentionally allow anon/authenticated browser clients to
-- read and write the app tables. Tighten these policies before using the system
-- for sensitive production data.

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

create table if not exists public.projects (
  id text primary key default gen_random_uuid()::text,
  project_code text unique,
  project_title text,
  client_name text,
  client_contact_name text,
  contact_number text,
  client_email text,
  location text,
  start_date date,
  target_completion date,
  completed_date date,
  status text default 'Pending',
  project_budget numeric default 0,
  contract_amount numeric default 0,
  down_payment numeric default 0,
  tax_amount numeric,
  initial_actual_cost numeric default 0,
  ppr_prepared_by text,
  ppr_noted_by text,
  remarks text,
  quotation_type text default 'manpower',
  quotation_items jsonb default '[]'::jsonb,
  contract_file_name text,
  contract_file_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.inventory (
  id text primary key default gen_random_uuid()::text,
  project_id text,
  project_code text,
  material_name text,
  name text,
  description text,
  qty integer default 0,
  stock_qty integer default 0,
  unit text,
  price numeric default 0,
  picture_name text,
  picture_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.material_catalog (
  id text primary key default gen_random_uuid()::text,
  name text unique,
  description text,
  unit text,
  price numeric default 0,
  picture_name text,
  picture_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.users (
  id text primary key default gen_random_uuid()::text,
  full_name text,
  name text,
  username text unique,
  email text unique,
  password_hash text,
  password text,
  user_password text,
  role text default 'User',
  role_name text,
  status text default 'Active',
  account_status text default 'Active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.roles (
  id text primary key default gen_random_uuid()::text,
  name text unique,
  role_name text,
  permissions jsonb default '[]'::jsonb,
  allowed_modules jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.smart_contracts (
  id text primary key default gen_random_uuid()::text,
  project_id text,
  project_code text,
  project_title text,
  client_name text,
  contact_number text,
  contract_amount numeric default 0,
  down_payment numeric default 0,
  balance_due numeric default 0,
  projected_profit numeric default 0,
  status text,
  project_status text,
  smart_status text,
  rules jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.expenses (
  id text primary key default gen_random_uuid()::text,
  project_id text,
  project_code text,
  project_title text,
  client_name text,
  category text,
  amount numeric default 0,
  date date,
  expense_date date,
  description text,
  proof_url text,
  proof_name text,
  receipt_url text,
  receipt_name text,
  photo_url text,
  photo_name text,
  attachment_url text,
  attachment_name text,
  file_url text,
  file_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.payroll (
  id text primary key default gen_random_uuid()::text,
  employee_name text,
  project_id text,
  project_code text,
  project_title text,
  pay_date date,
  salary_amount numeric default 0,
  deduction_type text,
  deduction_amount numeric default 0,
  work_days numeric default 0,
  payment_status text,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.feedback (
  id text primary key default gen_random_uuid()::text,
  project_id text,
  client_name text,
  rating numeric,
  overall_satisfaction numeric,
  comments text,
  recommendations text,
  date date,
  feedback_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.project_files (
  id text primary key default gen_random_uuid()::text,
  project_id text,
  report_id text,
  file_name text,
  file_url text,
  file_type text,
  bucket text,
  storage_path text,
  photo_title text,
  description text,
  category text default 'other',
  location text,
  date_taken date,
  uploaded_by text,
  display_order integer default 0,
  is_visible_in_report boolean default true,
  uploaded_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint project_files_category_check check (category is null or category in ('before', 'ongoing', 'completed', 'testing', 'turnover', 'other'))
);

create table if not exists public.app_local_storage (
  storage_key text primary key,
  storage_value jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.cloud_sync_audit (
  id bigint generated by default as identity primary key,
  source_key text,
  synced_count integer default 0,
  error_count integer default 0,
  created_at timestamptz default now()
);

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

alter table public.projects add column if not exists project_code text;
alter table public.projects add column if not exists project_title text;
alter table public.projects add column if not exists client_name text;
alter table public.projects add column if not exists client_contact_name text;
alter table public.projects add column if not exists contact_number text;
alter table public.projects add column if not exists client_email text;
alter table public.projects add column if not exists location text;
alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists target_completion date;
alter table public.projects add column if not exists completed_date date;
alter table public.projects add column if not exists status text default 'Pending';
alter table public.projects add column if not exists project_budget numeric default 0;
alter table public.projects add column if not exists contract_amount numeric default 0;
alter table public.projects add column if not exists down_payment numeric default 0;
alter table public.projects add column if not exists tax_amount numeric;
alter table public.projects add column if not exists initial_actual_cost numeric default 0;
alter table public.projects add column if not exists ppr_prepared_by text;
alter table public.projects add column if not exists ppr_noted_by text;
alter table public.projects add column if not exists remarks text;
alter table public.projects add column if not exists quotation_type text default 'manpower';
alter table public.projects add column if not exists quotation_items jsonb default '[]'::jsonb;
alter table public.projects add column if not exists contract_file_name text;
alter table public.projects add column if not exists contract_file_url text;
alter table public.projects add column if not exists created_at timestamptz default now();
alter table public.projects add column if not exists updated_at timestamptz default now();

alter table public.inventory add column if not exists project_id text;
alter table public.inventory add column if not exists project_code text;
alter table public.inventory add column if not exists material_name text;
alter table public.inventory add column if not exists name text;
alter table public.inventory add column if not exists description text;
alter table public.inventory add column if not exists qty integer default 0;
alter table public.inventory add column if not exists stock_qty integer default 0;
alter table public.inventory add column if not exists unit text;
alter table public.inventory add column if not exists price numeric default 0;
alter table public.inventory add column if not exists picture_name text;
alter table public.inventory add column if not exists picture_url text;
alter table public.inventory add column if not exists created_at timestamptz default now();
alter table public.inventory add column if not exists updated_at timestamptz default now();

alter table public.material_catalog add column if not exists name text;
alter table public.material_catalog add column if not exists description text;
alter table public.material_catalog add column if not exists unit text;
alter table public.material_catalog add column if not exists price numeric default 0;
alter table public.material_catalog add column if not exists picture_name text;
alter table public.material_catalog add column if not exists picture_url text;
alter table public.material_catalog add column if not exists created_at timestamptz default now();
alter table public.material_catalog add column if not exists updated_at timestamptz default now();

alter table public.users add column if not exists full_name text;
alter table public.users add column if not exists name text;
alter table public.users add column if not exists username text;
alter table public.users add column if not exists email text;
alter table public.users add column if not exists password_hash text;
alter table public.users add column if not exists password text;
alter table public.users add column if not exists user_password text;
alter table public.users add column if not exists role text default 'User';
alter table public.users add column if not exists role_name text;
alter table public.users add column if not exists status text default 'Active';
alter table public.users add column if not exists account_status text default 'Active';
alter table public.users add column if not exists created_at timestamptz default now();
alter table public.users add column if not exists updated_at timestamptz default now();

alter table public.roles add column if not exists name text;
alter table public.roles add column if not exists role_name text;
alter table public.roles add column if not exists permissions jsonb default '[]'::jsonb;
alter table public.roles add column if not exists allowed_modules jsonb default '[]'::jsonb;
alter table public.roles add column if not exists created_at timestamptz default now();
alter table public.roles add column if not exists updated_at timestamptz default now();

alter table public.smart_contracts add column if not exists project_id text;
alter table public.smart_contracts add column if not exists project_code text;
alter table public.smart_contracts add column if not exists project_title text;
alter table public.smart_contracts add column if not exists client_name text;
alter table public.smart_contracts add column if not exists contact_number text;
alter table public.smart_contracts add column if not exists contract_amount numeric default 0;
alter table public.smart_contracts add column if not exists down_payment numeric default 0;
alter table public.smart_contracts add column if not exists balance_due numeric default 0;
alter table public.smart_contracts add column if not exists projected_profit numeric default 0;
alter table public.smart_contracts add column if not exists status text;
alter table public.smart_contracts add column if not exists project_status text;
alter table public.smart_contracts add column if not exists smart_status text;
alter table public.smart_contracts add column if not exists contract_number text;
alter table public.smart_contracts add column if not exists quotation_number text;
alter table public.smart_contracts add column if not exists quotation_type text;
alter table public.smart_contracts add column if not exists quotation_snapshot jsonb default '{}'::jsonb;
alter table public.smart_contracts add column if not exists finalized_at timestamptz;
alter table public.smart_contracts add column if not exists rules jsonb default '[]'::jsonb;
alter table public.smart_contracts add column if not exists created_at timestamptz default now();
alter table public.smart_contracts add column if not exists updated_at timestamptz default now();

alter table public.expenses add column if not exists project_id text;
alter table public.expenses add column if not exists project_code text;
alter table public.expenses add column if not exists project_title text;
alter table public.expenses add column if not exists client_name text;
alter table public.expenses add column if not exists category text;
alter table public.expenses add column if not exists amount numeric default 0;
alter table public.expenses add column if not exists date date;
alter table public.expenses add column if not exists expense_date date;
alter table public.expenses add column if not exists description text;
alter table public.expenses add column if not exists proof_url text;
alter table public.expenses add column if not exists proof_name text;
alter table public.expenses add column if not exists receipt_url text;
alter table public.expenses add column if not exists receipt_name text;
alter table public.expenses add column if not exists photo_url text;
alter table public.expenses add column if not exists photo_name text;
alter table public.expenses add column if not exists attachment_url text;
alter table public.expenses add column if not exists attachment_name text;
alter table public.expenses add column if not exists file_url text;
alter table public.expenses add column if not exists file_name text;
alter table public.expenses add column if not exists created_at timestamptz default now();
alter table public.expenses add column if not exists updated_at timestamptz default now();

alter table public.payroll add column if not exists employee_name text;
alter table public.payroll add column if not exists project_id text;
alter table public.payroll add column if not exists project_code text;
alter table public.payroll add column if not exists project_title text;
alter table public.payroll add column if not exists pay_date date;
alter table public.payroll add column if not exists salary_amount numeric default 0;
alter table public.payroll add column if not exists deduction_type text;
alter table public.payroll add column if not exists deduction_amount numeric default 0;
alter table public.payroll add column if not exists work_days numeric default 0;
alter table public.payroll add column if not exists payment_status text;
alter table public.payroll add column if not exists description text;
alter table public.payroll add column if not exists created_at timestamptz default now();
alter table public.payroll add column if not exists updated_at timestamptz default now();

alter table public.feedback add column if not exists project_id text;
alter table public.feedback add column if not exists client_name text;
alter table public.feedback add column if not exists rating numeric;
alter table public.feedback add column if not exists overall_satisfaction numeric;
alter table public.feedback add column if not exists comments text;
alter table public.feedback add column if not exists recommendations text;
alter table public.feedback add column if not exists date date;
alter table public.feedback add column if not exists feedback_date date;
alter table public.feedback add column if not exists created_at timestamptz default now();
alter table public.feedback add column if not exists updated_at timestamptz default now();

alter table public.project_files add column if not exists project_id text;
alter table public.project_files add column if not exists report_id text;
alter table public.project_files add column if not exists file_name text;
alter table public.project_files add column if not exists file_url text;
alter table public.project_files add column if not exists file_type text;
alter table public.project_files add column if not exists bucket text;
alter table public.project_files add column if not exists storage_path text;
alter table public.project_files add column if not exists photo_title text;
alter table public.project_files add column if not exists description text;
alter table public.project_files add column if not exists category text default 'other';
alter table public.project_files add column if not exists location text;
alter table public.project_files add column if not exists date_taken date;
alter table public.project_files add column if not exists uploaded_by text;
alter table public.project_files add column if not exists display_order integer default 0;
alter table public.project_files add column if not exists is_visible_in_report boolean default true;
alter table public.project_files add column if not exists uploaded_at timestamptz default now();
alter table public.project_files add column if not exists created_at timestamptz default now();
alter table public.project_files add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_files_category_check'
      and conrelid = 'public.project_files'::regclass
  ) then
    alter table public.project_files
      add constraint project_files_category_check
      check (category is null or category in ('before', 'ongoing', 'completed', 'testing', 'turnover', 'other'));
  end if;
end $$;

alter table public.app_local_storage add column if not exists storage_value jsonb;
alter table public.app_local_storage add column if not exists updated_at timestamptz default now();

alter table public.cloud_sync_audit add column if not exists source_key text;
alter table public.cloud_sync_audit add column if not exists synced_count integer default 0;
alter table public.cloud_sync_audit add column if not exists error_count integer default 0;
alter table public.cloud_sync_audit add column if not exists created_at timestamptz default now();

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

create index if not exists projects_project_code_idx on public.projects (project_code);
create index if not exists inventory_project_code_idx on public.inventory (project_code);
create index if not exists expenses_project_id_idx on public.expenses (project_id);
create index if not exists payroll_project_id_idx on public.payroll (project_id);
create index if not exists feedback_project_id_idx on public.feedback (project_id);
create index if not exists project_files_project_id_idx on public.project_files (project_id);
create index if not exists project_files_report_photo_idx on public.project_files (project_id, is_visible_in_report, category, display_order, date_taken, created_at);
create index if not exists cost_overrun_alerts_project_id_idx on public.cost_overrun_alerts (project_id);
create index if not exists cost_overrun_alerts_status_idx on public.cost_overrun_alerts (status);
create index if not exists cost_overrun_alerts_severity_idx on public.cost_overrun_alerts (severity);
create unique index if not exists cost_overrun_alerts_active_project_severity_uidx
on public.cost_overrun_alerts (project_id, severity)
where status in ('Active', 'Viewed');

alter table public.inventory
  drop constraint if exists inventory_qty_nonnegative,
  add constraint inventory_qty_nonnegative check (qty >= 0);

alter table public.inventory
  drop constraint if exists inventory_stock_qty_nonnegative,
  add constraint inventory_stock_qty_nonnegative check (stock_qty >= 0);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'projects',
    'inventory',
    'material_catalog',
    'users',
    'roles',
    'smart_contracts',
    'expenses',
    'payroll',
    'feedback',
    'project_files',
    'app_local_storage',
    'cloud_sync_audit',
    'cost_overrun_alerts'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop policy if exists "%I_browser_select" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%I_browser_insert" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%I_browser_update" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%I_browser_delete" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%I_authenticated_select" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%I_authenticated_insert" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%I_authenticated_update" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%I_authenticated_delete" on public.%I', table_name, table_name);

    execute format(
      'create policy "%I_authenticated_select" on public.%I for select to authenticated using (true)',
      table_name,
      table_name
    );
    execute format(
      'create policy "%I_authenticated_insert" on public.%I for insert to authenticated with check (true)',
      table_name,
      table_name
    );
    execute format(
      'create policy "%I_authenticated_update" on public.%I for update to authenticated using (true) with check (true)',
      table_name,
      table_name
    );
    execute format(
      'create policy "%I_authenticated_delete" on public.%I for delete to authenticated using (true)',
      table_name,
      table_name
    );
  end loop;
end $$;

drop policy if exists "users_login_lookup" on public.users;
create policy "users_login_lookup"
on public.users for select
to anon
using (true);

drop policy if exists "roles_login_lookup" on public.roles;
create policy "roles_login_lookup"
on public.roles for select
to anon
using (true);

drop policy if exists "feedback_public_insert" on public.feedback;
create policy "feedback_public_insert"
on public.feedback for insert
to anon
with check (true);

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
  )) in ('owner/manager', 'system administrator');
$$;

drop policy if exists "cost_overrun_alerts_authenticated_select" on public.cost_overrun_alerts;
drop policy if exists "cost_overrun_alerts_authenticated_insert" on public.cost_overrun_alerts;
drop policy if exists "cost_overrun_alerts_authenticated_update" on public.cost_overrun_alerts;
drop policy if exists "cost_overrun_alerts_authenticated_delete" on public.cost_overrun_alerts;

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
declare
  table_name text;
begin
  foreach table_name in array array[
    'projects',
    'inventory',
    'material_catalog',
    'users',
    'roles',
    'smart_contracts',
    'expenses',
    'payroll',
    'feedback',
    'project_files',
    'cost_overrun_alerts'
  ]
  loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end $$;

with seed_roles (name, role_name, permissions, allowed_modules) as (
  values
    ('System Administrator', 'System Administrator', '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs","User & Role Management"]'::jsonb, '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs","User & Role Management"]'::jsonb),
    ('Owner/Manager', 'Owner/Manager', '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs"]'::jsonb, '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs"]'::jsonb),
    ('Finance Officer/Accountant', 'Finance Officer/Accountant', '["Payroll & Expenses","Taxes & Revenue","Project Monitoring","Reports & Audit Logs"]'::jsonb, '["Payroll & Expenses","Taxes & Revenue","Project Monitoring","Reports & Audit Logs"]'::jsonb),
    ('Project Manager/Operations Staff', 'Project Manager/Operations Staff', '["Project Monitoring","Reports & Audit Logs"]'::jsonb, '["Project Monitoring","Reports & Audit Logs"]'::jsonb)
)
insert into public.roles (name, role_name, permissions, allowed_modules)
select seed_roles.name, seed_roles.role_name, seed_roles.permissions, seed_roles.allowed_modules
from seed_roles
where not exists (
  select 1
  from public.roles
  where lower(coalesce(public.roles.name, public.roles.role_name, '')) = lower(seed_roles.name)
);

with seed_roles (name, role_name, permissions, allowed_modules) as (
  values
    ('System Administrator', 'System Administrator', '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs","User & Role Management"]'::jsonb, '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs","User & Role Management"]'::jsonb),
    ('Owner/Manager', 'Owner/Manager', '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs"]'::jsonb, '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs"]'::jsonb),
    ('Finance Officer/Accountant', 'Finance Officer/Accountant', '["Payroll & Expenses","Taxes & Revenue","Project Monitoring","Reports & Audit Logs"]'::jsonb, '["Payroll & Expenses","Taxes & Revenue","Project Monitoring","Reports & Audit Logs"]'::jsonb),
    ('Project Manager/Operations Staff', 'Project Manager/Operations Staff', '["Project Monitoring","Reports & Audit Logs"]'::jsonb, '["Project Monitoring","Reports & Audit Logs"]'::jsonb)
)
update public.roles
set
  role_name = seed_roles.role_name,
  permissions = seed_roles.permissions,
  allowed_modules = seed_roles.allowed_modules,
  updated_at = now()
from seed_roles
where lower(coalesce(public.roles.name, public.roles.role_name, '')) = lower(seed_roles.name);

insert into storage.buckets (id, name, public)
values
  ('contracts', 'contracts', true),
  ('progress-files', 'progress-files', true),
  ('expense-proofs', 'expense-proofs', true),
  ('expenses', 'expenses', true),
  ('receipts', 'receipts', true),
  ('proofs', 'proofs', true),
  ('inventory', 'inventory', true),
  ('materials', 'materials', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "lemyu_storage_public_select" on storage.objects;
create policy "lemyu_storage_public_select"
on storage.objects for select
to anon, authenticated
using (bucket_id in ('contracts', 'progress-files', 'expense-proofs', 'expenses', 'receipts', 'proofs', 'inventory', 'materials'));

drop policy if exists "lemyu_storage_public_insert" on storage.objects;
create policy "lemyu_storage_public_insert"
on storage.objects for insert
to authenticated
with check (bucket_id in ('contracts', 'progress-files', 'expense-proofs', 'expenses', 'receipts', 'proofs', 'inventory', 'materials'));

drop policy if exists "lemyu_storage_public_update" on storage.objects;
create policy "lemyu_storage_public_update"
on storage.objects for update
to authenticated
using (bucket_id in ('contracts', 'progress-files', 'expense-proofs', 'expenses', 'receipts', 'proofs', 'inventory', 'materials'))
with check (bucket_id in ('contracts', 'progress-files', 'expense-proofs', 'expenses', 'receipts', 'proofs', 'inventory', 'materials'));

drop policy if exists "lemyu_storage_public_delete" on storage.objects;
create policy "lemyu_storage_public_delete"
on storage.objects for delete
to authenticated
using (bucket_id in ('contracts', 'progress-files', 'expense-proofs', 'expenses', 'receipts', 'proofs', 'inventory', 'materials'));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'projects',
    'inventory',
    'material_catalog',
    'users',
    'roles',
    'smart_contracts',
    'expenses',
    'payroll',
    'feedback',
    'project_files',
    'app_local_storage',
    'cost_overrun_alerts'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end $$;
