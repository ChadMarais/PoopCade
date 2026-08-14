begin;

-- Keep the established slug so existing runs, leaderboard URLs, and clients
-- remain compatible; only the player-facing game name changes.
update public.games
set name = 'NEBULA MURDERBALL'
where slug = 'dusty-orbit';

commit;
