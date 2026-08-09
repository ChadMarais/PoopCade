-- Read-only operational queries for the Supabase SQL editor.
-- "Guest sessions" are browser-tab sessions, not unique people or devices.

-- A. Overall snapshot.
select
  (select count(*) from public.profiles) as registered_users,
  (select count(distinct player_id) from public.runs) as signed_in_players_who_have_played,
  (select count(*) from public.guest_sessions) as guest_sessions,
  (select count(*) from public.runs) as signed_in_runs,
  (select count(*) from public.guest_runs) as guest_runs,
  round((select coalesce(sum(duration_ms), 0) / 60000.0 from public.runs), 1) as signed_in_minutes,
  round((select coalesce(sum(duration_ms), 0) / 60000.0 from public.guest_runs), 1) as guest_minutes,
  round((select avg(duration_ms) / 1000.0 from public.runs), 1) as signed_in_avg_run_seconds,
  round((select avg(duration_ms) / 1000.0 from public.guest_runs), 1) as guest_avg_run_seconds;

-- B. Per-game lifetime breakdown.
with signed_in as (
  select game_id, count(*) runs, count(distinct player_id) players, sum(duration_ms) duration_ms
  from public.runs group by game_id
), guests as (
  select game_id, count(*) runs, count(distinct guest_session_id) sessions, sum(duration_ms) duration_ms
  from public.guest_runs group by game_id
)
select g.slug, g.name,
  coalesce(s.players, 0) as signed_in_players,
  coalesce(s.runs, 0) as signed_in_runs,
  coalesce(gu.sessions, 0) as guest_sessions_with_runs,
  coalesce(gu.runs, 0) as guest_runs,
  round(coalesce(s.duration_ms, 0) / 60000.0, 1) as signed_in_minutes,
  round(coalesce(gu.duration_ms, 0) / 60000.0, 1) as guest_minutes
from public.games g
left join signed_in s on s.game_id = g.id
left join guests gu on gu.game_id = g.id
order by g.created_at;

-- C. Last 24 hours.
select
  (select count(*) from public.guest_sessions where started_at >= now() - interval '24 hours') as guest_sessions_started,
  (select count(*) from public.runs where created_at >= now() - interval '24 hours') as signed_in_runs,
  (select count(*) from public.guest_runs where created_at >= now() - interval '24 hours') as guest_runs,
  round((select coalesce(sum(duration_ms), 0) / 60000.0 from public.runs where created_at >= now() - interval '24 hours'), 1) as signed_in_minutes,
  round((select coalesce(sum(duration_ms), 0) / 60000.0 from public.guest_runs where created_at >= now() - interval '24 hours'), 1) as guest_minutes;

-- D. Last 7 days.
select
  (select count(*) from public.guest_sessions where started_at >= now() - interval '7 days') as guest_sessions_started,
  (select count(*) from public.runs where created_at >= now() - interval '7 days') as signed_in_runs,
  (select count(*) from public.guest_runs where created_at >= now() - interval '7 days') as guest_runs,
  round((select coalesce(sum(duration_ms), 0) / 60000.0 from public.runs where created_at >= now() - interval '7 days'), 1) as signed_in_minutes,
  round((select coalesce(sum(duration_ms), 0) / 60000.0 from public.guest_runs where created_at >= now() - interval '7 days'), 1) as guest_minutes;

-- E. Current active guest-session estimate (last heartbeat within 2 minutes).
select count(*) as active_guest_sessions_estimate
from public.guest_sessions
where last_seen_at >= now() - interval '2 minutes';

-- F. Average completed runs per guest session.
select round(avg(run_count), 2) as average_runs_per_guest_session
from (
  select s.id, count(r.id) as run_count
  from public.guest_sessions s
  left join public.guest_runs r on r.guest_session_id = s.id
  group by s.id
) session_runs;

-- G. Game popularity by all completed runs.
with signed_in as (
  select game_id, count(*) runs from public.runs group by game_id
), guests as (
  select game_id, count(*) runs from public.guest_runs group by game_id
)
select g.slug, g.name,
  coalesce(s.runs, 0) as signed_in_runs,
  coalesce(gu.runs, 0) as guest_runs,
  coalesce(s.runs, 0) + coalesce(gu.runs, 0) as total_runs
from public.games g
left join signed_in s on s.game_id = g.id
left join guests gu on gu.game_id = g.id
order by total_runs desc, g.slug;

-- H. Daily activity trend for the last 14 days.
with days as (
  select generate_series(current_date - 13, current_date, interval '1 day')::date as day
), signed_in as (
  select created_at::date day, count(*) runs from public.runs
  where created_at >= current_date - 13 group by created_at::date
), guests as (
  select created_at::date day, count(*) runs from public.guest_runs
  where created_at >= current_date - 13 group by created_at::date
), sessions as (
  select started_at::date day, count(*) sessions from public.guest_sessions
  where started_at >= current_date - 13 group by started_at::date
)
select d.day,
  coalesce(s.sessions, 0) as guest_sessions_started,
  coalesce(si.runs, 0) as signed_in_runs,
  coalesce(g.runs, 0) as guest_runs
from days d
left join signed_in si on si.day = d.day
left join guests g on g.day = d.day
left join sessions s on s.day = d.day
order by d.day;
