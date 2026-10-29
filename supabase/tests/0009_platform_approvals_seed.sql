begin;
select plan(2);

select is((select count(*)::int from public.platform_approvals), 10, 'ten platforms seeded');
select is((select status::text from public.platform_approvals where platform = 'bluesky'), 'not_needed', 'bluesky needs no approval');

select * from finish();
rollback;
