export const RECRUITMENT_COOLDOWN_MS = 60_000;
export const RECRUITMENT_HREF = "/games/game-03/";
export const GLOBAL_PRESENCE_PATH = "/presence/ws";

export function recruitmentHref(mapId) {
  const href = new URL(RECRUITMENT_HREF, "https://poopcade.invalid");
  if (typeof mapId === "string" && /^[a-z0-9-]{1,48}$/.test(mapId)) href.searchParams.set("map", mapId);
  return `${href.pathname}${href.search}`;
}

export function presenceEndpoint(arenaEndpoint) {
  try {
    const endpoint = new URL(arenaEndpoint);
    endpoint.pathname = GLOBAL_PRESENCE_PATH;
    endpoint.search = "";
    return endpoint.href;
  } catch {
    return "";
  }
}

export function recruitmentMessage(rawName, rawMapName = "") {
  const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : "A suspicious pilot";
  const mapName = typeof rawMapName === "string" && rawMapName.trim() ? ` on ${rawMapName.trim()}` : "";
  return `${name} invited you to play NEBULA MURDERBALL${mapName}. Join them before somebody sensible intervenes.`;
}

export function recruitmentCooldownRemaining(retryAt, now = Date.now()) {
  return Math.max(0, Math.ceil((Number(retryAt) - now) / 1000));
}

export function normalizedOnlinePlayers(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}
