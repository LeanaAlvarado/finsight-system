alter table public.smart_contracts add column if not exists contract_number text;
alter table public.smart_contracts add column if not exists quotation_number text;
alter table public.smart_contracts add column if not exists quotation_type text;
alter table public.smart_contracts add column if not exists quotation_snapshot jsonb default '{}'::jsonb;
alter table public.smart_contracts add column if not exists finalized_at timestamptz;

create index if not exists smart_contracts_contract_number_idx
  on public.smart_contracts (contract_number);

create index if not exists smart_contracts_quotation_number_idx
  on public.smart_contracts (quotation_number);
