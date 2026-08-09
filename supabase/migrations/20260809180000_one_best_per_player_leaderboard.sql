begin;

-- Leaderboards are projections of player_bests, never raw run history.
-- player_bests is already protected by its primary key on
-- (player_id, game_id, difficulty), so an ORBIT//SHIFT player can contribute
-- at most one Easy, one Medium, and one Hard score.
create or replace function public.get_leaderboard(
  game_slug text,
  difficulty_filter text,
  result_limit integer default 50
)
returns table (
  rank bigint,
  display_name text,
  score integer,
  level integer,
  difficulty text,
  achieved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_difficulty text;
  safe_limit integer;
begin
  if game_slug is null or btrim(game_slug) = '' then
    raise exception 'game_slug is required' using errcode = '22023';
  end if;

  normalized_difficulty := initcap(lower(coalesce(btrim(difficulty_filter), 'All')));
  if normalized_difficulty not in ('All', 'Easy', 'Medium', 'Hard') then
    raise exception 'invalid difficulty_filter' using errcode = '22023';
  end if;

  safe_limit := least(greatest(coalesce(result_limit, 50), 1), 100);

  return query
  with eligible_bests as (
    select
      pb.player_id,
      pb.game_id,
      pb.difficulty,
      pb.best_score,
      pb.best_level,
      p.display_name,
      coalesce(r.created_at, pb.updated_at) as achieved_at
    from public.player_bests as pb
    join public.profiles as p on p.id = pb.player_id
    join public.games as g on g.id = pb.game_id
    left join public.runs as r on r.id = pb.best_run_id
    where g.slug = lower(btrim(game_slug))
      and g.active = true
      and (normalized_difficulty = 'All' or pb.difficulty = normalized_difficulty)
  )
  select
    row_number() over (
      order by eb.best_score desc,
               eb.best_level desc,
               eb.achieved_at asc,
               lower(eb.display_name) asc,
               eb.player_id asc
    ) as rank,
    eb.display_name,
    eb.best_score as score,
    eb.best_level as level,
    eb.difficulty,
    eb.achieved_at
  from eligible_bests as eb
  order by eb.best_score desc,
           eb.best_level desc,
           eb.achieved_at asc,
           lower(eb.display_name) asc,
           eb.player_id asc
  limit safe_limit;
end;
$$;

revoke execute on function public.get_leaderboard(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.get_leaderboard(text, text, integer)
  to anon, authenticated;

commit;
