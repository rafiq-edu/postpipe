begin;
select plan(8);

insert into public.organizations (id, name) values ('a1000000-0000-0000-0000-000000000001', 'Org A');
insert into public.social_accounts (id, org_id, mode, platform, external_id, platform_user_id) values
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'test', 'mock', 'u1', 'p1');

select is(public.claim_daily_job('job-x', '2026-01-01T00:00:00Z'), true, 'daily job claimed first time');
select is(public.claim_daily_job('job-x', '2026-01-01T00:00:00Z'), false, 'daily job not claimed twice');
select is(public.claim_daily_job('job-x', '2026-01-02T01:00:00Z'), true, 'daily job claimed again after 25 hours');

select is(
  array[public.consume_quota('q', '2026-01-01', 2), public.consume_quota('q', '2026-01-01', 2), public.consume_quota('q', '2026-01-01', 2)],
  array[true, true, false],
  'consume_quota stops at the cap');

select is(public.claim_token_refresh('c1000000-0000-0000-0000-000000000001', '2026-01-01T00:00:00Z'), true, 'refresh lease taken');
select is(public.claim_token_refresh('c1000000-0000-0000-0000-000000000001', '2026-01-01T00:00:30Z'), false, 'refresh lease held');

insert into public.social_posts (id, org_id, mode, status) values
  ('f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'test', 'processing');
insert into public.social_post_targets (id, org_id, mode, post_id, social_account_id, platform, status, locked_at, next_attempt_at, publish_state) values
  ('f2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'test', 'f1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'mock', 'running', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '{"stage":"uploaded","data":{}}');
select is((select count(*)::int from public.claim_due_targets(10, '2026-01-01T00:10:00Z')), 0, 'fresh running target is not claimed');
select is((select status::text || (publish_state->>'stage') from public.claim_due_targets(10, '2026-01-01T00:31:00Z')), 'pendinguploaded', 'stale running target is reclaimed as pending with its state');

select * from finish();
rollback;
