import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const PRODUCTION_ORIGIN = "https://poopcade.com";
const MAX_BODY_BYTES = 8_192;
const MAX_DURATION_MS = 6 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serverCredential =
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serverCredential) {
  throw new Error("Supabase server environment is not configured.");
}

const supabaseAdmin = createClient(supabaseUrl, serverCredential, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

type GuestEvent =
  | { event: "session_start" | "heartbeat"; sessionId: string }
  | {
      event: "run_complete";
      sessionId: string;
      clientRunId: string;
      gameSlug: "orbit-shift" | "next" | "dusty-orbit";
      score: number;
      durationMs: number;
    };

function headers(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": PRODUCTION_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: headers() });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function validate(value: unknown): { data?: GuestEvent; error?: string } {
  if (!isRecord(value)) return { error: "Request body must be a JSON object." };
  const { event, sessionId } = value;
  if (event !== "session_start" && event !== "heartbeat" && event !== "run_complete") {
    return { error: "Unsupported guest activity event." };
  }
  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)) {
    return { error: "sessionId must be a valid UUID." };
  }
  if (event !== "run_complete") return { data: { event, sessionId } };

  const { clientRunId, gameSlug, score, durationMs } = value;
  if (typeof clientRunId !== "string" || !UUID_PATTERN.test(clientRunId)) {
    return { error: "clientRunId must be a valid UUID." };
  }
  if (gameSlug !== "orbit-shift" && gameSlug !== "next" && gameSlug !== "dusty-orbit") {
    return { error: "gameSlug must identify a supported game." };
  }
  if (!isSafeInteger(score) || score < 0 || !isSafeInteger(durationMs) || durationMs <= 0) {
    return { error: "Run values are invalid." };
  }
  if (durationMs > MAX_DURATION_MS) return { error: "Run duration is outside the accepted range." };
  if (gameSlug === "orbit-shift") {
    if (durationMs < 2_000 || score > 50_000_000 || score > Math.max(10_000, durationMs * 50)) {
      return { error: "ORBIT//SHIFT run values are outside the accepted range." };
    }
  } else if (gameSlug === "next" && (durationMs < 400 || score > 10_000 || score > Math.floor(durationMs / 250) + 2)) {
    return { error: "NEXT. run values are outside the accepted range." };
  } else if (gameSlug === "dusty-orbit" && (durationMs < 1_000 || score > 100_000 || score > Math.floor(durationMs / 100) + 5)) {
    return { error: "DUSTY ORBIT run values are outside the accepted range." };
  }

  return { data: { event, sessionId, clientRunId, gameSlug, score, durationMs } };
}

async function requestHasSignedInUser(request: Request): Promise<boolean> {
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  // The browser publishable key is also sent as a bearer credential. Only a
  // verified Auth user JWT excludes the request from guest analytics.
  if (!token || token.split(".").length !== 3) return false;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return !error && Boolean(data.user);
}

async function touchSession(id: string): Promise<string | null> {
  const now = new Date().toISOString();
  const { error: insertError } = await supabaseAdmin
    .from("guest_sessions")
    .insert({ id, started_at: now, last_seen_at: now });
  if (insertError && insertError.code !== "23505") return insertError.message;
  if (!insertError) return null;

  const { error: updateError } = await supabaseAdmin
    .from("guest_sessions")
    .update({ last_seen_at: now })
    .eq("id", id);
  return updateError?.message ?? null;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== PRODUCTION_ORIGIN) return json({ error: "Origin not allowed." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers() });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return json({ error: "Request body is too large." }, 413);
  if (await requestHasSignedInUser(request)) return json({ accepted: false, reason: "signed-in" }, 409);

  let parsed: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: "Request body is too large." }, 413);
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  const validation = validate(parsed);
  if (!validation.data) return json({ error: validation.error ?? "Invalid request." }, 400);
  const event = validation.data;

  if (event.event === "session_start" || event.event === "heartbeat") {
    const touchError = await touchSession(event.sessionId);
    return touchError ? json({ error: "Guest session could not be recorded." }, 500) : json({ accepted: true });
  }

  const { data: game, error: gameError } = await supabaseAdmin
    .from("games")
    .select("id")
    .eq("slug", event.gameSlug)
    .eq("active", true)
    .maybeSingle();
  if (gameError) return json({ error: "Game lookup failed." }, 500);
  if (!game) return json({ error: "Unknown or inactive game." }, 400);

  const touchError = await touchSession(event.sessionId);
  if (touchError) return json({ error: "Guest session could not be recorded." }, 500);

  const { error: insertError } = await supabaseAdmin.from("guest_runs").insert({
    guest_session_id: event.sessionId,
    game_id: game.id,
    client_run_id: event.clientRunId,
    score: event.score,
    duration_ms: event.durationMs,
  });
  if (insertError?.code === "23505") return json({ accepted: false, duplicate: true });
  if (insertError) return json({ error: "Guest run could not be recorded." }, 500);
  return json({ accepted: true });
});
