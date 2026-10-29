-- publish_state can hold signed upload URLs and upload tokens mid-upload: org members must not read it.
-- Column revokes are no-ops under a table grant, so drop the table grant and grant every other column (same as social_accounts in 0001).
revoke select on public.social_post_targets from authenticated;
grant select (id, org_id, mode, post_id, social_account_id, platform, status, attempts, next_attempt_at, locked_at,
  started_at, platform_post_id, platform_post_url, error_code, error_message, raw_error, published_at, created_at)
  on public.social_post_targets to authenticated;
