-- Per-org developer app (bring your own platform keys). Secret is encrypted (*_enc); writes go through the service role.
create table public.platform_apps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null check (platform in ('x','linkedin','facebook','instagram','threads','tiktok','youtube','pinterest')),
  client_id text not null,
  client_secret_enc text not null,
  extra text null,
  key_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, platform)
);
alter table public.platform_apps enable row level security;
create policy platform_apps_select on public.platform_apps for select to authenticated
  using (org_id in (select public.member_org_ids()));

-- Same column-level pattern as 0001: no table grant, so client_secret_enc stays hidden from clients.
revoke all on public.platform_apps from anon, authenticated;
grant select (id, org_id, platform, client_id, extra, key_version, created_at, updated_at)
  on public.platform_apps to authenticated;

create view public.platform_apps_public with (security_invoker = true) as
  select id, org_id, platform, client_id, extra, created_at, updated_at from public.platform_apps;
revoke all on public.platform_apps_public from anon, authenticated;
grant select on public.platform_apps_public to authenticated;
