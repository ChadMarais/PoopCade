export const MAX_MESSAGE_BYTES = 2048;
export const MAX_INPUT_MESSAGES_PER_SECOND = 90;

export type ClientHello = {
  type: "hello";
  name: string;
  sessionId: string;
};

export type ClientInput = {
  type: "input";
  seq: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
  nuke?: boolean;
};

export type ClientPing = { type: "ping"; nonce: string };
export type ClientDebugPowerup = { type: "debug_powerup"; powerup: "spy" | "speed" | "health" | "shield" | "teleport" | "mole" | "fart" };
export type ClientDebugNuke = { type: "debug_nuke" };
export type ClientMessage = ClientHello | ClientInput | ClientPing | ClientDebugPowerup | ClientDebugNuke;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GUEST_NAME_PATTERN = /^Guest-[0-9]{4}$/;

function finiteUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeGuestName(value: unknown): string {
  return typeof value === "string" && GUEST_NAME_PATTERN.test(value) ? value : "Guest-0000";
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
    if (typeof value.name !== "string" || !GUEST_NAME_PATTERN.test(value.name)) return null;
    if (typeof value.sessionId !== "string" || !UUID_PATTERN.test(value.sessionId)) return null;
    return { type: "hello", name: value.name, sessionId: value.sessionId };
  }

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
    };
  }

  if (value.type === "ping") {
    if (typeof value.nonce !== "string" || value.nonce.length < 1 || value.nonce.length > 64) return null;
    return { type: "ping", nonce: value.nonce };
  }

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
