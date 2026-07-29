-- Enforce whole-number inventory quantities.
-- This migration refuses to run if existing decimal quantities are found.

do $$
declare
  decimal_qty_count integer;
  decimal_stock_qty_count integer;
begin
  select count(*)
  into decimal_qty_count
  from public.inventory
  where qty is not null
    and qty <> trunc(qty);

  select count(*)
  into decimal_stock_qty_count
  from public.inventory
  where stock_qty is not null
    and stock_qty <> trunc(stock_qty);

  if decimal_qty_count > 0 or decimal_stock_qty_count > 0 then
    raise exception
      'Inventory quantity migration stopped. Decimal qty rows: %, decimal stock_qty rows: %. Review these rows before converting to integer.',
      decimal_qty_count,
      decimal_stock_qty_count;
  end if;
end $$;

alter table public.inventory
  alter column qty type integer using coalesce(qty, 0)::integer,
  alter column qty set default 0;

alter table public.inventory
  alter column stock_qty type integer using coalesce(stock_qty, 0)::integer,
  alter column stock_qty set default 0;

alter table public.inventory
  drop constraint if exists inventory_qty_nonnegative,
  add constraint inventory_qty_nonnegative check (qty >= 0);

alter table public.inventory
  drop constraint if exists inventory_stock_qty_nonnegative,
  add constraint inventory_stock_qty_nonnegative check (stock_qty >= 0);

-- Use this before running the migration if you want to inspect decimal records:
-- select id, name, material_name, qty, stock_qty
-- from public.inventory
-- where (qty is not null and qty <> trunc(qty))
--    or (stock_qty is not null and stock_qty <> trunc(stock_qty));
