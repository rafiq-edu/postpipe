create table public.billing_events (
  event_id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
alter table public.billing_events enable row level security;  -- service role only, no policies
alter table public.organizations add column plan_ends_at timestamptz null, add column polar_subscription_id text null;
