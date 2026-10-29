begin;
select plan(5);

select ok(has_column_privilege('authenticated', 'public.social_post_targets', 'platform_publish_id', 'SELECT'), 'authenticated can select platform_publish_id');
select ok(not has_column_privilege('authenticated', 'public.social_post_targets', 'publish_state', 'SELECT'), 'authenticated still cannot select publish_state');
select ok(not has_column_privilege('anon', 'public.social_post_targets', 'platform_publish_id', 'SELECT'), 'anon cannot select platform_publish_id');
select ok(has_column_privilege('service_role', 'public.social_post_targets', 'platform_publish_id', 'SELECT'), 'service_role can select platform_publish_id');
select has_index('public', 'social_post_targets', 'social_post_targets_platform_publish_id_key', 'unique index exists');

select * from finish();
rollback;
