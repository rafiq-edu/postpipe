alter table public.social_accounts add column deleted_at timestamptz null;
create or replace view public.social_accounts_public with (security_invoker = true) as
  select id, org_id, mode, platform, external_id, platform_user_id, display_name, avatar_url, username, status,
    key_version, token_expires_at, refresh_expires_at, expiring_notified_at, scopes, platform_data, created_at, updated_at, deleted_at
  from public.social_accounts;
-- column-level grants (see 0001): the security_invoker view needs this one too
grant select (deleted_at) on public.social_accounts to authenticated;
