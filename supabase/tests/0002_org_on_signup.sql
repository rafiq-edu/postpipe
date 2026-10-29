begin;
select plan(3);

insert into auth.users (id, instance_id, aud, role, email) values
  ('cccccccc-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.test');

select is((select count(*) from public.organizations where name = 'c'), 1::bigint, 'signup creates org named after email local part');
select is((select role::text from public.members where user_id = 'cccccccc-0000-0000-0000-000000000003'), 'owner', 'signup creates owner membership');
select ok((select prosecdef from pg_proc where proname = 'handle_new_user'), 'handle_new_user is security definer');

select * from finish();
rollback;
