begin;
select plan(3);

insert into public.organizations (id, name) values ('a1000000-0000-0000-0000-000000000001', 'Org A');
insert into public.webhook_endpoints (id, org_id, mode, url, secret_enc) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'test', 'https://example.com/h', 'x');
insert into public.webhook_deliveries (id, org_id, mode, endpoint_id, event, payload, next_attempt_at) values
  ('d1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'test', 'e1000000-0000-0000-0000-000000000001', 'e', '{}', '2026-01-01T00:00:00Z'),
  ('d1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'test', 'e1000000-0000-0000-0000-000000000001', 'e', '{}', '2026-01-01T00:00:00Z'),
  ('d1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'test', 'e1000000-0000-0000-0000-000000000001', 'e', '{}', '2026-01-02T00:00:00Z');

select is((select count(*)::int from public.claim_webhook_deliveries(10, '2026-01-01T00:00:01Z')), 2, 'claims the two due rows');
select is((select count(*)::int from public.claim_webhook_deliveries(10, '2026-01-01T00:00:02Z')), 0, 'second call claims none');
select is((select next_attempt_at from public.webhook_deliveries where id = 'd1000000-0000-0000-0000-000000000003'), '2026-01-02T00:00:00Z'::timestamptz, 'future row untouched');

select * from finish();
rollback;
