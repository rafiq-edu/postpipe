begin;
select plan(3);

select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated') and privilege_type <> 'SELECT'), 0::bigint, 'API roles hold nothing but select');
select is((select count(*) from pg_tables t where schemaname = 'public' and not has_table_privilege('service_role', format('%I.%I', schemaname, tablename), 'SELECT, INSERT, UPDATE, DELETE')), 0::bigint, 'service_role has DML on every table');
select ok(not has_table_privilege('anon', 'public.media', 'TRUNCATE'), 'anon cannot truncate');

select * from finish();
rollback;
