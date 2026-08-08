alter table public.projects add column if not exists purchase_order_number text;
alter table public.projects add column if not exists purchase_order_amount numeric default 0;
alter table public.projects add column if not exists purchase_order_file_name text;
alter table public.projects add column if not exists purchase_order_file_url text;
alter table public.projects add column if not exists billing_down_payment_amount numeric default 0;
alter table public.projects add column if not exists billing_down_payment_percent numeric default 0;
alter table public.projects add column if not exists billing_progress_percent numeric default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_purchase_order_amount_check'
  ) then
    alter table public.projects
      add constraint projects_purchase_order_amount_check
      check (purchase_order_amount >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_billing_down_payment_amount_check'
  ) then
    alter table public.projects
      add constraint projects_billing_down_payment_amount_check
      check (billing_down_payment_amount >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_billing_down_payment_percent_check'
  ) then
    alter table public.projects
      add constraint projects_billing_down_payment_percent_check
      check (billing_down_payment_percent >= 0 and billing_down_payment_percent <= 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_billing_progress_percent_check'
  ) then
    alter table public.projects
      add constraint projects_billing_progress_percent_check
      check (billing_progress_percent >= 0 and billing_progress_percent <= 100);
  end if;
end $$;
