begin;
select plan(2);

insert into public.organizations (id, name) values ('a1000000-0000-0000-0000-000000000001', 'Org A');
insert into public.api_keys (id, org_id, name, key_hash, key_prefix, last4, mode) values
  ('c3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 't', 'h', 'pp_test_', 'abcd', 'test');

select is(public.increment_rate_limit('c3000000-0000-0000-0000-000000000003', '2026-01-01T00:00:00Z'), 1, 'first call returns 1');
select is(public.increment_rate_limit('c3000000-0000-0000-0000-000000000003', '2026-01-01T00:00:00Z'), 2, 'second call returns 2');

select * from finish();
rollback;
