begin;

-- Each player's strongest saved result per game is ranked against the other
-- players in that game. Placement points make otherwise incomparable raw game
-- scores additive: #1 earns 100, #2 earns 99, through #100 earning 1.
create or replace function public.get_overall_leaderboard(result_limit integer default 50)
returns table (
  rank bigint,
  display_name text,
  rank_points bigint,
  games_ranked bigint,
  total_games bigint,
  orbit_shift_rank bigint,
  next_rank bigint,
  dusty_orbit_rank bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with best_per_game as (
    select distinct on (pb.player_id, pb.game_id)
      pb.player_id,
      pb.game_id,
      g.slug,
      pb.best_score,
      pb.best_level,
      coalesce(r.created_at, pb.updated_at) as achieved_at
    from public.player_bests as pb
    join public.games as g on g.id = pb.game_id and g.active = true
    left join public.runs as r on r.id = pb.best_run_id
    order by pb.player_id,
             pb.game_id,
             pb.best_score desc,
             pb.best_level desc,
             coalesce(r.created_at, pb.updated_at) asc,
             pb.difficulty asc
  ),
  game_placements as (
    select
      bpg.*,
      row_number() over (
        partition by bpg.game_id
        order by bpg.best_score desc,
                 bpg.best_level desc,
                 bpg.achieved_at asc,
                 bpg.player_id asc
      ) as game_rank
    from best_per_game as bpg
  ),
  player_totals as (
    select
      gp.player_id,
      sum(greatest(0::bigint, 101::bigint - gp.game_rank))::bigint as rank_points,
      count(*)::bigint as games_ranked,
      (select count(*)::bigint from public.games where active = true) as total_games,
      sum(gp.game_rank)::bigint as rank_sum,
      max(gp.game_rank) filter (where gp.slug = 'orbit-shift') as orbit_shift_rank,
      max(gp.game_rank) filter (where gp.slug = 'next') as next_rank,
      max(gp.game_rank) filter (where gp.slug = 'dusty-orbit') as dusty_orbit_rank
    from game_placements as gp
    group by gp.player_id
  ),
  ranked as (
    select
      row_number() over (
        order by pt.rank_points desc,
                 pt.games_ranked desc,
                 pt.rank_sum asc,
                 lower(p.display_name) asc,
                 pt.player_id asc
      ) as rank,
      p.display_name,
      pt.rank_points,
      pt.games_ranked,
      pt.total_games,
      pt.orbit_shift_rank,
      pt.next_rank,
      pt.dusty_orbit_rank
    from player_totals as pt
    join public.profiles as p on p.id = pt.player_id
  )
  select r.rank,
         r.display_name,
         r.rank_points,
         r.games_ranked,
         r.total_games,
         r.orbit_shift_rank,
         r.next_rank,
         r.dusty_orbit_rank
  from ranked as r
  order by r.rank
  limit least(greatest(coalesce(result_limit, 50), 1), 100);
$$;

revoke execute on function public.get_overall_leaderboard(integer)
  from public, anon, authenticated;
grant execute on function public.get_overall_leaderboard(integer)
  to anon, authenticated;

commit;
