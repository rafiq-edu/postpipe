-- TikTok gives a publish_id at init; its inbound event finds the target by it.
alter table public.social_post_targets add column platform_publish_id text;
create unique index social_post_targets_platform_publish_id_key
  on public.social_post_targets (platform, platform_publish_id) where platform_publish_id is not null;
-- Same column-level pattern as 0015: authenticated has no table grant, so the new column needs its own grant (publish_state stays hidden).
grant select (platform_publish_id) on public.social_post_targets to authenticated;
