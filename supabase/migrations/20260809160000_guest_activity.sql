begin;

create table public.guest_sessions (
  id uuid primary key,
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.guest_runs (
  id uuid primary key default gen_random_uuid(),
  guest_session_id uuid not null references public.guest_sessions(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete restrict,
  client_run_id uuid unique not null,
  score integer not null check (score >= 0),
  duration_ms bigint not null check (duration_ms > 0),
  created_at timestamptz not null default now()
);

create index guest_sessions_last_seen_at_idx
  on public.guest_sessions (last_seen_at desc);
create index guest_runs_game_id_idx
  on public.guest_runs (game_id);
create index guest_runs_created_at_idx
  on public.guest_runs (created_at desc);

alter table public.guest_sessions enable row level security;
alter table public.guest_runs enable row level security;

-- Guest activity is accepted only through the server-side Edge Function.
-- No browser role can read or mutate the raw analytics tables.
revoke all on table public.guest_sessions from public, anon, authenticated;
revoke all on table public.guest_runs from public, anon, authenticated;

grant select, insert, update on table public.guest_sessions to service_role;
grant select, insert on table public.guest_runs to service_role;

commit;
