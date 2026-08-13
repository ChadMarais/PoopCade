import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const PRODUCTION_ORIGIN = "https://poopcade.com";
const MAX_BODY_BYTES = 16_384;
const MAX_DURATION_MS = 6 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GAME_SLUGS = new Set(["orbit-shift", "next", "dusty-orbit"]);
const ORBIT_DIFFICULTIES = new Set(["Easy", "Medium", "Hard"]);

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serverCredential =
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serverCredential) {
  throw new Error("Supabase server environment is not configured.");
}

const supabaseAdmin = createClient(supabaseUrl, serverCredential, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

type RunPayload = {
  gameSlug: "orbit-shift" | "next" | "dusty-orbit";
  clientRunId: string;
  score: number;
  difficulty: "Easy" | "Medium" | "Hard" | "Standard" | "Arena";
  level: number;
  gates: number;
  styleBonuses: number;
  durationMs: number;
};

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin === PRODUCTION_ORIGIN ? origin : PRODUCTION_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function validatePayload(value: unknown): { data?: RunPayload; error?: string } {
  if (!isRecord(value)) return { error: "Request body must be a JSON object." };

  const {
    gameSlug,
    clientRunId,
    score,
    difficulty,
    level,
    gates,
    styleBonuses,
    durationMs,
  } = value;

  if (typeof gameSlug !== "string" || !GAME_SLUGS.has(gameSlug)) {
    return { error: "gameSlug must identify a supported game." };
  }
  if (typeof clientRunId !== "string" || !UUID_PATTERN.test(clientRunId)) {
    return { error: "clientRunId must be a valid UUID." };
  }
  if (!isSafeInteger(score) || score < 0) return { error: "score is outside the accepted range." };
  if (!isSafeInteger(level) || level < 1) return { error: "level is outside the accepted range." };
  if (!isSafeInteger(gates) || gates < 0) return { error: "gates is outside the accepted range." };
  if (!isSafeInteger(styleBonuses) || styleBonuses < 0) return { error: "styleBonuses is outside the accepted range." };
  if (!isSafeInteger(durationMs) || durationMs > MAX_DURATION_MS) return { error: "durationMs is outside the accepted range." };

  if (gameSlug === "orbit-shift") {
    if (typeof difficulty !== "string" || !ORBIT_DIFFICULTIES.has(difficulty)) {
      return { error: "ORBIT//SHIFT difficulty must be Easy, Medium, or Hard." };
    }
    if (score > 50_000_000 || level > 999 || gates > 250_000 || styleBonuses > 100_000 || durationMs < 2_000) {
      return { error: "ORBIT//SHIFT run values are outside the accepted range." };
    }
    // Preserve the original ORBIT//SHIFT sanity ceilings.
    if (score > Math.max(10_000, durationMs * 50)) return { error: "score is not plausible for the submitted duration." };
    if (gates > Math.max(200, Math.floor(durationMs / 50))) return { error: "gate count is not plausible for the submitted duration." };
    if (styleBonuses > Math.max(20, Math.floor(durationMs / 500))) return { error: "style bonus count is not plausible for the submitted duration." };
    if (level > Math.floor(durationMs / 1_000) + 12) return { error: "level is not plausible for the submitted duration." };
  } else if (gameSlug === "next") {
    if (difficulty !== "Standard") return { error: "NEXT. difficulty must be Standard." };
    if (score > 10_000 || level !== score + 1 || gates !== 0 || styleBonuses !== 0) {
      return { error: "NEXT. run values are inconsistent." };
    }
    if (durationMs < 400 || score > Math.floor(durationMs / 250) + 2) {
      return { error: "NEXT. run is not plausible for the submitted duration." };
    }
  } else {
    const kills = level - 1;
    if (difficulty !== "Arena") return { error: "DUSTY ORBIT difficulty must be Arena." };
    if (score > 100_000 || kills > 100_000 || gates > 100_000 || styleBonuses !== 0 || score > kills) {
      return { error: "DUSTY ORBIT run values are inconsistent." };
    }
    if (durationMs < 1_000 || kills > Math.floor(durationMs / 100) + 5 || gates > Math.floor(durationMs / 250) + 5) {
      return { error: "DUSTY ORBIT run is not plausible for the submitted duration." };
    }
  }

  return {
    data: {
      gameSlug: gameSlug as RunPayload["gameSlug"],
      clientRunId,
      score,
      difficulty: difficulty as RunPayload["difficulty"],
      level,
      gates,
      styleBonuses,
      durationMs,
    },
  };
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("Origin");

  if (origin && origin !== PRODUCTION_ORIGIN) {
    return jsonResponse({ error: "Origin not allowed." }, 403, origin);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, origin);
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Request body is too large." }, 413, origin);
  }

  const authorization = request.headers.get("Authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    return jsonResponse({ error: "Authentication required." }, 401, origin);
  }

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (authError || !user) {
    return jsonResponse({ error: "Invalid or expired session." }, 401, origin);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400, origin);
  }

  const validation = validatePayload(rawPayload);
  if (!validation.data) {
    return jsonResponse({ error: validation.error ?? "Invalid run." }, 400, origin);
  }
  const payload = validation.data;

  const { data: game, error: gameError } = await supabaseAdmin
    .from("games")
    .select("id")
    .eq("slug", payload.gameSlug)
    .eq("active", true)
    .maybeSingle();

  if (gameError) {
    return jsonResponse({ error: "Score service is temporarily unavailable." }, 503, origin);
  }
  if (!game) {
    return jsonResponse({ error: "Unknown or inactive game." }, 400, origin);
  }

  const { data: duplicate, error: duplicateError } = await supabaseAdmin
    .from("runs")
    .select("id")
    .eq("client_run_id", payload.clientRunId)
    .maybeSingle();

  if (duplicateError) {
    return jsonResponse({ error: "Score service is temporarily unavailable." }, 503, origin);
  }
  if (duplicate) {
    return jsonResponse({ error: "This run was already submitted." }, 409, origin);
  }

  const { data, error } = await supabaseAdmin.rpc("submit_run", {
    p_client_run_id: payload.clientRunId,
    p_player_id: user.id,
    p_game_slug: payload.gameSlug,
    p_score: payload.score,
    p_difficulty: payload.difficulty,
    p_level: payload.level,
    p_gates: payload.gates,
    p_style_bonuses: payload.styleBonuses,
    p_duration_ms: payload.durationMs,
  });

  if (error) {
    if (error.code === "23505") {
      return jsonResponse({ error: "This run was already submitted." }, 409, origin);
    }
    return jsonResponse({ error: "Score could not be saved." }, 500, origin);
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result) {
    return jsonResponse({ error: "Score could not be saved." }, 500, origin);
  }

  return jsonResponse({
    accepted: result.accepted === true,
    score: result.score,
    personalBest: result.personal_best,
    newPersonalBest: result.new_personal_best === true,
  }, 200, origin);
});
