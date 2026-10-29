-- Bluesky OAuth stores. Service role only: RLS on, no policies, so no other role can read them.
create table public.bluesky_oauth_states (
  key text primary key,
  state_enc text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.bluesky_oauth_states enable row level security;

create table public.bluesky_oauth_sessions (
  sub text primary key,
  session_enc text not null,
  key_version integer not null,
  updated_at timestamptz not null default now()
);
alter table public.bluesky_oauth_sessions enable row level security;

-- Lease locks: refresh tokens are single-use, so one process refreshes at a time.
create table public.oauth_locks (
  name text primary key,
  expires_at timestamptz not null
);
alter table public.oauth_locks enable row level security;

revoke all on public.bluesky_oauth_states, public.bluesky_oauth_sessions, public.oauth_locks
  from public, anon, authenticated;
