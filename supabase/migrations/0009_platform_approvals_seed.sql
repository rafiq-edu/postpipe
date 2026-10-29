-- Seed from docs/VERIFICATIONS.md status board (2026-10-27).
insert into public.platform_approvals (platform, status, note) values
  ('bluesky', 'not_needed', 'No app review needed'),
  ('instagram', 'in_progress', 'App Review and Business Verification in progress'),
  ('facebook', 'in_progress', 'Business Verification in progress, App Review not started'),
  ('threads', 'not_started', 'App Review not started'),
  ('tiktok', 'not_started', 'App review not started'),
  ('pinterest', 'not_started', 'Trial access not applied'),
  ('youtube', 'not_started', 'OAuth verification and audit not started'),
  ('linkedin', 'not_started', 'Community Management API not applied'),
  ('x', 'not_started', 'Use case review not started'),
  ('mock', 'not_needed', 'Test platform')
on conflict (platform) do update
  set status = excluded.status, note = excluded.note, updated_at = now();
