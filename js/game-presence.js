import { supabase } from "./supabase-config.js";

const PRESENCE_ROOM = "poopcade-game-presence-v1";
const SINGLE_PLAYER_ROUTES = new Map([
  ["/games/orbit-shift/", "orbit-shift"],
  ["/games/next/", "next"],
  ["/games/balls-out/", "balls-out"],
]);

function playerKey() {
  const storageKey = "poopcade_presence_id";
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function gameForPath(pathname) {
  const normalized = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return SINGLE_PLAYER_ROUTES.get(normalized) || "";
}

function setCounter(game, count, state = "ready") {
  document.querySelectorAll(`[data-currently-playing="${game}"]`).forEach((counter) => {
    const value = counter.querySelector("[data-currently-playing-value]");
    if (value) value.textContent = state === "ready" ? String(count) : "—";
    counter.dataset.state = state;
    counter.setAttribute("aria-label", state === "ready"
      ? `${count} ${count === 1 ? "person" : "people"} currently playing`
      : "Current player count unavailable");
  });
}

const trackedGame = gameForPath(location.pathname);
const counters = [...document.querySelectorAll("[data-currently-playing]")];

if (trackedGame || counters.length) {
  const channel = supabase.channel(PRESENCE_ROOM, {
    config: { presence: { key: playerKey() } },
  });

  const refreshCounters = () => {
    const playersByGame = new Map();
    for (const [key, presences] of Object.entries(channel.presenceState())) {
      for (const presence of presences) {
        const game = typeof presence.game === "string" ? presence.game : "";
        if (!game) continue;
        if (!playersByGame.has(game)) playersByGame.set(game, new Set());
        playersByGame.get(game).add(key);
      }
    }
    for (const game of SINGLE_PLAYER_ROUTES.values()) {
      setCounter(game, playersByGame.get(game)?.size || 0);
    }
  };

  channel.on("presence", { event: "sync" }, refreshCounters);
  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      if (trackedGame && !document.hidden) {
        await channel.track({ game: trackedGame, online_at: new Date().toISOString() });
      }
      refreshCounters();
    } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
      counters.forEach((counter) => setCounter(counter.dataset.currentlyPlaying, 0, "unavailable"));
    }
  });

  if (trackedGame) {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) void channel.untrack();
      else void channel.track({ game: trackedGame, online_at: new Date().toISOString() });
    });
  }
}

const murderballCounter = document.querySelector('[data-currently-playing="dusty-orbit"]');
if (murderballCounter) {
  const loadMurderballPlayers = async () => {
    try {
      const { PRODUCTION_ARENA_WSS } = await import("/games/game-03/config.js?v=20260812");
      const base = PRODUCTION_ARENA_WSS.trim().replace(/\/$/, "").replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
      if (!/^https?:\/\/[^/]+$/i.test(base)) throw new Error("Invalid arena endpoint");
      const response = await fetch(`${base}/maps`, { cache: "no-store" });
      if (!response.ok) throw new Error("Arena status unavailable");
      const payload = await response.json();
      const count = Array.isArray(payload.maps)
        ? payload.maps.reduce((total, map) => total + Math.max(0, Number(map.activePlayers) || 0), 0)
        : 0;
      setCounter("dusty-orbit", count);
    } catch {
      setCounter("dusty-orbit", 0, "unavailable");
    }
  };
  void loadMurderballPlayers();
  const poll = setInterval(loadMurderballPlayers, 15_000);
  addEventListener("pagehide", () => clearInterval(poll), { once: true });
}
