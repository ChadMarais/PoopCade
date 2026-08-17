import { MAP_METADATA as LUNAR_LIABILITY } from "./lunar-liability/map.js?v=20260817-3";
import { MAP_METADATA as HELL_MOON } from "./hell-moon/map.js?v=20260817-3";

export const MAP_CATALOG = Object.freeze([LUNAR_LIABILITY, HELL_MOON]);
export const DEFAULT_MAP_ID = LUNAR_LIABILITY.id;

export function mapCatalogEntry(id) {
  return MAP_CATALOG.find((map) => map.id === id) ?? LUNAR_LIABILITY;
}

export function mapCatalogEntryForArena(arenaId) {
  return MAP_CATALOG.find((map) => map.arenaId === arenaId) ?? null;
}
