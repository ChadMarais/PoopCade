import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("homepage routes its primary leaderboard link to the overall board", () => {
  const homepage = read("index.html");
  assert.match(homepage, /href="\/leaderboard\/"[^>]*><span class="nav-full">Leaderboard/);
});

test("overall leaderboard ranks best per-game placements with rank points", () => {
  const migration = read("supabase/migrations/20260814160000_add_overall_leaderboard.sql");
  assert.match(migration, /create or replace function public\.get_overall_leaderboard/);
  assert.match(migration, /distinct on \(pb\.player_id, pb\.game_id\)/);
  assert.match(migration, /101::bigint - gp\.game_rank/);
  assert.match(migration, /partition by bpg\.game_id/);
  assert.match(migration, /pt\.rank_points desc/);
});

test("BALLS OUT migration adds the fourth placement column", () => {
  const migration = read("supabase/migrations/20260820120000_add_balls_out.sql");
  assert.match(migration, /values \('balls-out', 'BALLS OUT', true\)/);
  assert.match(migration, /balls_out_rank bigint/);
  assert.match(migration, /gp\.slug = 'balls-out'/);
});

test("every leaderboard provides direct navigation to all boards", () => {
  const pages = [
    "leaderboard/index.html",
    "leaderboard/orbit-shift/index.html",
    "leaderboard/next/index.html",
    "leaderboard/dusty-orbit/index.html",
    "leaderboard/balls-out/index.html",
  ];
  const expected = [
    'href="/leaderboard/"',
    'href="/leaderboard/orbit-shift/"',
    'href="/leaderboard/next/"',
    'href="/leaderboard/dusty-orbit/"',
    'href="/leaderboard/balls-out/"',
  ];
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /class="board-tabs"/);
    for (const href of expected) assert.ok(html.includes(href), `${page} is missing ${href}`);
  }
});

test("overall client loads and renders the aggregate RPC", () => {
  const client = read("js/leaderboard.js");
  const page = read("leaderboard/index.html");
  assert.match(client, /supabase\.rpc\("get_overall_leaderboard"/);
  assert.match(client, /entry\.total_games/);
  assert.match(page, /data-overall-leaderboard-page/);
  assert.match(page, /<th>Rank points<\/th>/);
});
