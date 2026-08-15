import assert from "node:assert/strict";
import test from "node:test";
import { MAP_CATALOG, DEFAULT_MAP_ID, mapCatalogEntry, mapCatalogEntryForArena } from "../../games/game-03/maps/catalog.js";
import * as lunarLiability from "../../games/game-03/maps/lunar-liability/map.js";
import * as hellMoon from "../../games/game-03/maps/hell-moon/map.js";
import { terrainVariationForCell } from "../../games/game-03/renderer.js";

test("Lunar Liability is the default 15-player Nebula Murderball map", () => {
  assert.equal(DEFAULT_MAP_ID, "lunar-liability");
  assert.equal(MAP_CATALOG.length, 2);
  assert.equal(mapCatalogEntry("missing").id, DEFAULT_MAP_ID);
  assert.equal(mapCatalogEntryForArena("dusty-orbit-001")?.name, "LUNAR LIABILITY");
  assert.equal(mapCatalogEntryForArena("hell-moon-001")?.name, "HELL MOON");
  assert.equal(lunarLiability.MAP_METADATA.maxPlayers, 15);
  assert.equal(lunarLiability.PLAYER_SPAWNS.length > 1, true);
});

test("Hell Moon is a tiled map twenty-five percent larger on both axes", () => {
  assert.deepEqual(hellMoon.WORLD, { width: 4000, height: 2500 });
  assert.equal(hellMoon.WORLD.width / lunarLiability.WORLD.width, 1.25);
  assert.equal(hellMoon.WORLD.height / lunarLiability.WORLD.height, 1.25);
  assert.equal(hellMoon.TERRAIN_MODE, "tile");
  assert.match(hellMoon.TERRAIN_URL, /hell-moon-ground-tile\.png/);
  assert.equal(hellMoon.TERRAIN_VARIATION_TILES.length, 1);
  assert.match(hellMoon.TERRAIN_VARIATION_TILES[0].url, /hell-moon-ground-variation\.png/);
  assert.ok(Array.isArray(hellMoon.ASSET_DEFINITION_URLS));
  assert.equal(hellMoon.ASSET_DEFINITION_URLS.some((url) => url.includes("maptile2")), false);
  assert.ok(Array.isArray(hellMoon.ENVIRONMENT_INSTANCES));
  assert.equal(hellMoon.PLAYABLE_AREA.length, 28);
  assert.equal(hellMoon.BOUNDARY_COLLIDERS.length, 4);
  assert.equal(hellMoon.LAVA_TRENCH_INSTANCES.length > 0, true);
  assert.equal(hellMoon.CENTER_ARENA_INSTANCE.x, hellMoon.WORLD.width / 2);
  assert.equal(hellMoon.CENTER_ARENA_INSTANCE.y, hellMoon.WORLD.height / 2);
  const variedCells = [];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      if (terrainVariationForCell(hellMoon.TERRAIN_VARIATION_TILES, column, row)) variedCells.push(`${column},${row}`);
    }
  }
  assert.deepEqual(variedCells, ["3,0", "0,1", "1,1", "2,1"]);
});

test("map-owned assets live in the map package while gameplay assets stay shared", () => {
  assert.equal(lunarLiability.TERRAIN_URL.includes("/maps/lunar-liability/terrain/"), true);
  for (const url of lunarLiability.ASSET_DEFINITION_URLS) {
    assert.equal(url.includes("/maps/lunar-liability/objects/"), true);
  }
  assert.equal(lunarLiability.ASSET_DEFINITION_URLS.some((url) => url.includes("/powerups/")), false);
});
