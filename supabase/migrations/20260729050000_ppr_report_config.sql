-- Stores editable Project Progress Report configuration per project.
-- Safe migration: existing projects are preserved and the field is optional.

alter table public.projects add column if not exists ppr_report_config jsonb default '{}'::jsonb;

-- Rollback note:
-- Drop this column only after exporting any saved PPR report configuration:
-- alter table public.projects drop column if exists ppr_report_config;
