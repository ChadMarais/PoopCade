import assert from "node:assert/strict";
import test from "node:test";
import { MAP_CATALOG, DEFAULT_MAP_ID, mapCatalogEntry, mapCatalogEntryForArena } from "../../games/game-03/maps/catalog.js";
import * as lunarLiability from "../../games/game-03/maps/lunar-liability/map.js";

test("Lunar Liability is the default 15-player Nebula Murderball map", () => {
  assert.equal(DEFAULT_MAP_ID, "lunar-liability");
  assert.equal(MAP_CATALOG.length, 1);
  assert.equal(mapCatalogEntry("missing").id, DEFAULT_MAP_ID);
  assert.equal(mapCatalogEntryForArena("dusty-orbit-001")?.name, "LUNAR LIABILITY");
  assert.equal(lunarLiability.MAP_METADATA.maxPlayers, 15);
  assert.equal(lunarLiability.PLAYER_SPAWNS.length > 1, true);
});

test("map-owned assets live in the map package while gameplay assets stay shared", () => {
  assert.equal(lunarLiability.TERRAIN_URL.includes("/maps/lunar-liability/terrain/"), true);
  for (const url of lunarLiability.ASSET_DEFINITION_URLS) {
    assert.equal(url.includes("/maps/lunar-liability/objects/"), true);
  }
  assert.equal(lunarLiability.ASSET_DEFINITION_URLS.some((url) => url.includes("/powerups/")), false);
});
