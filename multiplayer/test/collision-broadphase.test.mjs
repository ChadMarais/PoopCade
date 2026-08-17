import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createPolygonBroadphase, moveCircleWithSliding, sweptCircleIntersectsPolygon } from "../../games/game-03/collision-geometry.js";
import { HELL_MOON_MAP_RUNTIME } from "../src/hell-moon-map.ts";

test("Hell Moon broadphase preserves exact movement collision results", () => {
  const polygons = HELL_MOON_MAP_RUNTIME.polygons;
  const broadphase = createPolygonBroadphase(polygons);
  let seed = 0x5eed1234;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };

  for (let index = 0; index < 1000; index += 1) {
    const position = { x: random() * 4000, y: random() * 2500 };
    const displacement = { x: (random() - .5) * 34, y: (random() - .5) * 34 };
    const original = moveCircleWithSliding(position, displacement, 17, polygons);
    const accelerated = moveCircleWithSliding(position, displacement, 17, polygons, broadphase);
    assert.deepEqual(accelerated, original, `collision diverged for sample ${index}`);
  }
});

test("Hell Moon broadphase substantially narrows ordinary movement queries", () => {
  const polygons = HELL_MOON_MAP_RUNTIME.polygons;
  const broadphase = createPolygonBroadphase(polygons);
  const nearby = broadphase.queryCircle({ x: 2000, y: 1250 }, 17);
  assert.ok(nearby.length < polygons.length / 2, `${nearby.length} of ${polygons.length} polygons remained`);
});

test("Hell Moon swept broadphase preserves every projectile collision candidate in original order", () => {
  const polygons = HELL_MOON_MAP_RUNTIME.projectilePolygons;
  const broadphase = createPolygonBroadphase(polygons);
  let seed = 0xc0111de;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };

  for (let index = 0; index < 2000; index += 1) {
    const start = { x: random() * 4000, y: random() * 2500 };
    const end = { x: start.x + (random() - .5) * 180, y: start.y + (random() - .5) * 180 };
    const radius = 2 + random() * 9;
    const expected = polygons.filter((polygon) => sweptCircleIntersectsPolygon(start, end, radius, polygon));
    const candidates = broadphase.querySegment(start, end, radius);
    const actual = candidates.filter((polygon) => sweptCircleIntersectsPolygon(start, end, radius, polygon));
    assert.deepEqual(actual, expected, `projectile collision candidates diverged for sample ${index}`);
  }
});

test("Hell Moon swept broadphase substantially narrows ordinary projectile queries", () => {
  const polygons = HELL_MOON_MAP_RUNTIME.projectilePolygons;
  const broadphase = createPolygonBroadphase(polygons);
  const candidates = broadphase.querySegment({ x: 1900, y: 1200 }, { x: 1980, y: 1230 }, 5);
  assert.ok(candidates.length < polygons.length / 2, `${candidates.length} of ${polygons.length} polygons remained`);
});

test("authoritative projectile collision uses the swept broadphase without changing firing code", async () => {
  const source = await readFile(new URL("../src/dusty-simulation.ts", import.meta.url), "utf8");
  const update = source.slice(source.indexOf("  private updateProjectiles("), source.indexOf("  private damagePlayer("));
  assert.match(update, /this\.projectileBroadphase\.querySegment\(start, end, projectile\.radius\)/);
  assert.ok(update.indexOf("querySegment") < update.indexOf("for (const polygon of projectilePolygons)"));
});
