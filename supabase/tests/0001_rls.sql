begin;
select plan(12);

insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test');
insert into public.organizations (id, name) values
  ('a1000000-0000-0000-0000-000000000001', 'Org A'),
  ('b2000000-0000-0000-0000-000000000002', 'Org B');
insert into public.members (org_id, user_id, role) values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('b2000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'owner');
insert into public.social_accounts (org_id, mode, platform, external_id, platform_user_id, access_token_enc) values
  ('a1000000-0000-0000-0000-000000000001', 'live', 'bluesky', 'u1', 'p1', 'secret-a'),
  ('b2000000-0000-0000-0000-000000000002', 'live', 'bluesky', 'u2', 'p2', 'secret-b');
insert into public.social_posts (org_id, mode, caption) values
  ('a1000000-0000-0000-0000-000000000001', 'live', 'a'),
  ('b2000000-0000-0000-0000-000000000002', 'live', 'b');
insert into public.webhook_endpoints (org_id, mode, url, secret_enc) values
  ('a1000000-0000-0000-0000-000000000001', 'live', 'https://a.example.test', 'x'),
  ('b2000000-0000-0000-0000-000000000002', 'live', 'https://b.example.test', 'x');
insert into public.media (org_id, mode, storage_path, mime, bytes) values
  ('a1000000-0000-0000-0000-000000000001', 'live', 'a.png', 'image/png', 1),
  ('b2000000-0000-0000-0000-000000000002', 'live', 'b.png', 'image/png', 1);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((select count(*) from public.social_accounts_public), 1::bigint, 'A sees 1 social account');
select is((select count(*) from public.social_accounts_public where org_id = 'b2000000-0000-0000-0000-000000000002'), 0::bigint, 'A sees no org B account');
select is((select count(*) from public.social_posts), 1::bigint, 'A sees 1 post');
select is((select count(*) from public.social_posts where org_id = 'b2000000-0000-0000-0000-000000000002'), 0::bigint, 'A sees no org B post');
select is((select count(*) from public.webhook_endpoints), 1::bigint, 'A sees 1 endpoint');
select is((select count(*) from public.webhook_endpoints where org_id = 'b2000000-0000-0000-0000-000000000002'), 0::bigint, 'A sees no org B endpoint');
select is((select count(*) from public.media), 1::bigint, 'A sees 1 media');
select is((select count(*) from public.media where org_id = 'b2000000-0000-0000-0000-000000000002'), 0::bigint, 'A sees no org B media');

select throws_ok('select access_token_enc from public.social_accounts', '42501', null, 'authenticated cannot read access_token_enc');
select throws_ok('select state from public.connect_sessions', '42501', null, 'authenticated cannot read connect_sessions.state');
select throws_ok($$insert into public.media (org_id, mode, storage_path, mime, bytes) values ('a1000000-0000-0000-0000-000000000001', 'live', 'x', 'image/png', 1)$$, '42501', null, 'authenticated cannot insert');

reset role;
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0::bigint, 'RLS enabled on every public table');

select * from finish();
rollback;
