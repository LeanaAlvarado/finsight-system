do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'role'
  ) then
    update public.users
    set role = case
      when lower(role) in ('administrator', 'admin', 'system_admin', 'system administrator') then 'System Administrator'
      when lower(role) in ('owner', 'manager', 'owner_manager', 'owner/manager') then 'Owner/Manager'
      when lower(role) in ('finance', 'accountant', 'accounting', 'finance_officer', 'finance officer/accountant', 'finance officer / accountant') then 'Finance Officer/Accountant'
      when lower(role) in ('operations', 'operation', 'operations staff', 'project_manager', 'project manager', 'project manager/operations staff', 'project manager / operations staff') then 'Project Manager/Operations Staff'
      when lower(role) in ('viewer', 'staff', 'needs_review', 'needs role review') then 'Needs Role Review'
      else 'Needs Role Review'
    end
    where role is not null;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'users'
        and column_name = 'status'
    ) then
      update public.users
      set status = 'Inactive'
      where role = 'Needs Role Review';
    end if;

    alter table public.users
      drop constraint if exists users_role_approved_check;

    alter table public.users
      add constraint users_role_approved_check
      check (role in (
        'System Administrator',
        'Owner/Manager',
        'Finance Officer/Accountant',
        'Project Manager/Operations Staff',
        'Needs Role Review'
      ));
  end if;
end $$;

do $$
begin
  if to_regclass('public.roles') is not null then
    delete from public.roles
    where coalesce(name, role_name, '') in ('Viewer', 'Finance', 'Operations', 'Staff', 'Owner', 'Administrator');

    insert into public.roles (name, role_name, permissions, allowed_modules)
    values
      ('System Administrator', 'System Administrator', '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs","User & Role Management"]'::jsonb, '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs","User & Role Management"]'::jsonb),
      ('Owner/Manager', 'Owner/Manager', '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs"]'::jsonb, '["Dashboard","Inventory","Payroll & Expenses","Taxes & Revenue","Project Monitoring","Proposal / Quotation & Feedback","Reports & Audit Logs"]'::jsonb),
      ('Finance Officer/Accountant', 'Finance Officer/Accountant', '["Payroll & Expenses","Taxes & Revenue","Project Monitoring","Reports & Audit Logs"]'::jsonb, '["Payroll & Expenses","Taxes & Revenue","Project Monitoring","Reports & Audit Logs"]'::jsonb),
      ('Project Manager/Operations Staff', 'Project Manager/Operations Staff', '["Project Monitoring","Reports & Audit Logs"]'::jsonb, '["Project Monitoring","Reports & Audit Logs"]'::jsonb),
      ('Needs Role Review', 'Needs Role Review', '[]'::jsonb, '[]'::jsonb)
    on conflict do nothing;
  end if;
end $$;
