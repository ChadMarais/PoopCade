import type { DustyPlayer } from "./dusty-simulation.ts";

export type DustyFinalScorePlayer = Pick<DustyPlayer, "id" | "killScore" | "kills" | "deaths" | "joinedAt">;

type ScoreEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
};

export function dustyOrbitFinalRun(
  player: DustyFinalScorePlayer,
  endedAt = Date.now(),
  randomUUID = () => crypto.randomUUID(),
) {
  const score = Math.max(0, Math.trunc(Number(player.killScore) || 0));
  const kills = Math.max(score, Math.trunc(Number(player.kills) || 0));
  const deaths = Math.max(0, Math.trunc(Number(player.deaths) || 0));
  const joinedAt = Number(player.joinedAt);
  return {
    clientRunId: randomUUID(),
    gameSlug: "dusty-orbit",
    score,
    difficulty: "Arena",
    level: kills + 1,
    gates: deaths,
    styleBonuses: 0,
    durationMs: Math.max(1000, Math.trunc(Number.isFinite(joinedAt) ? endedAt - joinedAt : 1000)),
  };
}

export async function submitDustyOrbitFinalScore({
  env,
  accessToken,
  player,
  endedAt = Date.now(),
  fetchApi = fetch,
  randomUUID,
}: {
  env: ScoreEnvironment;
  accessToken?: string;
  player: DustyFinalScorePlayer;
  endedAt?: number;
  fetchApi?: typeof fetch;
  randomUUID?: () => `${string}-${string}-${string}-${string}-${string}`;
}): Promise<{ submitted: boolean; skipped?: string; status?: number }> {
  const base = env.SUPABASE_URL?.replace(/\/$/, "");
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  if (!accessToken) return { submitted: false, skipped: "guest" };
  if (!base || !key) return { submitted: false, skipped: "unconfigured" };

  const response = await fetchApi(`${base}/functions/v1/submit-run`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(dustyOrbitFinalRun(player, endedAt, randomUUID)),
  });
  return { submitted: response.ok, status: response.status };
}
