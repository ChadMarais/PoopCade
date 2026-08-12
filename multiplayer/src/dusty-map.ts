import rockDefinition from "../../games/game-03/assets/dusty-orbit/rocks/rock-cluster-01.json" with { type: "json" };
import { ROCK_INSTANCES, WORLD } from "../../games/game-03/map.js";
import { transformNormalizedPolygon } from "../../games/game-03/collision-geometry.js";

export type Point = { x: number; y: number };
export type Polygon = Point[];

export const DUSTY_MAP = Object.freeze({
  id: "dusty-orbit-001",
  name: "DUSTY ORBIT",
  width: WORLD.width,
  height: WORLD.height,
});

export const DUSTY_PLAYER_RADIUS = 17;
export const DUSTY_PLAYER_SPEED = 165;

export const DUSTY_POLYGONS: Polygon[] = Object.freeze(
  ROCK_INSTANCES.map((instance) => Object.freeze(transformNormalizedPolygon(rockDefinition, instance))),
) as unknown as Polygon[];

// The first pair is deliberately near enough for a quick two-client combat test.
export const DUSTY_SPAWNS: readonly Point[] = Object.freeze([
  Object.freeze({ x: 1450, y: 900 }),
  Object.freeze({ x: 1650, y: 900 }),
  Object.freeze({ x: 300, y: 300 }),
  Object.freeze({ x: 2900, y: 300 }),
  Object.freeze({ x: 300, y: 1700 }),
  Object.freeze({ x: 2900, y: 1700 }),
  Object.freeze({ x: 1150, y: 900 }),
  Object.freeze({ x: 2200, y: 1050 }),
]);

export const DUSTY_CANONICAL_COLLISION = Object.freeze({
  definitionId: rockDefinition.id,
  normalizedPointCount: rockDefinition.collision.points.length,
  instanceCount: ROCK_INSTANCES.length,
  source: "games/game-03/assets/dusty-orbit/rocks/rock-cluster-01.json",
});
