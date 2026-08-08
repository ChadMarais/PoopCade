begin;

-- Public aggregate used by the homepage. Returning only the count avoids
-- exposing profile identifiers or expanding the browser's table privileges.
create or replace function public.get_total_players()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::bigint
  from public.profiles;
$$;

revoke execute on function public.get_total_players() from public, anon, authenticated;
grant execute on function public.get_total_players() to anon, authenticated;

commit;
