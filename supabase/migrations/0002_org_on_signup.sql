create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  new_org uuid;
begin
  insert into public.organizations (name)
  values (coalesce(split_part(new.email, '@', 1), 'My organization'))
  returning id into new_org;
  insert into public.members (org_id, user_id, role) values (new_org, new.id, 'owner');
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
