-- Read-only deployment verification: every row should report passed = true.
select 'No foreign keys can cascade into history' as check_name,
  not exists(select 1 from pg_constraint where conrelid='public.audit_logs'::regclass and contype='f') as passed
union all
select 'Audit row level security enabled', relrowsecurity
  from pg_class where oid='public.audit_logs'::regclass
union all
select 'Always-enabled statement guard blocks UPDATE DELETE TRUNCATE',
  exists(select 1 from pg_trigger where tgrelid='public.audit_logs'::regclass
    and tgname='audit_logs_append_only' and tgenabled='A' and tgtype=58)
union all
select 'Browser and service roles cannot mutate history',
  not exists(select 1 from (values ('anon'),('authenticated'),('service_role')) roles(name)
    where has_table_privilege(name,'public.audit_logs','INSERT, UPDATE, DELETE, TRUNCATE'))
union all
select 'Anonymous event RPC disabled',
  not has_function_privilege('anon','public.record_audit_event(text,text,text,jsonb)','EXECUTE')
union all
select 'Authenticated event RPC enabled',
  has_function_privilege('authenticated','public.record_audit_event(text,text,text,jsonb)','EXECUTE')
union all
select 'All current application tables have always-enabled CRUD and truncate guards',
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and not c.relispartition
      and c.relname<>'audit_logs'
      and not exists(select 1 from pg_depend d where d.objid=c.oid and d.classid='pg_class'::regclass and d.deptype='e')
      and (not exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='finsight_audit_crud' and t.tgenabled='A' and t.tgtype=29)
        or not exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='finsight_audit_no_truncate' and t.tgenabled='A' and t.tgtype=34))
  );
