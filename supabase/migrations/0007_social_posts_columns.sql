alter table public.social_posts
  add column media jsonb not null default '[]',
  add column social_account_ids uuid[] not null default '{}',
  add column account_configurations jsonb not null default '[]';
