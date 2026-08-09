import { supabase } from "./supabase-config.js";

const STORAGE_KEY = "poopcade_guest_session_id";
const HEARTBEAT_MS = 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const debugMode = new URLSearchParams(window.location.search).get("debug") === "1";

let sessionId = null;
let heartbeatTimer = 0;
let startPromise = null;
let active = false;
let disabledByAuthentication = false;
let visibilityBound = false;
const recordedRuns = new Set();

function readOrCreateSessionId() {
  if (!window.crypto?.randomUUID) return null;
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing && UUID_PATTERN.test(existing)) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return null;
  }
}

async function hasSignedInUser() {
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data.session?.user);
  } catch {
    return false;
  }
}

function send(body) {
  // Analytics must never delay or interrupt a game. Supabase owns auth/session
  // transport; Poopcade does not store tokens or add identity fields here.
  void supabase.functions.invoke("guest-activity", { body }).catch(() => {});
}

async function heartbeat() {
  if (!active || disabledByAuthentication || document.visibilityState !== "visible") return;
  if (await hasSignedInUser()) {
    stop(true);
    return;
  }
  send({ event: "heartbeat", sessionId });
}

function startHeartbeatLoop() {
  if (heartbeatTimer) return;
  heartbeatTimer = window.setInterval(() => { void heartbeat(); }, HEARTBEAT_MS);
  if (!visibilityBound) {
    visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void heartbeat();
    });
  }
}

export async function start() {
  if (debugMode || disabledByAuthentication) return null;
  if (active) return sessionId;
  if (startPromise) return startPromise;

  startPromise = (async () => {
    if (await hasSignedInUser()) {
      disabledByAuthentication = true;
      return null;
    }
    sessionId = readOrCreateSessionId();
    if (!sessionId) return null;
    active = true;
    send({ event: "session_start", sessionId });
    startHeartbeatLoop();
    return sessionId;
  })().finally(() => { startPromise = null; });

  return startPromise;
}

export async function recordRun({ clientRunId, gameSlug, score, durationMs } = {}) {
  if (debugMode || disabledByAuthentication || !UUID_PATTERN.test(String(clientRunId ?? ""))) return;
  if (recordedRuns.has(clientRunId)) return;
  if (await hasSignedInUser()) {
    stop(true);
    return;
  }
  const currentSessionId = active ? sessionId : await start();
  if (!currentSessionId) return;

  recordedRuns.add(clientRunId);
  send({
    event: "run_complete",
    sessionId: currentSessionId,
    clientRunId,
    gameSlug,
    score,
    durationMs,
  });
}

export function stop(authenticationDetected = false) {
  active = false;
  if (authenticationDetected) disabledByAuthentication = true;
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  heartbeatTimer = 0;
}

export const PoopcadeGuestAnalytics = Object.freeze({ start, recordRun, stop });

window.PoopcadeGuestAnalytics = PoopcadeGuestAnalytics;
window.dispatchEvent(new CustomEvent("poopcade-guest-analytics-ready"));

supabase.auth.onAuthStateChange((_event, authSession) => {
  if (authSession?.user) stop(true);
});

void start();
