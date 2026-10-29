begin;
select plan(3);

select has_column('public', 'social_posts', 'media', 'social_posts has media');
select has_column('public', 'social_posts', 'social_account_ids', 'social_posts has social_account_ids');
select has_column('public', 'social_posts', 'account_configurations', 'social_posts has account_configurations');

select * from finish();
rollback;
