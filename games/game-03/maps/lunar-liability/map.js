export const MAP_METADATA = Object.freeze({
  id: "lunar-liability",
  arenaId: "dusty-orbit-001",
  name: "LUNAR LIABILITY",
  description: "An abandoned relay outpost with rocks, guns, and absolutely no waiver form.",
  previewUrl: "/games/game-03/maps/lunar-liability/terrain/dusty-orbit-ground-runtime.webp",
  moduleUrl: "/games/game-03/maps/lunar-liability/map.js",
  maxPlayers: 15,
});

export const WORLD = Object.freeze({ width: 3200, height: 2000 });

export const ASSET_DEFINITION_URLS = Object.freeze([
  "/games/game-03/maps/lunar-liability/objects/rocks/rock-cluster-01.json",
  "/games/game-03/maps/lunar-liability/objects/satellite/satellite-relay-01.json",
  "/games/game-03/maps/lunar-liability/objects/satellite/satellite-relay-01-left.json",
  "/games/game-03/maps/lunar-liability/objects/outpost/outpost-canister-01.json",
  "/games/game-03/maps/lunar-liability/objects/outpost/outpost-supply-crate-01.json",
  "/games/game-03/maps/lunar-liability/objects/outpost/outpost-wall-corner-01.json",
  "/games/game-03/maps/lunar-liability/objects/outpost/outpost-wall-straight-01.json",
]);

export const TERRAIN_URL = "/games/game-03/maps/lunar-liability/terrain/dusty-orbit-ground-runtime.webp?v=20260814";

export const ROCK_INSTANCES = Object.freeze([
  Object.freeze({ id: "ROCK A", assetId: "rock-cluster-01", x: 650, y: 450, width: 240, height: 240, rotation: 0 }),
  Object.freeze({ id: "ROCK B", assetId: "rock-cluster-01", x: 1500.5, y: 330, width: 320, height: 320, rotation: 0 }),
  Object.freeze({ id: "ROCK C", assetId: "rock-cluster-01", x: 2150, y: 550, width: 210, height: 210, rotation: 0 }),
  Object.freeze({ id: "ROCK D", assetId: "rock-cluster-01", x: 881, y: 1562.5, width: 300, height: 300, rotation: 19.5 }),
  Object.freeze({ id: "ROCK E", assetId: "rock-cluster-01", x: 1600, y: 1090, width: 260, height: 260, rotation: 0 }),
  Object.freeze({ id: "ROCK F", assetId: "rock-cluster-01", x: 2300, y: 1480, width: 350, height: 350, rotation: 0 }),
]);

export const SATELLITE_INSTANCES = Object.freeze([
  Object.freeze({ id: "SATELLITE RELAY WEST", assetId: "satellite-relay-01", kind: "satellite", x: 212.5, y: 919, width: 460, height: 460, rotation: 0 }),
  Object.freeze({ id: "SATELLITE RELAY EAST", assetId: "satellite-relay-01-left", kind: "satellite", x: 2965.5, y: 941.5, width: 460, height: 460, rotation: 0 }),
]);

export const OUTPOST_INSTANCES = Object.freeze([
  Object.freeze({ id: "OUTPOST CANISTER 01", assetId: "outpost-canister-01", kind: "outpost", x: 1384.2, y: 957.8, width: 300, height: 300, rotation: 0 }),
  Object.freeze({ id: "OUTPOST SUPPLY CRATE 01", assetId: "outpost-supply-crate-01", kind: "outpost", x: 1688.2, y: 801.8, width: 360, height: 360, rotation: -10.7 }),
  Object.freeze({ id: "OUTPOST WALL CORNER 01", assetId: "outpost-wall-corner-01", kind: "outpost", x: 1735.7, y: 1229.7, width: 520, height: 520, rotation: 0 }),
  Object.freeze({ id: "OUTPOST WALL STRAIGHT 01", assetId: "outpost-wall-straight-01", kind: "outpost", x: 1304, y: 725.8, width: 520, height: 520, rotation: -12 }),
]);

export const SATELLITE_CONNECTION = Object.freeze({ connectTolerance: 6, disconnectTolerance: 9 });

export const ENVIRONMENT_INSTANCES = Object.freeze([
  ...ROCK_INSTANCES.map((instance) => Object.freeze({ ...instance, kind: "rock" })),
  ...SATELLITE_INSTANCES,
  ...OUTPOST_INSTANCES,
]);

export const PLAYER_SPAWNS = Object.freeze([
  Object.freeze({ x: 1450, y: 900 }), Object.freeze({ x: 1650, y: 900 }),
  Object.freeze({ x: 300, y: 300 }), Object.freeze({ x: 2900, y: 300 }),
  Object.freeze({ x: 300, y: 1700 }), Object.freeze({ x: 2900, y: 1700 }),
  Object.freeze({ x: 1150, y: 900 }), Object.freeze({ x: 2200, y: 1050 }),
]);

export const PLAYER_SPAWN = Object.freeze({ x: 1600, y: 1750 });
