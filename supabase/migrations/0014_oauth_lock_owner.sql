-- Lock owner: a holder deletes only its own row, never one taken over after its lease ended.
alter table public.oauth_locks add column owner uuid not null default gen_random_uuid();
