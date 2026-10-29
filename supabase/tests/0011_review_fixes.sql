begin;
select plan(7);

insert into public.organizations (id, name) values ('a1100000-0000-0000-0000-000000000001', 'Org H');
insert into public.social_accounts (id, org_id, mode, platform, external_id, platform_user_id) values
  ('c1100000-0000-0000-0000-000000000001', 'a1100000-0000-0000-0000-000000000001', 'test', 'mock', 'u1', 'p1');
insert into public.social_posts (id, org_id, mode, status) values
  ('f1100000-0000-0000-0000-000000000001', 'a1100000-0000-0000-0000-000000000001', 'test', 'processing'),
  ('f1100000-0000-0000-0000-000000000002', 'a1100000-0000-0000-0000-000000000001', 'test', 'processing'),
  ('f1100000-0000-0000-0000-000000000003', 'a1100000-0000-0000-0000-000000000001', 'test', 'processing'),
  ('f1100000-0000-0000-0000-000000000004', 'a1100000-0000-0000-0000-000000000001', 'test', 'cancelled'),
  ('f1100000-0000-0000-0000-000000000005', 'a1100000-0000-0000-0000-000000000001', 'test', 'scheduled');
-- post 1: success + error -> partial; 2: error only (plus a cancelled) -> failed;
-- 3: success only -> completed; 4: cancelled post with a success -> untouched; 5: pending + success -> processing
insert into public.social_post_targets (org_id, mode, post_id, social_account_id, platform, status) values
  ('a1100000-0000-0000-0000-000000000001', 'test', 'f1100000-0000-0000-0000-000000000001', 'c1100000-0000-0000-0000-000000000001', 'mock', 'success'),
  ('a1100000-0000-0000-0000-000000000001', 'test', 'f1100000-0000-0000-0000-000000000001', 'c1100000-0000-0000-0000-000000000001', 'mock', 'error'),
  ('a1100000-0000-0000-0000-000000000001', 'test', 'f1100000-0000-0000-0000-000000000002', 'c1100000-0000-0000-0000-000000000001', 'mock', 'error'),
  ('a1100000-0000-0000-0000-000000000001', 'test', 'f1100000-0000-0000-0000-000000000002', 'c1100000-0000-0000-0000-000000000001', 'mock', 'cancelled'),
  ('a1100000-0000-0000-0000-000000000001', 'test', 'f1100000-0000-0000-0000-000000000003', 'c1100000-0000-0000-0000-000000000001', 'mock', 'success'),
  ('a1100000-0000-0000-0000-000000000001', 'test', 'f1100000-0000-0000-0000-000000000004', 'c1100000-0000-0000-0000-000000000001', 'mock', 'success'),
  ('a1100000-0000-0000-0000-000000000001', 'test', 'f1100000-0000-0000-0000-000000000005', 'c1100000-0000-0000-0000-000000000001', 'mock', 'pending'),
  ('a1100000-0000-0000-0000-000000000001', 'test', 'f1100000-0000-0000-0000-000000000005', 'c1100000-0000-0000-0000-000000000001', 'mock', 'success');

select public.rollup_post_status(id) from public.social_posts where org_id = 'a1100000-0000-0000-0000-000000000001';
select is((select status::text from public.social_posts where id = 'f1100000-0000-0000-0000-000000000001'), 'partial', 'success + error is partial');
select is((select status::text from public.social_posts where id = 'f1100000-0000-0000-0000-000000000002'), 'failed', 'no success is failed, cancelled ignored');
select is((select status::text from public.social_posts where id = 'f1100000-0000-0000-0000-000000000003'), 'completed', 'all success is completed');
select is((select status::text from public.social_posts where id = 'f1100000-0000-0000-0000-000000000004'), 'cancelled', 'cancelled post is untouched');
select is((select status::text from public.social_posts where id = 'f1100000-0000-0000-0000-000000000005'), 'processing', 'pending target keeps post processing');

-- J: stale running row with publish_state gets attempts + 1 on reclaim
update public.social_post_targets set status = 'running', locked_at = '2026-01-01T00:00:00Z', next_attempt_at = '2026-01-01T00:00:00Z',
  publish_state = '{"stage":"uploaded","data":{}}', attempts = 6
  where post_id = 'f1100000-0000-0000-0000-000000000005' and status = 'pending';
select is((select attempts from public.claim_due_targets(10, '2026-01-01T00:31:00Z')), 7, 'stale reclaim with state counts an attempt');
select is(has_function_privilege('authenticated', 'public.rollup_post_status(uuid)', 'execute'), false, 'rollup not callable by authenticated');

select * from finish();
rollback;
