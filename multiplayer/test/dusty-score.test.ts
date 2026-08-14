import assert from "node:assert/strict";
import test from "node:test";
import { dustyOrbitFinalRun, submitDustyOrbitFinalScore } from "../src/dusty-score.ts";

const player = {
  id: "10000000-0000-4000-8000-000000000001",
  killScore: 0,
  kills: 3,
  deaths: 2,
  joinedAt: 1000,
};
const runId = "10000000-0000-4000-8000-000000000099" as `${string}-${string}-${string}-${string}-${string}`;

test("final Dusty Orbit runs preserve the authoritative leave score, including zero", () => {
  assert.deepEqual(dustyOrbitFinalRun(player, 11_500, () => runId), {
    clientRunId: runId,
    gameSlug: "dusty-orbit",
    score: 0,
    difficulty: "Arena",
    level: 4,
    gates: 2,
    styleBonuses: 0,
    durationMs: 10_500,
  });
});

test("final submission preserves the session high after the live score drops", () => {
  const run = dustyOrbitFinalRun({ ...player, killScore: 1, highScore: 4, kills: 6 }, 11_500, () => runId);
  assert.equal(run.score, 4);
  assert.equal(run.level, 7);
});

test("authenticated final scores are submitted through the existing leaderboard function", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const result = await submitDustyOrbitFinalScore({
    env: { SUPABASE_URL: "https://scores.example/", SUPABASE_PUBLISHABLE_KEY: "publishable" },
    accessToken: "validated-player-token",
    player: { ...player, killScore: 5, kills: 7 },
    endedAt: 11_500,
    randomUUID: () => runId,
    fetchApi: async (input, init) => {
      requests.push({ url: String(input), init });
      return Response.json({ accepted: true, personalBest: 5 }, { status: 200 });
    },
  });

  assert.deepEqual(result, { submitted: true, status: 200, personalBest: 5 });
  assert.equal(requests[0].url, "https://scores.example/functions/v1/submit-run");
  assert.equal((requests[0].init?.headers as Record<string, string>).authorization, "Bearer validated-player-token");
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    clientRunId: runId,
    gameSlug: "dusty-orbit",
    score: 5,
    difficulty: "Arena",
    level: 8,
    gates: 2,
    styleBonuses: 0,
    durationMs: 10_500,
  });
});

test("guest final scores skip the public leaderboard", async () => {
  let requested = false;
  const result = await submitDustyOrbitFinalScore({
    env: { SUPABASE_URL: "https://scores.example", SUPABASE_PUBLISHABLE_KEY: "publishable" },
    player,
    fetchApi: async () => { requested = true; return new Response(); },
  });
  assert.deepEqual(result, { submitted: false, skipped: "guest" });
  assert.equal(requested, false);
});

test("a successful HTTP response is not enough without persistence confirmation", async () => {
  const result = await submitDustyOrbitFinalScore({
    env: { SUPABASE_URL: "https://scores.example", SUPABASE_PUBLISHABLE_KEY: "publishable" },
    accessToken: "validated-player-token",
    player: { ...player, killScore: 4 },
    fetchApi: async () => Response.json({ accepted: false, personalBest: 0 }, { status: 200 }),
  });
  assert.deepEqual(result, { submitted: false, status: 200, personalBest: 0 });
});
