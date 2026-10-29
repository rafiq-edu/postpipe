-- Worker RPCs: each is one statement so concurrent workers never double-claim.
create function public.claim_due_targets(p_limit int, p_now timestamptz)
returns setof public.social_post_targets
language sql set search_path = '' as $$
  update public.social_post_targets t set locked_at = p_now, status = 'pending'
  where t.id in (
    select c.id from public.social_post_targets c
    join public.social_posts p on p.id = c.post_id
    where c.next_attempt_at <= p_now
      and ((c.status = 'pending' and (c.locked_at is null or c.locked_at < p_now - interval '30 minutes'))
        -- a worker died mid-step: reclaim the stale running target, publish_state is kept
        or (c.status = 'running' and c.locked_at < p_now - interval '30 minutes'))
      and p.status in ('scheduled', 'processing')
    order by c.next_attempt_at limit p_limit
    for update of c skip locked)
  returning t.*
$$;
revoke execute on function public.claim_due_targets(int, timestamptz) from public, anon, authenticated;

-- Lease column: an advisory lock cannot span PostgREST calls.
alter table public.social_accounts add column refresh_lock_at timestamptz null;

create function public.claim_token_refresh(p_account_id uuid, p_now timestamptz)
returns boolean
language sql set search_path = '' as $$
  with u as (update public.social_accounts set refresh_lock_at = p_now
    where id = p_account_id and (refresh_lock_at is null or refresh_lock_at < p_now - interval '2 minutes')
    returning true as ok)
  select coalesce((select ok from u), false)
$$;
revoke execute on function public.claim_token_refresh(uuid, timestamptz) from public, anon, authenticated;

create function public.claim_daily_job(p_name text, p_now timestamptz)
returns boolean
language sql set search_path = '' as $$
  with u as (insert into public.scheduled_jobs (name, last_run_at) values (p_name, p_now)
    on conflict (name) do update set last_run_at = p_now
    where public.scheduled_jobs.last_run_at is null or public.scheduled_jobs.last_run_at < p_now - interval '24 hours'
    returning true as ok)
  select coalesce((select ok from u), false)
$$;
revoke execute on function public.claim_daily_job(text, timestamptz) from public, anon, authenticated;

create function public.consume_quota(p_scope text, p_day date, p_cap int)
returns boolean
language sql set search_path = '' as $$
  with u as (insert into public.platform_quotas (scope, day, count) values (p_scope, p_day, 1)
    on conflict (scope, day) do update set count = public.platform_quotas.count + 1
    where public.platform_quotas.count < p_cap
    returning true as ok)
  select coalesce((select ok from u), false)
$$;
revoke execute on function public.consume_quota(text, date, int) from public, anon, authenticated;
