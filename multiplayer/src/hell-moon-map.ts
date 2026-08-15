import { BOUNDARY_COLLIDERS, ENVIRONMENT_INSTANCES, HEALING_STATION_CONNECTION, HEALING_STATION_INSTANCES, MAP_METADATA, PLAYER_SPAWNS, SATELLITE_CONNECTION, SATELLITE_INSTANCES, WORLD } from "../../games/game-03/maps/hell-moon/map.js";
import importedLava32Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava3-2/lava3-2.json" with { type: "json" };
import importedLava12Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava1-2/lava1-2.json" with { type: "json" };
import importedLava31Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava3-1/lava3-1.json" with { type: "json" };
import importedLava11Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava1-1/lava1-1.json" with { type: "json" };
import importedLava122Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava1-2-2/lava1-2-2.json" with { type: "json" };
import importedLava13Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava1-3/lava1-3.json" with { type: "json" };
import importedLava123Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava1-2-3/lava1-2-3.json" with { type: "json" };
import importedLava132Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava1-3-2/lava1-3-2.json" with { type: "json" };
import centerArenaDefinition from "../../games/game-03/maps/hell-moon/terrain/features/hell-moon-center-arena.json" with { type: "json" };
import scorchDecalDefinition from "../../games/game-03/maps/hell-moon/terrain/features/hell-moon-scorch-decal.json" with { type: "json" };
import basaltIslandDefinition from "../../games/game-03/maps/hell-moon/terrain/features/hell-moon-basalt-island.json" with { type: "json" };
import cliffCornerDefinition from "../../games/game-03/maps/hell-moon/terrain/features/hell-moon-cliff-corner.json" with { type: "json" };
import importedLava133Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava1-3-3/lava1-3-3.json" with { type: "json" };
import importedLava112Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava1-1-2/lava1-1-2.json" with { type: "json" };
import importedLava124Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava1-2-4/lava1-2-4.json" with { type: "json" };
import importedLava125Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava1-2-5/lava1-2-5.json" with { type: "json" };
import importedLava2Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava2/lava2.json" with { type: "json" };
import importedLava22Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava2-2/lava2-2.json" with { type: "json" };
import importedLava23Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava2-3/lava2-3.json" with { type: "json" };
import importedLava24Definition from "../../games/game-03/maps/hell-moon/objects/imported/lava2-4/lava2-4.json" with { type: "json" };
import importedSatDefinition from "../../games/game-03/maps/hell-moon/objects/imported/sat/sat.json" with { type: "json" };
import importedSatCopyDefinition from "../../games/game-03/maps/hell-moon/objects/imported/sat-copy/sat-copy.json" with { type: "json" };
import importedCore1Definition from "../../games/game-03/maps/hell-moon/objects/imported/core1/core1.json" with { type: "json" };
import importedBuilding1Definition from "../../games/game-03/maps/hell-moon/objects/imported/building1/building1.json" with { type: "json" };
import importedBunker1Definition from "../../games/game-03/maps/hell-moon/objects/imported/bunker1/bunker1.json" with { type: "json" };
import importedPowergrid1Definition from "../../games/game-03/maps/hell-moon/objects/imported/powergrid1/powergrid1.json" with { type: "json" };
import importedPowergrid12Definition from "../../games/game-03/maps/hell-moon/objects/imported/powergrid1-2/powergrid1-2.json" with { type: "json" };
import importedPipe1Definition from "../../games/game-03/maps/hell-moon/objects/imported/pipe1/pipe1.json" with { type: "json" };
import importedCrate1Definition from "../../games/game-03/maps/hell-moon/objects/imported/crate1/crate1.json" with { type: "json" };
import { collisionBlocksMovement, collisionBlocksProjectiles, transformNormalizedPolygon } from "../../games/game-03/collision-geometry.js";
import type { MurderballMapRuntime, Point, Polygon } from "./dusty-map.ts";

export const HELL_MOON_MAP = Object.freeze({
  id: MAP_METADATA.arenaId,
  mapId: MAP_METADATA.id,
  name: MAP_METADATA.name,
  description: MAP_METADATA.description,
  maxPlayers: MAP_METADATA.maxPlayers,
  width: WORLD.width,
  height: WORLD.height,
});

// The local map authoring service registers imported object definitions here.
// Keeping the empty registry in the base map means the first Hell Moon import
// has the same canonical server-collision path as every later import.
// Keep this declaration deliberately simple: both current and older local
// authoring helpers can insert the first imported definition into this block.
const DEFINITIONS = Object.freeze({
  [importedLava32Definition.id]: importedLava32Definition,
  [importedLava12Definition.id]: importedLava12Definition,
  [importedLava31Definition.id]: importedLava31Definition,
  [importedLava11Definition.id]: importedLava11Definition,
  [importedLava122Definition.id]: importedLava122Definition,
  [importedLava13Definition.id]: importedLava13Definition,
  [importedLava123Definition.id]: importedLava123Definition,
  [importedLava132Definition.id]: importedLava132Definition,
  [centerArenaDefinition.id]: centerArenaDefinition,
  [scorchDecalDefinition.id]: scorchDecalDefinition,
  [basaltIslandDefinition.id]: basaltIslandDefinition,
  [cliffCornerDefinition.id]: cliffCornerDefinition,
  [importedLava133Definition.id]: importedLava133Definition,
  [importedLava112Definition.id]: importedLava112Definition,
  [importedLava124Definition.id]: importedLava124Definition,
  [importedLava125Definition.id]: importedLava125Definition,
  [importedLava2Definition.id]: importedLava2Definition,
  [importedLava22Definition.id]: importedLava22Definition,
  [importedLava23Definition.id]: importedLava23Definition,
  [importedLava24Definition.id]: importedLava24Definition,
  [importedSatDefinition.id]: importedSatDefinition,
  [importedSatCopyDefinition.id]: importedSatCopyDefinition,
  [importedCore1Definition.id]: importedCore1Definition,
  [importedBuilding1Definition.id]: importedBuilding1Definition,
  [importedBunker1Definition.id]: importedBunker1Definition,
  [importedPowergrid1Definition.id]: importedPowergrid1Definition,
  [importedPowergrid12Definition.id]: importedPowergrid12Definition,
  [importedPipe1Definition.id]: importedPipe1Definition,
  [importedCrate1Definition.id]: importedCrate1Definition,
});

const IMPORTED_ENVIRONMENT_COLLIDERS = ENVIRONMENT_INSTANCES.map((instance) => {
  const definition = DEFINITIONS[instance.assetId];
  if (!definition) throw new Error(`Missing Hell Moon environment definition for ${instance.assetId}.`);
  return Object.freeze({
    ...instance,
    polygon: Object.freeze(transformNormalizedPolygon(definition, instance)),
    blocksMovement: collisionBlocksMovement(definition),
    blocksProjectiles: collisionBlocksProjectiles(definition),
  });
});

const BOUNDARY_ENVIRONMENT_COLLIDERS = BOUNDARY_COLLIDERS.map((item) => Object.freeze({
  ...item,
  blocksMovement: true,
  blocksProjectiles: true,
}));

export const HELL_MOON_ENVIRONMENT_COLLIDERS = Object.freeze([
  ...IMPORTED_ENVIRONMENT_COLLIDERS,
  ...BOUNDARY_ENVIRONMENT_COLLIDERS,
]);

export const HELL_MOON_SATELLITES = Object.freeze(SATELLITE_INSTANCES.map((satelliteInstance) => {
  const collider = HELL_MOON_ENVIRONMENT_COLLIDERS.find((item) => item.id === satelliteInstance.id);
  if (!collider) throw new Error(`Missing Hell Moon satellite collider for ${satelliteInstance.id}.`);
  return Object.freeze({
    ...satelliteInstance,
    polygon: collider.polygon as Polygon,
  });
}));

export const HELL_MOON_HEALING_STATIONS = Object.freeze(HEALING_STATION_INSTANCES.map((stationInstance) => {
  const collider = HELL_MOON_ENVIRONMENT_COLLIDERS.find((item) => item.id === stationInstance.id);
  if (!collider) throw new Error(`Missing Hell Moon healing-station collider for ${stationInstance.id}.`);
  return Object.freeze({
    ...stationInstance,
    polygon: collider.polygon as Polygon,
  });
}));

export const HELL_MOON_BOUNDARY_POLYGONS = Object.freeze(
  BOUNDARY_ENVIRONMENT_COLLIDERS.map((item) => item.polygon),
) as unknown as readonly Polygon[];

const MOVEMENT_POLYGONS = Object.freeze(HELL_MOON_ENVIRONMENT_COLLIDERS.filter((item) => item.blocksMovement).map((item) => item.polygon)) as unknown as Polygon[];
const PROJECTILE_POLYGONS = Object.freeze(HELL_MOON_ENVIRONMENT_COLLIDERS.filter((item) => item.blocksProjectiles).map((item) => item.polygon)) as unknown as Polygon[];

export const HELL_MOON_MAP_RUNTIME: MurderballMapRuntime = Object.freeze({
  map: HELL_MOON_MAP,
  polygons: MOVEMENT_POLYGONS,
  projectilePolygons: PROJECTILE_POLYGONS,
  satellites: HELL_MOON_SATELLITES,
  satelliteConnectTolerance: SATELLITE_CONNECTION.connectTolerance,
  satelliteDisconnectTolerance: SATELLITE_CONNECTION.disconnectTolerance,
  healingStations: HELL_MOON_HEALING_STATIONS,
  healingStationConnectTolerance: HEALING_STATION_CONNECTION.connectTolerance,
  healingStationDisconnectTolerance: HEALING_STATION_CONNECTION.disconnectTolerance,
  healingStationHealIntervalMs: HEALING_STATION_CONNECTION.healIntervalMs,
  boundaryPolygons: HELL_MOON_BOUNDARY_POLYGONS,
  spawns: PLAYER_SPAWNS as readonly Point[],
});

export const HELL_MOON_CANONICAL_COLLISION = Object.freeze({
  definitionId: null,
  normalizedPointCount: 0,
  definitions: Object.freeze([
    Object.freeze({ definitionId: importedLava32Definition.id, normalizedPointCount: importedLava32Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava3-2/lava3-2.json" }),
    Object.freeze({ definitionId: importedLava12Definition.id, normalizedPointCount: importedLava12Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava1-2/lava1-2.json" }),
    Object.freeze({ definitionId: importedLava31Definition.id, normalizedPointCount: importedLava31Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava3-1/lava3-1.json" }),
    Object.freeze({ definitionId: importedLava11Definition.id, normalizedPointCount: importedLava11Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava1-1/lava1-1.json" }),
    Object.freeze({ definitionId: importedLava122Definition.id, normalizedPointCount: importedLava122Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava1-2-2/lava1-2-2.json" }),
    Object.freeze({ definitionId: importedLava13Definition.id, normalizedPointCount: importedLava13Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava1-3/lava1-3.json" }),
    Object.freeze({ definitionId: importedLava123Definition.id, normalizedPointCount: importedLava123Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava1-2-3/lava1-2-3.json" }),
    Object.freeze({ definitionId: importedLava132Definition.id, normalizedPointCount: importedLava132Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava1-3-2/lava1-3-2.json" }),
    Object.freeze({ definitionId: centerArenaDefinition.id, normalizedPointCount: centerArenaDefinition.collision.points.length, source: "games/game-03/maps/hell-moon/terrain/features/hell-moon-center-arena.json" }),
    Object.freeze({ definitionId: scorchDecalDefinition.id, normalizedPointCount: scorchDecalDefinition.collision.points.length, source: "games/game-03/maps/hell-moon/terrain/features/hell-moon-scorch-decal.json" }),
    Object.freeze({ definitionId: basaltIslandDefinition.id, normalizedPointCount: basaltIslandDefinition.collision.points.length, source: "games/game-03/maps/hell-moon/terrain/features/hell-moon-basalt-island.json" }),
    Object.freeze({ definitionId: cliffCornerDefinition.id, normalizedPointCount: cliffCornerDefinition.collision.points.length, source: "games/game-03/maps/hell-moon/terrain/features/hell-moon-cliff-corner.json" }),
    Object.freeze({ definitionId: importedLava133Definition.id, normalizedPointCount: importedLava133Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava1-3-3/lava1-3-3.json" }),
    Object.freeze({ definitionId: importedLava112Definition.id, normalizedPointCount: importedLava112Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava1-1-2/lava1-1-2.json" }),
    Object.freeze({ definitionId: importedLava124Definition.id, normalizedPointCount: importedLava124Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava1-2-4/lava1-2-4.json" }),
    Object.freeze({ definitionId: importedLava125Definition.id, normalizedPointCount: importedLava125Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava1-2-5/lava1-2-5.json" }),
    Object.freeze({ definitionId: importedLava2Definition.id, normalizedPointCount: importedLava2Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava2/lava2.json" }),
    Object.freeze({ definitionId: importedLava22Definition.id, normalizedPointCount: importedLava22Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava2-2/lava2-2.json" }),
    Object.freeze({ definitionId: importedLava23Definition.id, normalizedPointCount: importedLava23Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava2-3/lava2-3.json" }),
    Object.freeze({ definitionId: importedLava24Definition.id, normalizedPointCount: importedLava24Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/lava2-4/lava2-4.json" }),
    Object.freeze({ definitionId: importedSatDefinition.id, normalizedPointCount: importedSatDefinition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/sat/sat.json" }),
    Object.freeze({ definitionId: importedSatCopyDefinition.id, normalizedPointCount: importedSatCopyDefinition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/sat-copy/sat-copy.json" }),
    Object.freeze({ definitionId: importedCore1Definition.id, normalizedPointCount: importedCore1Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/core1/core1.json" }),
    Object.freeze({ definitionId: importedBuilding1Definition.id, normalizedPointCount: importedBuilding1Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/building1/building1.json" }),
    Object.freeze({ definitionId: importedBunker1Definition.id, normalizedPointCount: importedBunker1Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/bunker1/bunker1.json" }),
    Object.freeze({ definitionId: importedPowergrid1Definition.id, normalizedPointCount: importedPowergrid1Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/powergrid1/powergrid1.json" }),
    Object.freeze({ definitionId: importedPowergrid12Definition.id, normalizedPointCount: importedPowergrid12Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/powergrid1-2/powergrid1-2.json" }),
    Object.freeze({ definitionId: importedPipe1Definition.id, normalizedPointCount: importedPipe1Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/pipe1/pipe1.json" }),
    Object.freeze({ definitionId: importedCrate1Definition.id, normalizedPointCount: importedCrate1Definition.collision.points.length, source: "games/game-03/maps/hell-moon/objects/imported/crate1/crate1.json" }),
  ]),
  instanceCount: HELL_MOON_ENVIRONMENT_COLLIDERS.length,
});
