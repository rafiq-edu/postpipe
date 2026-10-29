begin;
select plan(14);

select has_table('public', 'platform_apps', 'platform_apps exists');
select ok((select relrowsecurity from pg_class where oid = 'public.platform_apps'::regclass), 'RLS enabled');
select ok(not has_column_privilege('authenticated', 'public.platform_apps', 'client_secret_enc', 'SELECT'), 'authenticated cannot select client_secret_enc');
select ok(not has_column_privilege('anon', 'public.platform_apps', 'client_id', 'SELECT'), 'anon cannot select client_id');
select ok(has_column_privilege('authenticated', 'public.platform_apps', 'client_id', 'SELECT'), 'authenticated can select client_id');
select has_view('public', 'platform_apps_public', 'public view exists');

insert into public.organizations (id, name) values ('00000000-0000-0000-0000-0000000017aa', 'byo test org');
select throws_ok(
  $$insert into public.platform_apps (org_id, platform, client_id, client_secret_enc)
    values ('00000000-0000-0000-0000-0000000017aa', 'bluesky', 'a', 'b')$$,
  '23514', null, 'bluesky is rejected by the check constraint');

-- RLS and write privileges, as a signed-in member of another org.
insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-0000-0000-0000-0000000017a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pa1@example.test'),
  ('bbbbbbbb-0000-0000-0000-0000000017b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pb2@example.test');
insert into public.organizations (id, name) values ('00000000-0000-0000-0000-0000000017bb', 'byo test org B');
insert into public.members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000017aa', 'aaaaaaaa-0000-0000-0000-0000000017a1', 'owner'),
  ('00000000-0000-0000-0000-0000000017bb', 'bbbbbbbb-0000-0000-0000-0000000017b2', 'owner');
insert into public.platform_apps (org_id, platform, client_id, client_secret_enc) values
  ('00000000-0000-0000-0000-0000000017aa', 'x', 'cid-a', 'v1.enc-a'),
  ('00000000-0000-0000-0000-0000000017bb', 'x', 'cid-b', 'v1.enc-b');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-0000000017a1","role":"authenticated"}', true);

select is((select count(*) from public.platform_apps_public), 1::bigint, 'A sees only its own app in the view');
select is((select count(*) from public.platform_apps where org_id = '00000000-0000-0000-0000-0000000017bb'), 0::bigint, 'A cannot see the other org row');
select throws_ok($$insert into public.platform_apps (org_id, platform, client_id, client_secret_enc) values ('00000000-0000-0000-0000-0000000017aa', 'linkedin', 'c', 's')$$, '42501', null, 'authenticated cannot insert');
select throws_ok($$update public.platform_apps set client_id = 'x'$$, '42501', null, 'authenticated cannot update');
select throws_ok($$delete from public.platform_apps$$, '42501', null, 'authenticated cannot delete');
select throws_ok('select client_secret_enc from public.platform_apps', '42501', null, 'authenticated cannot read the secret column');
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'platform_apps_public' and column_name like '%secret%'), 0::bigint, 'view has no secret column');

select * from finish();
rollback;
