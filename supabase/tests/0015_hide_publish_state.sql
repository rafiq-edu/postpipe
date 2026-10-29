begin;
select plan(4);

select ok(not has_column_privilege('authenticated', 'public.social_post_targets', 'publish_state', 'SELECT'), 'authenticated cannot select publish_state');
select ok(has_column_privilege('authenticated', 'public.social_post_targets', 'status', 'SELECT'), 'authenticated can select status');
select ok(not has_column_privilege('anon', 'public.social_post_targets', 'publish_state', 'SELECT'), 'anon cannot select publish_state');
select ok(has_column_privilege('service_role', 'public.social_post_targets', 'publish_state', 'SELECT'), 'service_role can select publish_state');

select * from finish();
rollback;
