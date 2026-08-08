begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_trimmed
    check (display_name = btrim(display_name)),
  constraint profiles_display_name_length
    check (char_length(display_name) between 3 and 20),
  constraint profiles_display_name_characters
    check (display_name ~ '^[[:alnum:] _-]+$'),
  constraint profiles_display_name_not_email
    check (position('@' in display_name) = 0)
);

create unique index profiles_display_name_lower_uidx
  on public.profiles (lower(display_name));

create table public.games (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint games_slug_format
    check (slug = lower(btrim(slug)) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint games_name_not_blank
    check (char_length(btrim(name)) between 1 and 80)
);

insert into public.games (slug, name, active)
values ('orbit-shift', 'ORBIT//SHIFT', true)
on conflict (slug) do update
set name = excluded.name,
    active = excluded.active;

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  client_run_id uuid unique not null,
  player_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid not null references public.games(id),
  score integer not null,
  difficulty text not null,
  level integer not null,
  gates integer not null default 0,
  style_bonuses integer not null default 0,
  duration_ms bigint not null,
  created_at timestamptz not null default now(),
  constraint runs_score_nonnegative check (score >= 0),
  constraint runs_level_positive check (level >= 1),
  constraint runs_gates_nonnegative check (gates >= 0),
  constraint runs_style_bonuses_nonnegative check (style_bonuses >= 0),
  constraint runs_duration_positive check (duration_ms > 0),
  constraint runs_difficulty_allowed check (difficulty in ('Easy', 'Medium', 'Hard'))
);

create table public.player_bests (
  player_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  difficulty text not null,
  best_score integer not null,
  best_level integer not null,
  best_run_id uuid references public.runs(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (player_id, game_id, difficulty),
  constraint player_bests_score_nonnegative check (best_score >= 0),
  constraint player_bests_level_positive check (best_level >= 1),
  constraint player_bests_difficulty_allowed check (difficulty in ('Easy', 'Medium', 'Hard'))
);

create index runs_leaderboard_order_idx
  on public.runs (game_id, difficulty, score desc, level desc, created_at asc);

create index runs_player_history_idx
  on public.runs (player_id, created_at desc);

create index runs_game_difficulty_idx
  on public.runs (game_id, difficulty, created_at desc);

create index player_bests_leaderboard_idx
  on public.player_bests (game_id, difficulty, best_score desc, best_level desc, updated_at asc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_name text;
begin
  -- Deliberately derive the public gamer name only from the UUID. Never copy
  -- email, provider metadata, or a Google account name into public.profiles.
  generated_name := 'Player-' || upper(substr(replace(new.id::text, '-', ''), 1, 12));

  insert into public.profiles (id, display_name)
  values (new.id, generated_name);

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

-- Safely cover any accounts that existed before this first migration.
insert into public.profiles (id, display_name)
select u.id,
       'Player-' || upper(substr(replace(u.id::text, '-', ''), 1, 12))
from auth.users as u
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.runs enable row level security;
alter table public.player_bests enable row level security;

create policy profiles_public_read
on public.profiles
for select
to anon, authenticated
using (true);

create policy profiles_owner_update
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy games_active_read
on public.games
for select
to anon, authenticated
using (active = true);

create policy runs_owner_read
on public.runs
for select
to authenticated
using ((select auth.uid()) = player_id);

create policy player_bests_active_game_read
on public.player_bests
for select
to anon, authenticated
using (
  game_id in (
    select g.id
    from public.games as g
    where g.active = true
  )
);

create policy player_bests_owner_read
on public.player_bests
for select
to authenticated
using ((select auth.uid()) = player_id);

-- Remove any automatic Data API privileges, then grant only what the browser
-- actually needs. There are intentionally no browser INSERT or DELETE grants.
revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.games from public, anon, authenticated;
revoke all on table public.runs from public, anon, authenticated;
revoke all on table public.player_bests from public, anon, authenticated;

grant select (display_name) on table public.profiles to anon;
grant select (display_name) on table public.profiles to authenticated;
grant select on table public.games to anon, authenticated;
grant select on table public.runs to authenticated;

-- The Edge Function needs only read access for validation. All writes happen
-- inside the narrowly granted atomic submit_run function below.
grant select on table public.games, public.runs to service_role;

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
  select
    row_number() over (
      order by pb.best_score desc,
               pb.best_level desc,
               r.created_at asc,
               lower(p.display_name) asc,
               p.id asc
    ) as rank,
    p.display_name,
    pb.best_score as score,
    pb.best_level as level,
    pb.difficulty,
    r.created_at as achieved_at
  from public.player_bests as pb
  join public.profiles as p on p.id = pb.player_id
  join public.games as g on g.id = pb.game_id
  left join public.runs as r on r.id = pb.best_run_id
  where g.slug = lower(btrim(game_slug))
    and g.active = true
    and (normalized_difficulty = 'All' or pb.difficulty = normalized_difficulty)
  order by pb.best_score desc,
           pb.best_level desc,
           r.created_at asc,
           lower(p.display_name) asc,
           p.id asc
  limit safe_limit;
end;
$$;

create or replace function public.get_my_profile()
returns table (display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name
  from public.profiles as p
  where p.id = (select auth.uid());
$$;

create or replace function public.update_my_display_name(new_display_name text)
returns table (display_name text)
language sql
volatile
security definer
set search_path = ''
as $$
  update public.profiles as p
  set display_name = btrim(new_display_name)
  where p.id = (select auth.uid())
  returning p.display_name;
$$;

create or replace function public.get_my_bests(game_slug text default 'orbit-shift')
returns table (
  difficulty text,
  score integer,
  level integer,
  achieved_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select pb.difficulty,
         pb.best_score as score,
         pb.best_level as level,
         r.created_at as achieved_at
  from public.player_bests as pb
  join public.games as g on g.id = pb.game_id
  left join public.runs as r on r.id = pb.best_run_id
  where pb.player_id = (select auth.uid())
    and g.slug = lower(btrim(game_slug))
    and g.active = true
  order by case pb.difficulty
    when 'Easy' then 1
    when 'Medium' then 2
    when 'Hard' then 3
    else 4
  end;
$$;

-- Server-only transactional write path. The Edge Function validates the JWT
-- and payload first; this function guarantees run + best consistency.
create or replace function public.submit_run(
  p_client_run_id uuid,
  p_player_id uuid,
  p_game_slug text,
  p_score integer,
  p_difficulty text,
  p_level integer,
  p_gates integer,
  p_style_bonuses integer,
  p_duration_ms bigint
)
returns table (
  accepted boolean,
  score integer,
  personal_best integer,
  new_personal_best boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_game_id uuid;
  inserted_run_id uuid;
  resulting_best integer;
  best_changed boolean;
begin
  select g.id into selected_game_id
  from public.games as g
  where g.slug = lower(btrim(p_game_slug))
    and g.active = true;

  if selected_game_id is null then
    raise exception 'unknown or inactive game' using errcode = '22023';
  end if;

  insert into public.runs (
    client_run_id,
    player_id,
    game_id,
    score,
    difficulty,
    level,
    gates,
    style_bonuses,
    duration_ms
  ) values (
    p_client_run_id,
    p_player_id,
    selected_game_id,
    p_score,
    p_difficulty,
    p_level,
    p_gates,
    p_style_bonuses,
    p_duration_ms
  )
  returning id into inserted_run_id;

  insert into public.player_bests (
    player_id,
    game_id,
    difficulty,
    best_score,
    best_level,
    best_run_id,
    updated_at
  ) values (
    p_player_id,
    selected_game_id,
    p_difficulty,
    p_score,
    p_level,
    inserted_run_id,
    now()
  )
  on conflict (player_id, game_id, difficulty) do update
  set best_score = excluded.best_score,
      best_level = excluded.best_level,
      best_run_id = excluded.best_run_id,
      updated_at = now()
  where excluded.best_score > public.player_bests.best_score
  returning best_score into resulting_best;

  best_changed := found;

  if not best_changed then
    select pb.best_score into resulting_best
    from public.player_bests as pb
    where pb.player_id = p_player_id
      and pb.game_id = selected_game_id
      and pb.difficulty = p_difficulty;
  end if;

  return query
  select true, p_score, resulting_best, best_changed;
end;
$$;

revoke execute on function public.get_leaderboard(text, text, integer) from public, anon, authenticated;
revoke execute on function public.get_my_profile() from public, anon, authenticated;
revoke execute on function public.update_my_display_name(text) from public, anon, authenticated;
revoke execute on function public.get_my_bests(text) from public, anon, authenticated;
revoke execute on function public.submit_run(uuid, uuid, text, integer, text, integer, integer, integer, bigint) from public, anon, authenticated;

grant execute on function public.get_leaderboard(text, text, integer) to anon, authenticated;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.update_my_display_name(text) to authenticated;
grant execute on function public.get_my_bests(text) to authenticated;
grant execute on function public.submit_run(uuid, uuid, text, integer, text, integer, integer, integer, bigint) to service_role;

commit;
