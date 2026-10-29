-- Lockout counter for app-password logins on a connect session.
alter table public.connect_sessions add column failed_attempts integer not null default 0;

-- Atomic: one statement adds 1, and at 5 failures closes the session (used_at, as a claim does).
create function public.record_connect_failure(p_session_id uuid)
returns integer
language sql set search_path = '' as $$
  update public.connect_sessions
  set failed_attempts = failed_attempts + 1,
      used_at = case when failed_attempts + 1 >= 5 then coalesce(used_at, now()) else used_at end
  where id = p_session_id
  returning failed_attempts
$$;
revoke execute on function public.record_connect_failure(uuid) from public, anon, authenticated;
