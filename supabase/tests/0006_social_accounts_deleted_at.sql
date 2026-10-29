begin;
select plan(2);

select has_column('public', 'social_accounts', 'deleted_at', 'social_accounts has deleted_at');
select has_column('public', 'social_accounts_public', 'deleted_at', 'social_accounts_public has deleted_at');

select * from finish();
rollback;
