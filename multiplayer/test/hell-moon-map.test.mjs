import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { HELL_MOON_CANONICAL_COLLISION, HELL_MOON_ENVIRONMENT_COLLIDERS, HELL_MOON_HEALING_STATIONS, HELL_MOON_MAP_RUNTIME, HELL_MOON_SATELLITES, HELL_MOON_WEAPON_STATIONS } from "../src/hell-moon-map.ts";
import { dustyCollisionForArena, dustyMapRuntimeForArena } from "../src/dusty-maps.ts";
import { DustyOrbitSimulation, DUSTY_FIXED_DT } from "../src/dusty-simulation.ts";
import { DUSTY_PLAYER_RADIUS } from "../src/dusty-map.ts";
import { distanceToPolygon, pointInPolygon } from "../../games/game-03/collision-geometry.js";
import {
  BOUNDARY_COLLIDERS,
  BOUNDARY_OVERLAY,
  CENTER_ARENA_INSTANCE,
  ENVIRONMENT_INSTANCES,
  HEALING_STATION_CONNECTION,
  HEALING_STATION_INSTANCES,
  LAVA_TRENCH_INSTANCES,
  MAP_METADATA,
  PLAYABLE_AREA,
  SATELLITE_INSTANCES,
  TERRAIN_VARIATION_TILES,
  WEAPON_STATION_CONNECTION,
  WEAPON_STATION_INSTANCES,
} from "../../games/game-03/maps/hell-moon/map.js";
import { SATELLITE_INSTANCES as LUNAR_LIABILITY_SATELLITES } from "../../games/game-03/maps/lunar-liability/map.js";

test("satellite stations on both Murderball maps receive world labels and connection states", async () => {
  const renderer = await readFile(new URL("../../games/game-03/renderer.js", import.meta.url), "utf8");
  assert.equal(LUNAR_LIABILITY_SATELLITES.length, 2);
  assert.equal(SATELLITE_INSTANCES.length, 2);
  assert.equal([...LUNAR_LIABILITY_SATELLITES, ...SATELLITE_INSTANCES].every((item) => item.kind === "satellite"), true);
  assert.match(renderer, /if \(item\.kind === "satellite" && satelliteState\) this\.drawSatelliteStationLabel\(item, satelliteState\)/);
  assert.match(renderer, /ctx\.fillText\("SATELLITE STATION", 0, -7\)/);
  assert.match(renderer, /"UPLINK CONNECTED" : active \? "UPLINK ACTIVE" : "MOVE CLOSE TO CONNECT"/);
});

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
  assert.equal(HEALING_STATION_INSTANCES.length, 1);
  assert.equal(HEALING_STATION_INSTANCES[0].id, "HELLMAP-HEALINGSTATION 01");
  assert.equal(HEALING_STATION_INSTANCES[0].kind, "healing-station");
  assert.deepEqual({ x: HEALING_STATION_INSTANCES[0].x, y: HEALING_STATION_INSTANCES[0].y }, { x: 1994.4, y: 371.3 });
  assert.equal(HEALING_STATION_CONNECTION.healIntervalMs, 2000);
  assert.equal(HELL_MOON_HEALING_STATIONS.length, 1);
  assert.equal(WEAPON_STATION_INSTANCES.length, 1);
  assert.equal(WEAPON_STATION_INSTANCES[0].id, "HELLMAP-WEAPONSTATION 01");
  assert.equal(WEAPON_STATION_INSTANCES[0].kind, "weapon-station");
  assert.equal(HELL_MOON_WEAPON_STATIONS.length, 1);
  assert.equal(WEAPON_STATION_CONNECTION.generationMs, 5000);
  assert.equal(WEAPON_STATION_CONNECTION.cooldownMs, 10000);
  assert.deepEqual(SATELLITE_INSTANCES.map((item) => item.id), ["SAT 01", "SAT-COPY 01"]);
  assert.deepEqual(SATELLITE_INSTANCES.map(({ x, y }) => ({ x, y })), [{ x: 560.5, y: 1196.5 }, { x: 3436, y: 1224 }]);
  assert.equal(SATELLITE_INSTANCES.every((item) => item.kind === "satellite"), true);
  assert.equal(HELL_MOON_SATELLITES.every((item) => item.polygon.length >= 3), true);
  assert.equal(dustyCollisionForArena("hell-moon-001").instanceCount, ENVIRONMENT_INSTANCES.length + BOUNDARY_COLLIDERS.length);
  assert.equal(HELL_MOON_ENVIRONMENT_COLLIDERS.length, ENVIRONMENT_INSTANCES.length + BOUNDARY_COLLIDERS.length);
  assert.equal(HELL_MOON_CANONICAL_COLLISION.definitions.some((item) => item.definitionId === "maptile2"), false);
  assert.equal(BOUNDARY_OVERLAY.mode, "polygon-strip");
  assert.match(BOUNDARY_OVERLAY.url, /hell-moon-volcanic-rim\.png/);
  assert.equal(BOUNDARY_OVERLAY.thickness, 420);
  assert.equal(BOUNDARY_OVERLAY.sourceAnchorY, 430);
  assert.equal(PLAYABLE_AREA.length, 28);
  assert.equal(BOUNDARY_COLLIDERS.length, 4);
  assert.equal(BOUNDARY_COLLIDERS.every((item) => item.polygon.length > 4), true);
  assert.equal(BOUNDARY_COLLIDERS.reduce((total, item) => total + item.polygon.length, 0), 40);
  assert.equal(TERRAIN_VARIATION_TILES.length, 1);
  assert.match(TERRAIN_VARIATION_TILES[0].url, /hell-moon-ground-variation\.png/);
  assert.match(MAP_METADATA.previewUrl, /hell-moon-lobby-preview-optimized\.webp/);
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

test("Hell Moon north station heals one bar every two seconds of continuous connection", () => {
  const simulation = new DustyOrbitSimulation(() => 0.25, HELL_MOON_MAP_RUNTIME);
  for (const pickup of simulation.pickups) pickup.active = false;
  const player = simulation.addPlayer("30000000-0000-4000-8000-000000000099", "Patient-Zero", 1000);
  player.protectedUntil = 0;
  player.hp = 1;
  const station = HELL_MOON_HEALING_STATIONS[0];
  const edge = station.polygon.reduce((left, point) => point.x < left.x ? point : left);
  player.x = edge.x - DUSTY_PLAYER_RADIUS - 4;
  player.y = edge.y;

  simulation.step(DUSTY_FIXED_DT, 1000);
  assert.equal(player.connectedHealingStationId, station.id);
  assert.equal(player.hp, 1);
  let snapshot = simulation.snapshot(player.id, 1000);
  assert.equal(snapshot.players[0].healingInProgress, true);
  assert.equal(snapshot.players[0].healingRemaining, 2000);
  assert.deepEqual(snapshot.activeHealingStationIds, [station.id]);

  simulation.step(DUSTY_FIXED_DT, 2999);
  assert.equal(player.hp, 1);
  simulation.step(DUSTY_FIXED_DT, 3000);
  assert.equal(player.hp, 2);
  simulation.step(DUSTY_FIXED_DT, 5000);
  assert.equal(player.hp, 3);
  assert.deepEqual(simulation.drainEvents().filter((event) => event.type === "station_heal").map((event) => event.hp), [2, 3]);
  snapshot = simulation.snapshot(player.id, 5000);
  assert.equal(snapshot.players[0].healingInProgress, false);
  assert.equal(snapshot.players[0].healingStationConnected, true);
});

test("Hell Moon weapon station generates for five seconds and enters the shared ten-second cooldown", () => {
  const simulation = new DustyOrbitSimulation(() => 0.5, HELL_MOON_MAP_RUNTIME);
  for (const pickup of simulation.pickups) { pickup.active = false; pickup.respawnAt = 999_999; }
  const player = simulation.addPlayer("30000000-0000-4000-8000-000000000098", "Hell-Roller", 1000);
  player.protectedUntil = 0;
  const station = HELL_MOON_WEAPON_STATIONS[0];
  const minX = Math.floor(Math.min(...station.polygon.map((point) => point.x)) - DUSTY_PLAYER_RADIUS - 8);
  const maxX = Math.ceil(Math.max(...station.polygon.map((point) => point.x)) + DUSTY_PLAYER_RADIUS + 8);
  const minY = Math.floor(Math.min(...station.polygon.map((point) => point.y)) - DUSTY_PLAYER_RADIUS - 8);
  const maxY = Math.ceil(Math.max(...station.polygon.map((point) => point.y)) + DUSTY_PLAYER_RADIUS + 8);
  let approach = null;
  for (let y = minY; y <= maxY && !approach; y += 2) for (let x = minX; x <= maxX && !approach; x += 2) {
    const point = { x, y };
    if (simulation.isValidNormalPosition(point) && distanceToPolygon(point, station.polygon) - DUSTY_PLAYER_RADIUS <= 5.5) approach = point;
  }
  assert.ok(approach, "Hell weapon station has a collision-safe interaction point");
  Object.assign(player, approach);
  simulation.step(DUSTY_FIXED_DT, 1000);
  assert.equal(player.connectedWeaponStationId, station.id);
  simulation.step(DUSTY_FIXED_DT, 5999);
  assert.equal(player.randomWeapon, null);
  simulation.step(DUSTY_FIXED_DT, 6000);
  assert.ok(player.randomWeapon?.generated);
  const state = simulation.snapshot(player.id, 6000).weaponStations[0];
  assert.equal(state.state, "COOLDOWN");
  assert.equal(state.cooldownRemaining, 10000);
});

test("Mole mode cannot tunnel beyond the Hell Moon playable boundary", () => {
  const probes = [
    { x: 2000, y: 320, moveX: 0, moveY: -1, side: "north" },
    { x: 3500, y: 1250, moveX: 1, moveY: 0, side: "east" },
    { x: 2000, y: 2180, moveX: 0, moveY: 1, side: "south" },
    { x: 450, y: 1250, moveX: -1, moveY: 0, side: "west" },
  ];
  for (const [probeIndex, probe] of probes.entries()) {
    const simulation = new DustyOrbitSimulation(() => 0.25, HELL_MOON_MAP_RUNTIME);
    for (const pickup of simulation.pickups) pickup.active = false;
    const player = simulation.addPlayer(`30000000-0000-4000-8000-00000000009${probeIndex}`, "Boundary-Mole", 1000);
    player.x = probe.x;
    player.y = probe.y;
    player.moleMode = true;
    player.moleUntil = 20_000;
    for (let step = 0; step < 90; step++) {
      const now = 1000 + step * DUSTY_FIXED_DT * 1000;
      simulation.applyInput(player.id, { type: "input", seq: step + 1, moveX: probe.moveX, moveY: probe.moveY, aimX: probe.moveX, aimY: probe.moveY, fire: false, nuke: false, viewAt: now }, now);
      simulation.step(DUSTY_FIXED_DT, now);
    }
    assert.equal(player.moleMode, true);
    assert.equal(pointInPolygon(player, PLAYABLE_AREA), true, `${probe.side} rim keeps Mole inside the playable polygon`);
    assert.equal(HELL_MOON_MAP_RUNTIME.boundaryPolygons.some((polygon) => pointInPolygon(player, polygon)), false);
  }
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
