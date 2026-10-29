create function public.claim_webhook_deliveries(p_limit int, p_now timestamptz default now())
returns setof public.webhook_deliveries
language sql set search_path = '' as $$
  update public.webhook_deliveries d
  set next_attempt_at = p_now + interval '10 minutes'
  where d.id in (
    select id from public.webhook_deliveries
    where status = 'pending' and next_attempt_at <= p_now
    order by next_attempt_at
    limit p_limit
    for update skip locked
  )
  returning d.*
$$;
revoke execute on function public.claim_webhook_deliveries(int, timestamptz) from public, anon, authenticated;
