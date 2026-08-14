import rockDefinition from "../../games/game-03/maps/lunar-liability/objects/rocks/rock-cluster-01.json" with { type: "json" };
import satelliteDefinition from "../../games/game-03/maps/lunar-liability/objects/satellite/satellite-relay-01.json" with { type: "json" };
import satelliteLeftDefinition from "../../games/game-03/maps/lunar-liability/objects/satellite/satellite-relay-01-left.json" with { type: "json" };
import outpostCanisterDefinition from "../../games/game-03/maps/lunar-liability/objects/outpost/outpost-canister-01.json" with { type: "json" };
import outpostSupplyCrateDefinition from "../../games/game-03/maps/lunar-liability/objects/outpost/outpost-supply-crate-01.json" with { type: "json" };
import outpostWallCornerDefinition from "../../games/game-03/maps/lunar-liability/objects/outpost/outpost-wall-corner-01.json" with { type: "json" };
import outpostWallStraightDefinition from "../../games/game-03/maps/lunar-liability/objects/outpost/outpost-wall-straight-01.json" with { type: "json" };
import { ENVIRONMENT_INSTANCES, MAP_METADATA, PLAYER_SPAWNS, SATELLITE_CONNECTION, SATELLITE_INSTANCES, WORLD } from "../../games/game-03/maps/lunar-liability/map.js";
import { collisionBlocksMovement, collisionBlocksProjectiles, transformNormalizedPolygon } from "../../games/game-03/collision-geometry.js";

export type Point = { x: number; y: number };
export type Polygon = Point[];

export const DUSTY_MAP = Object.freeze({
  id: MAP_METADATA.arenaId,
  mapId: MAP_METADATA.id,
  name: MAP_METADATA.name,
  description: MAP_METADATA.description,
  maxPlayers: MAP_METADATA.maxPlayers,
  width: WORLD.width,
  height: WORLD.height,
});

export const DUSTY_PLAYER_RADIUS = 17;
// Movement keeps the compact physics radius so characters can navigate the
// arena cleanly. Combat uses the opaque body footprint shown by the 84-94px
// production sprites, preventing a round from visibly crossing a player while
// missing a much smaller invisible circle.
export const DUSTY_PLAYER_HIT_RADIUS = 34;
export const DUSTY_PLAYER_SPEED = 165;

const DEFINITIONS = Object.freeze({
  [rockDefinition.id]: rockDefinition,
  [satelliteDefinition.id]: satelliteDefinition,
  [satelliteLeftDefinition.id]: satelliteLeftDefinition,
  [outpostCanisterDefinition.id]: outpostCanisterDefinition,
  [outpostSupplyCrateDefinition.id]: outpostSupplyCrateDefinition,
  [outpostWallCornerDefinition.id]: outpostWallCornerDefinition,
  [outpostWallStraightDefinition.id]: outpostWallStraightDefinition,
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
export const DUSTY_SPAWNS: readonly Point[] = PLAYER_SPAWNS;

export const DUSTY_CANONICAL_COLLISION = Object.freeze({
  definitionId: rockDefinition.id,
  normalizedPointCount: rockDefinition.collision.points.length,
  definitions: Object.freeze([
    Object.freeze({ definitionId: rockDefinition.id, normalizedPointCount: rockDefinition.collision.points.length, source: "games/game-03/maps/lunar-liability/objects/rocks/rock-cluster-01.json" }),
    Object.freeze({ definitionId: satelliteDefinition.id, normalizedPointCount: satelliteDefinition.collisionPolygon.length, source: "games/game-03/maps/lunar-liability/objects/satellite/satellite-relay-01.json" }),
    Object.freeze({ definitionId: satelliteLeftDefinition.id, normalizedPointCount: satelliteLeftDefinition.collisionPolygon.length, source: "games/game-03/maps/lunar-liability/objects/satellite/satellite-relay-01-left.json" }),
    Object.freeze({ definitionId: outpostCanisterDefinition.id, normalizedPointCount: outpostCanisterDefinition.collisionPolygon.length, source: "games/game-03/maps/lunar-liability/objects/outpost/outpost-canister-01.json" }),
    Object.freeze({ definitionId: outpostSupplyCrateDefinition.id, normalizedPointCount: outpostSupplyCrateDefinition.collisionPolygon.length, source: "games/game-03/maps/lunar-liability/objects/outpost/outpost-supply-crate-01.json" }),
    Object.freeze({ definitionId: outpostWallCornerDefinition.id, normalizedPointCount: outpostWallCornerDefinition.collisionPolygon.length, source: "games/game-03/maps/lunar-liability/objects/outpost/outpost-wall-corner-01.json" }),
    Object.freeze({ definitionId: outpostWallStraightDefinition.id, normalizedPointCount: outpostWallStraightDefinition.collisionPolygon.length, source: "games/game-03/maps/lunar-liability/objects/outpost/outpost-wall-straight-01.json" }),
  ]),
  instanceCount: DUSTY_ENVIRONMENT_COLLIDERS.length,
});

export type MurderballMapRuntime = Readonly<{
  map: typeof DUSTY_MAP;
  polygons: typeof DUSTY_POLYGONS;
  projectilePolygons: typeof DUSTY_PROJECTILE_POLYGONS;
  satellites: typeof DUSTY_SATELLITES;
  satelliteConnectTolerance: number;
  satelliteDisconnectTolerance: number;
  spawns: readonly Point[];
}>;

export const DUSTY_MAP_RUNTIME: MurderballMapRuntime = Object.freeze({
  map: DUSTY_MAP,
  polygons: DUSTY_POLYGONS,
  projectilePolygons: DUSTY_PROJECTILE_POLYGONS,
  satellites: DUSTY_SATELLITES,
  satelliteConnectTolerance: DUSTY_SATELLITE_CONNECT_TOLERANCE,
  satelliteDisconnectTolerance: DUSTY_SATELLITE_DISCONNECT_TOLERANCE,
  spawns: DUSTY_SPAWNS,
});
