import assert from "node:assert/strict";
import test from "node:test";
import { createPolygonBroadphase, moveCircleWithSliding } from "../../games/game-03/collision-geometry.js";
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
