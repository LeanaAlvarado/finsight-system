alter table public.projects
  add column if not exists progress_percentage numeric default 0;

update public.projects
set progress_percentage = least(greatest(coalesce(progress_percentage, 0), 0), 100);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_progress_percentage_check'
  ) then
    alter table public.projects
      add constraint projects_progress_percentage_check
      check (progress_percentage >= 0 and progress_percentage <= 100);
  end if;
end $$;
