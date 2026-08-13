import rockDefinition from "../../games/game-03/assets/dusty-orbit/rocks/rock-cluster-01.json" with { type: "json" };
import satelliteDefinition from "../../games/game-03/assets/dusty-orbit/satellite/satellite-relay-01.json" with { type: "json" };
import satelliteLeftDefinition from "../../games/game-03/assets/dusty-orbit/satellite/satellite-relay-01-left.json" with { type: "json" };
import { ENVIRONMENT_INSTANCES, SATELLITE_CONNECTION, SATELLITE_INSTANCES, WORLD } from "../../games/game-03/map.js";
import { collisionBlocksMovement, collisionBlocksProjectiles, transformNormalizedPolygon } from "../../games/game-03/collision-geometry.js";

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

const DEFINITIONS = Object.freeze({
  [rockDefinition.id]: rockDefinition,
  [satelliteDefinition.id]: satelliteDefinition,
  [satelliteLeftDefinition.id]: satelliteLeftDefinition,
});

export const DUSTY_ENVIRONMENT_COLLIDERS = Object.freeze(ENVIRONMENT_INSTANCES.map((instance) => {
  const definition = DEFINITIONS[instance.assetId as keyof typeof DEFINITIONS];
  if (!definition) throw new Error(`Missing environment definition for ${instance.assetId}.`);
  return Object.freeze({
    ...instance,
    polygon: Object.freeze(transformNormalizedPolygon(definition, instance)),
    blocksMovement: collisionBlocksMovement(definition),
    blocksProjectiles: collisionBlocksProjectiles(definition),
  });
}));

export const DUSTY_POLYGONS: Polygon[] = Object.freeze(
  DUSTY_ENVIRONMENT_COLLIDERS.filter((item) => item.blocksMovement).map((item) => item.polygon),
) as unknown as Polygon[];

export const DUSTY_PROJECTILE_POLYGONS: Polygon[] = Object.freeze(
  DUSTY_ENVIRONMENT_COLLIDERS.filter((item) => item.blocksProjectiles).map((item) => item.polygon),
) as unknown as Polygon[];

export const DUSTY_SATELLITES = Object.freeze(SATELLITE_INSTANCES.map((satelliteInstance) => Object.freeze({
  ...satelliteInstance,
  polygon: DUSTY_ENVIRONMENT_COLLIDERS.find((item) => item.id === satelliteInstance.id)?.polygon as Polygon,
})));

export const DUSTY_SATELLITE_CONNECT_TOLERANCE = SATELLITE_CONNECTION.connectTolerance;
export const DUSTY_SATELLITE_DISCONNECT_TOLERANCE = SATELLITE_CONNECTION.disconnectTolerance;

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
  definitions: Object.freeze([
    Object.freeze({ definitionId: rockDefinition.id, normalizedPointCount: rockDefinition.collision.points.length, source: "games/game-03/assets/dusty-orbit/rocks/rock-cluster-01.json" }),
    Object.freeze({ definitionId: satelliteDefinition.id, normalizedPointCount: satelliteDefinition.collisionPolygon.length, source: "games/game-03/assets/dusty-orbit/satellite/satellite-relay-01.json" }),
    Object.freeze({ definitionId: satelliteLeftDefinition.id, normalizedPointCount: satelliteLeftDefinition.collisionPolygon.length, source: "games/game-03/assets/dusty-orbit/satellite/satellite-relay-01-left.json" }),
  ]),
  instanceCount: DUSTY_ENVIRONMENT_COLLIDERS.length,
});
