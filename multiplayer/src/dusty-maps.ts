import { DUSTY_CANONICAL_COLLISION, DUSTY_MAP_RUNTIME, type MurderballMapRuntime } from "./dusty-map.ts";
import { HELL_MOON_CANONICAL_COLLISION, HELL_MOON_MAP_RUNTIME } from "./hell-moon-map.ts";

const MAP_RUNTIMES = new Map<string, MurderballMapRuntime>([
  [DUSTY_MAP_RUNTIME.map.id, DUSTY_MAP_RUNTIME],
  [HELL_MOON_MAP_RUNTIME.map.id, HELL_MOON_MAP_RUNTIME],
]);

export function dustyMapRuntimeForArena(arenaId: string | null | undefined) {
  return MAP_RUNTIMES.get(arenaId) ?? null;
}

export function dustyCollisionForArena(arenaId: string) {
  return arenaId === HELL_MOON_MAP_RUNTIME.map.id ? HELL_MOON_CANONICAL_COLLISION : DUSTY_CANONICAL_COLLISION;
}
