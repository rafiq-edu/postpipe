-- PostPipe initial schema. API routes use the service role; members get read-only RLS access.

create type public.member_role as enum ('owner', 'member');
create type public.platform_approval_status as enum ('not_started', 'in_progress', 'approved', 'rejected', 'not_needed');
create type public.social_account_status as enum ('connected', 'expired', 'revoked', 'disconnected');
create type public.media_status as enum ('uploaded', 'validated', 'failed');
create type public.social_post_status as enum ('draft', 'scheduled', 'processing', 'completed', 'partial', 'failed', 'cancelled');
create type public.social_post_target_status as enum ('pending', 'running', 'success', 'error', 'cancelled');
create type public.publish_run_status as enum ('running', 'success', 'error');
create type public.webhook_delivery_status as enum ('pending', 'delivered', 'dead');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free',
  billing_customer_id text null,
  branding jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'member',
  primary key (org_id, user_id)
);
create index members_user_id_idx on public.members (user_id);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,
  last4 text not null,
  mode text not null check (mode in ('live', 'test')),
  last_used_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now()
);
create index api_keys_org_id_idx on public.api_keys (org_id);

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  mode text not null check (mode in ('live', 'test')),
  platform text not null,
  external_id text not null,
  platform_user_id text not null,
  display_name text null,
  avatar_url text null,
  username text null,
  status public.social_account_status not null default 'connected',
  access_token_enc text null,
  refresh_token_enc text null,
  key_version int not null default 1,
  token_expires_at timestamptz null,
  refresh_expires_at timestamptz null,
  expiring_notified_at timestamptz null,
  scopes text[] not null default '{}',
  platform_data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, platform, platform_user_id)
);
create index social_accounts_list_idx on public.social_accounts (org_id, mode, created_at desc);
create index social_accounts_external_idx on public.social_accounts (org_id, external_id, platform);

create table public.connect_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  mode text not null check (mode in ('live', 'test')),
  platform text not null,
  external_id text not null,
  redirect_url text null,
  state text not null,
  token_hash text not null unique,
  pkce_verifier_enc text null,
  platform_data jsonb not null default '{}',
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_at timestamptz not null default now()
);
create index connect_sessions_org_id_idx on public.connect_sessions (org_id);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  mode text not null check (mode in ('live', 'test')),
  storage_path text not null,
  mime text not null,
  bytes bigint not null,
  width int null,
  height int null,
  duration_ms int null,
  status public.media_status not null default 'uploaded',
  last_used_at timestamptz null,
  created_at timestamptz not null default now()
);
create index media_list_idx on public.media (org_id, mode, created_at desc);

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  mode text not null check (mode in ('live', 'test')),
  external_id text null,
  caption text null,
  media_ids uuid[] not null default '{}',
  platform_configurations jsonb not null default '{}',
  scheduled_at timestamptz null,
  status public.social_post_status not null default 'draft',
  idempotency_key text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index social_posts_list_idx on public.social_posts (org_id, mode, created_at desc);

create table public.social_post_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  mode text not null check (mode in ('live', 'test')),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  platform text not null,
  status public.social_post_target_status not null default 'pending',
  attempts int not null default 0,
  next_attempt_at timestamptz null,
  locked_at timestamptz null,
  started_at timestamptz null,
  publish_state jsonb null,
  platform_post_id text null,
  platform_post_url text null,
  error_code text null,
  error_message text null,
  raw_error jsonb null,
  published_at timestamptz null,
  created_at timestamptz not null default now()
);
create index social_post_targets_org_id_idx on public.social_post_targets (org_id);
create index social_post_targets_post_id_idx on public.social_post_targets (post_id);
create index social_post_targets_account_idx on public.social_post_targets (social_account_id);
create index social_post_targets_queue_idx on public.social_post_targets (status, next_attempt_at);

create table public.publish_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  target_id uuid not null references public.social_post_targets(id) on delete cascade,
  step text not null,
  status public.publish_run_status not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  detail jsonb null
);
create index publish_runs_org_id_idx on public.publish_runs (org_id);
create index publish_runs_target_id_idx on public.publish_runs (target_id);

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  mode text not null check (mode in ('live', 'test')),
  url text not null,
  secret_enc text not null,
  events text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index webhook_endpoints_list_idx on public.webhook_endpoints (org_id, mode, created_at desc);

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  mode text not null check (mode in ('live', 'test')),
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  attempt int not null default 0,
  status public.webhook_delivery_status not null default 'pending',
  response_code int null,
  next_attempt_at timestamptz null,
  delivered_at timestamptz null,
  created_at timestamptz not null default now()
);
create index webhook_deliveries_org_id_idx on public.webhook_deliveries (org_id);
create index webhook_deliveries_endpoint_idx on public.webhook_deliveries (endpoint_id);
create index webhook_deliveries_queue_idx on public.webhook_deliveries (status, next_attempt_at);

create table public.idempotency_keys (
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  request_hash text not null,
  response jsonb null,
  expires_at timestamptz not null,
  primary key (org_id, key)
);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  mode text not null check (mode in ('live', 'test')),
  target_id uuid null references public.social_post_targets(id) on delete set null,
  kind text not null,
  quantity int not null default 1,
  occurred_at timestamptz not null default now(),
  unique (target_id, kind)
);
create index usage_events_org_idx on public.usage_events (org_id, occurred_at desc);
create index usage_events_target_idx on public.usage_events (target_id);

create table public.platform_approvals (
  platform text primary key,
  status public.platform_approval_status not null default 'not_started',
  note text null,
  updated_at timestamptz not null default now()
);

create table public.scheduled_jobs (
  name text primary key,
  last_run_at timestamptz null
);

create table public.rate_limits (
  api_key_id uuid not null references public.api_keys(id) on delete cascade,
  minute timestamptz not null,
  count int not null default 0,
  primary key (api_key_id, minute)
);

create table public.platform_quotas (
  scope text not null,
  day date not null,
  count int not null default 0,
  primary key (scope, day)
);

create table public.meta_deletion_requests (
  confirmation_code text primary key,
  platform_user_id text not null,
  status text not null,
  created_at timestamptz not null default now()
);

-- RLS on every table
alter table public.organizations enable row level security;
alter table public.members enable row level security;
alter table public.api_keys enable row level security;
alter table public.social_accounts enable row level security;
alter table public.connect_sessions enable row level security;
alter table public.media enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_post_targets enable row level security;
alter table public.publish_runs enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.usage_events enable row level security;
alter table public.platform_approvals enable row level security;
alter table public.scheduled_jobs enable row level security;
alter table public.rate_limits enable row level security;
alter table public.platform_quotas enable row level security;
alter table public.meta_deletion_requests enable row level security;

-- security definer so the members policy does not recurse
create function public.member_org_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$ select org_id from public.members where user_id = (select auth.uid()) $$;
revoke execute on function public.member_org_ids() from public, anon;
grant execute on function public.member_org_ids() to authenticated;

create policy organizations_select on public.organizations for select to authenticated
  using (id in (select public.member_org_ids()));
create policy members_select on public.members for select to authenticated
  using (org_id in (select public.member_org_ids()));

create policy api_keys_select on public.api_keys for select to authenticated
  using (org_id in (select public.member_org_ids()));
create policy social_accounts_select on public.social_accounts for select to authenticated
  using (org_id in (select public.member_org_ids()));
create policy connect_sessions_select on public.connect_sessions for select to authenticated
  using (org_id in (select public.member_org_ids()));
create policy media_select on public.media for select to authenticated
  using (org_id in (select public.member_org_ids()));
create policy social_posts_select on public.social_posts for select to authenticated
  using (org_id in (select public.member_org_ids()));
create policy social_post_targets_select on public.social_post_targets for select to authenticated
  using (org_id in (select public.member_org_ids()));
create policy publish_runs_select on public.publish_runs for select to authenticated
  using (org_id in (select public.member_org_ids()));
create policy webhook_endpoints_select on public.webhook_endpoints for select to authenticated
  using (org_id in (select public.member_org_ids()));
create policy webhook_deliveries_select on public.webhook_deliveries for select to authenticated
  using (org_id in (select public.member_org_ids()));
create policy usage_events_select on public.usage_events for select to authenticated
  using (org_id in (select public.member_org_ids()));
create policy platform_approvals_select on public.platform_approvals for select to anon, authenticated
  using (true);
-- rate_limits, platform_quotas, scheduled_jobs, meta_deletion_requests, idempotency_keys: RLS on, no policies (service role only)

-- privileges: read-only for API roles, secrets hidden
revoke insert, update, delete on all tables in schema public from anon, authenticated;
-- Explicit table grants (not guaranteed by default privileges); writes stay with the service role.
grant select on public.organizations, public.members, public.social_posts, public.social_post_targets,
  public.publish_runs, public.media, public.webhook_deliveries, public.usage_events to authenticated;
grant select on public.platform_approvals to anon, authenticated;
grant select on public.api_keys, public.social_accounts, public.connect_sessions, public.webhook_endpoints to authenticated;

-- Column revokes are no-ops while a table-level grant exists, so drop the table grant and grant the safe columns.
revoke select on public.api_keys, public.social_accounts, public.connect_sessions, public.webhook_endpoints from anon, authenticated;
grant select (id, org_id, name, key_prefix, last4, mode, last_used_at, revoked_at, created_at) on public.api_keys to authenticated;
grant select (id, org_id, mode, platform, external_id, platform_user_id, display_name, avatar_url, username, status,
  key_version, token_expires_at, refresh_expires_at, expiring_notified_at, scopes, platform_data, created_at, updated_at)
  on public.social_accounts to authenticated;
grant select (id, org_id, mode, platform, external_id, redirect_url, platform_data, expires_at, used_at, created_at)
  on public.connect_sessions to authenticated;
grant select (id, org_id, mode, url, events, enabled, created_at) on public.webhook_endpoints to authenticated;

create view public.api_keys_public with (security_invoker = true) as
  select id, org_id, name, key_prefix, last4, mode, last_used_at, revoked_at, created_at from public.api_keys;
create view public.social_accounts_public with (security_invoker = true) as
  select id, org_id, mode, platform, external_id, platform_user_id, display_name, avatar_url, username, status,
    key_version, token_expires_at, refresh_expires_at, expiring_notified_at, scopes, platform_data, created_at, updated_at
  from public.social_accounts;
revoke all on public.api_keys_public, public.social_accounts_public from anon, authenticated;
grant select on public.api_keys_public, public.social_accounts_public to authenticated;
