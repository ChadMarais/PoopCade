-- Run this in the Supabase SQL Editor.
-- The slug is an internal compatibility key used by clients, leaderboards,
-- Edge Functions, and existing run history. Only change the display name.

begin;

update public.games
set name = 'NEBULA MURDERBALL'
where slug = 'dusty-orbit'
  and name is distinct from 'NEBULA MURDERBALL';

commit;

-- Confirm the final database value.
select id, slug, name, active, created_at
from public.games
where slug = 'dusty-orbit';
