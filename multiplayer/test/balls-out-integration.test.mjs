import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const read = (relative) => readFile(new URL(`../../${relative}`, import.meta.url), "utf8");

test("BALLS OUT is registered across game, scoring, leaderboard, presence, and offline surfaces", async () => {
  const [game, homepage, api, presence, worker, edge, migration, account, board] = await Promise.all([
    read("games/balls-out/index.html"),
    read("index.html"),
    read("js/poopcade-api.js"),
    read("js/game-presence.js"),
    read("service-worker.js"),
    read("supabase/functions/submit-run/index.ts"),
    read("supabase/migrations/20260820120000_add_balls_out.sql"),
    read("account/index.html"),
    read("leaderboard/balls-out/index.html"),
  ]);
  assert.match(game, /submitBallsOutRun/);
  assert.match(game, /\.\/jumpscare\.webp/);
  assert.match(game, /jumpscare-scream\.mp3/);
  assert.match(game, /id="pauseButton"/);
  assert.match(game, /id="endRunButton"/);
  assert.match(homepage, /Game 04 · Single player/);
  assert.match(api, /submitGameRun\("balls-out", run\)/);
  assert.match(presence, /\["\/games\/balls-out\/", "balls-out"\]/);
  assert.match(worker, /'\/games\/balls-out\/index\.html'/);
  assert.match(worker, /'\/games\/balls-out\/dynamic-music\.js'/);
  assert.match(worker, /'\/games\/balls-out\/jumpscare-scream\.mp3'/);
  assert.match(edge, /"balls-out"/);
  assert.match(migration, /'balls-out', 'BALLS OUT'/);
  assert.match(account, /data-game="balls-out"/);
  assert.match(board, /data-game-slug="balls-out"/);
});

test("BALLS OUT bundles a real scream recording", async () => {
  const file = new URL("../../games/balls-out/jumpscare-scream.mp3", import.meta.url);
  const info = await stat(file);
  const header = await readFile(file).then((buffer) => buffer.subarray(0, 3));
  assert.ok(info.size > 100_000);
  assert.ok(header.toString("ascii") === "ID3" || header[0] === 0xff);
});

test("BALLS OUT inline game script parses as JavaScript", async () => {
  const game = await read("games/balls-out/index.html");
  const scripts = [...game.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter((source) => source.trim());
  assert.ok(scripts.length > 0);
  for (const source of scripts) new vm.Script(source);
});
