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
  qty numeric default 0,
  stock_qty numeric default 0,
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
  file_name text,
  file_url text,
  file_type text,
  bucket text,
  storage_path text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
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
alter table public.inventory add column if not exists qty numeric default 0;
alter table public.inventory add column if not exists stock_qty numeric default 0;
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
alter table public.project_files add column if not exists file_name text;
alter table public.project_files add column if not exists file_url text;
alter table public.project_files add column if not exists file_type text;
alter table public.project_files add column if not exists bucket text;
alter table public.project_files add column if not exists storage_path text;
alter table public.project_files add column if not exists created_at timestamptz default now();
alter table public.project_files add column if not exists updated_at timestamptz default now();

alter table public.app_local_storage add column if not exists storage_value jsonb;
alter table public.app_local_storage add column if not exists updated_at timestamptz default now();

alter table public.cloud_sync_audit add column if not exists source_key text;
alter table public.cloud_sync_audit add column if not exists synced_count integer default 0;
alter table public.cloud_sync_audit add column if not exists error_count integer default 0;
alter table public.cloud_sync_audit add column if not exists created_at timestamptz default now();

create index if not exists projects_project_code_idx on public.projects (project_code);
create index if not exists inventory_project_code_idx on public.inventory (project_code);
create index if not exists expenses_project_id_idx on public.expenses (project_id);
create index if not exists payroll_project_id_idx on public.payroll (project_id);
create index if not exists feedback_project_id_idx on public.feedback (project_id);
create index if not exists project_files_project_id_idx on public.project_files (project_id);

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
    'cloud_sync_audit'
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
    'project_files'
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
    ('Owner', 'Owner', '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs","User & Role Management"]'::jsonb, '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs","User & Role Management"]'::jsonb),
    ('Administrator', 'Administrator', '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs","User & Role Management"]'::jsonb, '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs","User & Role Management"]'::jsonb),
    ('Finance', 'Finance', '["Dashboard","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Reports & Audit Logs"]'::jsonb, '["Dashboard","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Reports & Audit Logs"]'::jsonb),
    ('Operations', 'Operations', '["Payroll & Expenses","Project Monitoring","Reports & Audit Logs"]'::jsonb, '["Payroll & Expenses","Project Monitoring","Reports & Audit Logs"]'::jsonb)
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
    ('Owner', 'Owner', '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs","User & Role Management"]'::jsonb, '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs","User & Role Management"]'::jsonb),
    ('Administrator', 'Administrator', '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs","User & Role Management"]'::jsonb, '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs","User & Role Management"]'::jsonb),
    ('Finance', 'Finance', '["Dashboard","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Reports & Audit Logs"]'::jsonb, '["Dashboard","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Reports & Audit Logs"]'::jsonb),
    ('Operations', 'Operations', '["Payroll & Expenses","Project Monitoring","Reports & Audit Logs"]'::jsonb, '["Payroll & Expenses","Project Monitoring","Reports & Audit Logs"]'::jsonb)
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
    'app_local_storage'
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
