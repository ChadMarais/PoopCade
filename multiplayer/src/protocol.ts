export const MAX_MESSAGE_BYTES = 4096;
export const MAX_INPUT_MESSAGES_PER_SECOND = 90;

export type ClientHello = {
  type: "hello";
  name: string;
  sessionId: string;
  presence: "unknown" | "home" | "dusty";
};

export type ClientJoin = {
  type: "join";
  name: string;
  skinId: string;
  accessToken?: string;
};

export type ClientLeave = { type: "leave" };

export type ClientInput = {
  type: "input";
  seq: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
  nuke?: boolean;
  viewAt?: number;
};

export type ClientPing = { type: "ping"; nonce: string };
export type ClientRecruit = { type: "recruit" };
export type ClientDebugPowerup = { type: "debug_powerup"; powerup: "spy" | "speed" | "health" | "shield" | "teleport" | "mole" | "fart" };
export type ClientDebugNuke = { type: "debug_nuke" };
export type ClientMessage = ClientHello | ClientJoin | ClientLeave | ClientInput | ClientPing | ClientRecruit | ClientDebugPowerup | ClientDebugNuke;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GUEST_NAME_PATTERN = /^Guest-[0-9]{4}$/;
const PLAYER_NAME_PATTERN = /^[\p{L}\p{N} _-]{3,20}$/u;
const SKIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

function finiteUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeGuestName(value: unknown): string {
  return typeof value === "string" && GUEST_NAME_PATTERN.test(value) ? value : "Guest-0000";
}

export function safePlayerName(value: unknown, fallback = "Guest-0000"): string {
  if (typeof value !== "string") return safeGuestName(fallback);
  const trimmed = value.trim();
  return PLAYER_NAME_PATTERN.test(trimmed) && !trimmed.includes("@") ? trimmed : safeGuestName(fallback);
}

export function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(value) || typeof value.type !== "string") return null;

  if (value.type === "hello") {
    if (typeof value.name !== "string" || safePlayerName(value.name, "") !== value.name.trim()) return null;
    if (typeof value.sessionId !== "string" || !UUID_PATTERN.test(value.sessionId)) return null;
    if (value.presence !== undefined && value.presence !== "home" && value.presence !== "dusty") return null;
    const presence = value.presence === "home" || value.presence === "dusty" ? value.presence : "unknown";
    return { type: "hello", name: value.name.trim(), sessionId: value.sessionId, presence };
  }

  if (value.type === "join") {
    if (typeof value.name !== "string" || safePlayerName(value.name, "") !== value.name.trim()) return null;
    if (typeof value.skinId !== "string" || !SKIN_ID_PATTERN.test(value.skinId)) return null;
    if (value.accessToken !== undefined && (typeof value.accessToken !== "string" || value.accessToken.length < 20 || value.accessToken.length > 3072)) return null;
    return { type: "join", name: value.name.trim(), skinId: value.skinId, ...(value.accessToken ? { accessToken: value.accessToken } : {}) };
  }

  if (value.type === "leave") return { type: "leave" };

  if (value.type === "input") {
    if (!Number.isSafeInteger(value.seq) || Number(value.seq) < 0) return null;
    if (![value.moveX, value.moveY, value.aimX, value.aimY].every(finiteUnit)) return null;
    if (typeof value.fire !== "boolean") return null;
    return {
      type: "input",
      seq: Number(value.seq),
      moveX: Number(value.moveX),
      moveY: Number(value.moveY),
      aimX: Number(value.aimX),
      aimY: Number(value.aimY),
      fire: value.fire,
      nuke: value.nuke === true,
      ...(typeof value.viewAt === "number" && Number.isFinite(value.viewAt) && value.viewAt >= 0 ? { viewAt: value.viewAt } : {}),
    };
  }

  if (value.type === "ping") {
    if (typeof value.nonce !== "string" || value.nonce.length < 1 || value.nonce.length > 64) return null;
    return { type: "ping", nonce: value.nonce };
  }

  if (value.type === "recruit") return { type: "recruit" };

  if (value.type === "debug_powerup") {
    if (!["spy", "speed", "health", "shield", "teleport", "mole", "fart"].includes(String(value.powerup))) return null;
    return { type: "debug_powerup", powerup: value.powerup as ClientDebugPowerup["powerup"] };
  }

  if (value.type === "debug_nuke") return { type: "debug_nuke" };

  return null;
}

export function encode(message: unknown): string {
  return JSON.stringify(message);
}
