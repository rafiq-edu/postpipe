begin;
select plan(2);

select is((select relrowsecurity from pg_class where oid = 'public.billing_events'::regclass), true, 'billing_events has RLS enabled');
select has_column('public', 'organizations', 'plan_ends_at', 'organizations has plan_ends_at');

select * from finish();
rollback;
