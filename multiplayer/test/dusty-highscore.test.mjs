import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DustyOrbitHighscoreTracker, dustyOrbitRunFromPlayer } from "../../games/game-03/highscore.js";

const cryptoApi = { randomUUID: () => "10000000-0000-4000-8000-000000000099" };

test("Dusty Orbit translates authoritative arena state into the shared run schema", () => {
  assert.deepEqual(dustyOrbitRunFromPlayer({ killScore: 4, kills: 7, deaths: 3, joinedAt: 1000 }, 11_500, cryptoApi), {
    clientRunId: "10000000-0000-4000-8000-000000000099",
    score: 4,
    difficulty: "Arena",
    level: 8,
    gates: 3,
    styleBonuses: 0,
    durationMs: 10_500,
  });
});

test("signed-in tracking submits each new positive server high once and ignores death reductions", async () => {
  const runs = [];
  const statuses = [];
  const tracker = new DustyOrbitHighscoreTracker({
    authenticated: true,
    submit: async (run) => { runs.push(run); return { accepted: true, newPersonalBest: true }; },
    now: () => 5000,
    cryptoApi,
    onStatus: (status) => statuses.push(status),
  });
  tracker.reset();
  tracker.observe({ killScore: 0, kills: 0, deaths: 0, joinedAt: 1000 });
  tracker.observe({ killScore: 1, kills: 1, deaths: 0, joinedAt: 1000 });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  tracker.observe({ killScore: 0, kills: 1, deaths: 1, joinedAt: 1000 });
  tracker.observe({ killScore: 1, kills: 2, deaths: 1, joinedAt: 1000 });
  assert.equal(runs.length, 1);
  tracker.observe({ killScore: 2, kills: 3, deaths: 1, joinedAt: 1000 });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.deepEqual(runs.map((run) => run.score), [1, 2]);
  assert.equal(statuses.at(-1), "NEW PERSONAL BEST");
});

test("guest arena highs enter anonymous Poopcade activity without entering the public leaderboard", () => {
  const guestRuns = [];
  const tracker = new DustyOrbitHighscoreTracker({ authenticated: false, recordGuest: (run) => guestRuns.push(run), now: () => 5000, cryptoApi });
  tracker.reset();
  tracker.observe({ killScore: 0, kills: 0, deaths: 0, joinedAt: 1000 });
  tracker.observe({ killScore: 1, kills: 1, deaths: 0, joinedAt: 1000 });
  tracker.observe({ killScore: 0, kills: 1, deaths: 1, joinedAt: 1000 });
  assert.deepEqual(guestRuns, [{
    clientRunId: "10000000-0000-4000-8000-000000000099",
    gameSlug: "dusty-orbit",
    score: 1,
    durationMs: 4000,
  }]);
});

test("Game 3 is registered across submission, database, account, navigation, cache, and leaderboard surfaces", async () => {
  const root = resolve("..");
  const files = await Promise.all([
    "js/poopcade-api.js",
    "supabase/functions/submit-run/index.ts",
    "supabase/functions/guest-activity/index.ts",
    "supabase/migrations/20260813190000_add_dusty_orbit_highscores.sql",
    "account/index.html",
    "index.html",
    "service-worker.js",
    "leaderboard/dusty-orbit/index.html",
  ].map((path) => readFile(resolve(root, path), "utf8")));
  for (const source of files) assert.match(source, /dusty-orbit/i);
  assert.match(files[3], /values \('dusty-orbit', 'DUSTY ORBIT', true\)/);
  assert.match(files[7], /data-game-slug="dusty-orbit"/);
});
