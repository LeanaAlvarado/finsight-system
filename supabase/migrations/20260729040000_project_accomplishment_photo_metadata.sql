-- Adds optional metadata for Project Progress Report accomplishment photographs.
-- Safe migration: no existing project_files rows are deleted or overwritten.

alter table public.project_files add column if not exists report_id text;
alter table public.project_files add column if not exists photo_title text;
alter table public.project_files add column if not exists description text;
alter table public.project_files add column if not exists category text default 'other';
alter table public.project_files add column if not exists location text;
alter table public.project_files add column if not exists date_taken date;
alter table public.project_files add column if not exists uploaded_by text;
alter table public.project_files add column if not exists display_order integer default 0;
alter table public.project_files add column if not exists is_visible_in_report boolean default true;
alter table public.project_files add column if not exists uploaded_at timestamptz default now();

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

create index if not exists project_files_report_photo_idx
on public.project_files (project_id, is_visible_in_report, category, display_order, date_taken, created_at);

-- Rollback note:
-- To rollback, drop project_files_report_photo_idx and then drop the added metadata columns.
-- Do not drop columns until any production report/photo metadata has been exported.
