-- Final review fixes.

-- H: post status rollup in one statement, so concurrent target finishes cannot overwrite each other.
create function public.rollup_post_status(p_post_id uuid)
returns void
language sql set search_path = '' as $$
  update public.social_posts p set status = s.status
  from (
    select case
      when bool_or(t.status in ('pending', 'running')) then 'processing'
      when bool_and(t.status = 'success') then 'completed'
      when not bool_or(t.status = 'success') then 'failed'
      else 'partial'
    end::public.social_post_status as status
    from public.social_post_targets t
    where t.post_id = p_post_id and t.status <> 'cancelled'
    having count(*) > 0
  ) s
  where p.id = p_post_id and p.status <> 'cancelled' and p.status <> s.status
$$;
revoke execute on function public.rollup_post_status(uuid) from public, anon, authenticated;

-- J: reclaiming a stale running target that kept its publish_state counts as an attempt,
-- so a step that crashes the worker every time cannot loop forever.
create or replace function public.claim_due_targets(p_limit int, p_now timestamptz)
returns setof public.social_post_targets
language sql set search_path = '' as $$
  update public.social_post_targets t set locked_at = p_now, status = 'pending',
    attempts = case when t.status = 'running' and t.publish_state is not null
      then t.attempts + 1 else t.attempts end
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
