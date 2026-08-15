import assert from "node:assert/strict";
import test from "node:test";
import { HELL_MOON_CANONICAL_COLLISION, HELL_MOON_ENVIRONMENT_COLLIDERS, HELL_MOON_MAP_RUNTIME, HELL_MOON_SATELLITES } from "../src/hell-moon-map.ts";
import { dustyCollisionForArena, dustyMapRuntimeForArena } from "../src/dusty-maps.ts";
import { DustyOrbitSimulation, DUSTY_FIXED_DT } from "../src/dusty-simulation.ts";
import { DUSTY_PLAYER_RADIUS } from "../src/dusty-map.ts";
import { pointInPolygon } from "../../games/game-03/collision-geometry.js";
import {
  BOUNDARY_COLLIDERS,
  BOUNDARY_OVERLAY,
  CENTER_ARENA_INSTANCE,
  ENVIRONMENT_INSTANCES,
  LAVA_TRENCH_INSTANCES,
  MAP_METADATA,
  PLAYABLE_AREA,
  SATELLITE_INSTANCES,
  TERRAIN_VARIATION_TILES,
} from "../../games/game-03/maps/hell-moon/map.js";

test("Hell Moon has its own authoritative 4000 by 2500 runtime", () => {
  const runtime = dustyMapRuntimeForArena("hell-moon-001");
  assert.equal(runtime, HELL_MOON_MAP_RUNTIME);
  assert.equal(runtime.map.mapId, "hell-moon");
  assert.equal(runtime.map.width, 4000);
  assert.equal(runtime.map.height, 2500);
  assert.equal(runtime.polygons.length, HELL_MOON_ENVIRONMENT_COLLIDERS.filter((item) => item.blocksMovement).length);
  assert.equal(runtime.projectilePolygons.length, HELL_MOON_ENVIRONMENT_COLLIDERS.filter((item) => item.blocksProjectiles).length);
  assert.equal(runtime.spawns.length, 10);
  assert.equal(runtime.satellites, HELL_MOON_SATELLITES);
  assert.equal(SATELLITE_INSTANCES.length, 2);
  assert.deepEqual(SATELLITE_INSTANCES.map((item) => item.id), ["SAT 01", "SAT-COPY 01"]);
  assert.deepEqual(SATELLITE_INSTANCES.map(({ x, y }) => ({ x, y })), [{ x: 560.5, y: 1196.5 }, { x: 3436, y: 1224 }]);
  assert.equal(SATELLITE_INSTANCES.every((item) => item.kind === "satellite"), true);
  assert.equal(HELL_MOON_SATELLITES.every((item) => item.polygon.length >= 3), true);
  assert.equal(dustyCollisionForArena("hell-moon-001").instanceCount, ENVIRONMENT_INSTANCES.length + BOUNDARY_COLLIDERS.length);
  assert.equal(HELL_MOON_ENVIRONMENT_COLLIDERS.length, ENVIRONMENT_INSTANCES.length + BOUNDARY_COLLIDERS.length);
  assert.equal(HELL_MOON_CANONICAL_COLLISION.definitions.some((item) => item.definitionId === "maptile2"), false);
  assert.equal(BOUNDARY_OVERLAY, null);
  assert.equal(PLAYABLE_AREA.length, 28);
  assert.equal(BOUNDARY_COLLIDERS.length, 4);
  assert.equal(BOUNDARY_COLLIDERS.every((item) => item.polygon.length > 4), true);
  assert.equal(BOUNDARY_COLLIDERS.reduce((total, item) => total + item.polygon.length, 0), 40);
  assert.equal(TERRAIN_VARIATION_TILES.length, 1);
  assert.match(TERRAIN_VARIATION_TILES[0].url, /hell-moon-ground-variation\.png/);
  assert.match(MAP_METADATA.previewUrl, /hell-moon-lobby-preview\.webp/);
  assert.equal(ENVIRONMENT_INSTANCES.some((item) => item.assetId === "maptile2"), false);
  assert.equal(CENTER_ARENA_INSTANCE.assetId, "hell-moon-center-arena");
  for (const spawn of runtime.spawns) {
    assert.equal(pointInPolygon(spawn, PLAYABLE_AREA), true);
  }
  const lavaColliders = HELL_MOON_ENVIRONMENT_COLLIDERS.filter((item) => item.kind === "lava-ditch");
  assert.equal(lavaColliders.length, LAVA_TRENCH_INSTANCES.length);
  assert.equal(lavaColliders.every((item) => item.blocksMovement && !item.blocksProjectiles), true);
  const outsideSideProbes = [
    { point: { x: 2000, y: 20 }, side: 0 },
    { point: { x: 3980, y: 1250 }, side: 1 },
    { point: { x: 2000, y: 2480 }, side: 2 },
    { point: { x: 20, y: 1250 }, side: 3 },
  ];
  for (const { point, side } of outsideSideProbes) assert.equal(pointInPolygon(point, BOUNDARY_COLLIDERS[side].polygon), true);
  assert.equal(BOUNDARY_COLLIDERS.some((item) => pointInPolygon({ x: 2000, y: 1250 }, item.polygon)), false);
});

test("both Hell Moon relays grant the same authoritative satellite view", () => {
  for (const [index, satellite] of HELL_MOON_SATELLITES.entries()) {
    const simulation = new DustyOrbitSimulation(() => 0.25, HELL_MOON_MAP_RUNTIME);
    for (const pickup of simulation.pickups) pickup.active = false;
    const id = `30000000-0000-4000-8000-00000000000${index + 1}`;
    const player = simulation.addPlayer(id, `Relay-${index + 1}`, 1000);
    player.protectedUntil = 0;
    const edge = satellite.polygon.reduce((left, point) => point.x < left.x ? point : left);
    player.x = edge.x - DUSTY_PLAYER_RADIUS - 4;
    player.y = edge.y;
    simulation.step(DUSTY_FIXED_DT, 1000);
    assert.equal(player.connectedSatelliteId, satellite.id);
    const snapshot = simulation.snapshot(player.id, 1000);
    assert.equal(snapshot.you.radarSource, "SATELLITE");
    assert.deepEqual(snapshot.activeSatelliteIds, [satellite.id]);
  }
});
