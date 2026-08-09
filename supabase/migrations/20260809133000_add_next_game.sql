begin;

-- NEXT. uses the shared run/best model in a single Standard mode. Preserve
-- every existing ORBIT//SHIFT difficulty while extending the common checks.
alter table public.runs
  drop constraint if exists runs_difficulty_allowed;
alter table public.runs
  add constraint runs_difficulty_allowed
  check (difficulty in ('Easy', 'Medium', 'Hard', 'Standard'));

alter table public.player_bests
  drop constraint if exists player_bests_difficulty_allowed;
alter table public.player_bests
  add constraint player_bests_difficulty_allowed
  check (difficulty in ('Easy', 'Medium', 'Hard', 'Standard'));

insert into public.games (slug, name, active)
values ('next', 'NEXT.', true)
on conflict (slug) do update
set name = excluded.name,
    active = excluded.active;

commit;
