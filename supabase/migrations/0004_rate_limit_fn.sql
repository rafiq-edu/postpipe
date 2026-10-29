create function public.increment_rate_limit(p_api_key_id uuid, p_minute timestamptz) returns int
language sql set search_path = '' as $$
  insert into public.rate_limits (api_key_id, minute, count) values (p_api_key_id, p_minute, 1)
  on conflict (api_key_id, minute) do update set count = public.rate_limits.count + 1
  returning count
$$;
revoke execute on function public.increment_rate_limit(uuid, timestamptz) from public, anon, authenticated;
