export const WORLD = Object.freeze({ width: 3200, height: 2000 });

export const ASSET_DEFINITION_URLS = Object.freeze([
  "./assets/dusty-orbit/rocks/rock-cluster-01.json",
  "./assets/dusty-orbit/satellite/satellite-relay-01.json",
  "./assets/dusty-orbit/satellite/satellite-relay-01-left.json",
]);

export const TERRAIN_URL = "./assets/dusty-orbit/terrain/dusty-orbit-ground-runtime.webp?v=20260812";

export const ROCK_INSTANCES = Object.freeze([
  Object.freeze({ id: "ROCK A", assetId: "rock-cluster-01", x: 650, y: 450, width: 240, height: 240 }),
  Object.freeze({ id: "ROCK B", assetId: "rock-cluster-01", x: 1350, y: 420, width: 320, height: 320 }),
  Object.freeze({ id: "ROCK C", assetId: "rock-cluster-01", x: 2150, y: 550, width: 210, height: 210 }),
  Object.freeze({ id: "ROCK D", assetId: "rock-cluster-01", x: 900, y: 1480, width: 300, height: 300 }),
  Object.freeze({ id: "ROCK E", assetId: "rock-cluster-01", x: 1600, y: 1090, width: 260, height: 260 }),
  Object.freeze({ id: "ROCK F", assetId: "rock-cluster-01", x: 2300, y: 1480, width: 350, height: 350 }),
]);

export const SATELLITE_INSTANCES = Object.freeze([
  Object.freeze({ id: "SATELLITE RELAY WEST", assetId: "satellite-relay-01", kind: "satellite", x: 500, y: 1200, width: 460, height: 460 }),
  Object.freeze({ id: "SATELLITE RELAY EAST", assetId: "satellite-relay-01-left", kind: "satellite", x: 2700, y: 1200, width: 460, height: 460 }),
]);

export const SATELLITE_CONNECTION = Object.freeze({ connectTolerance: 6, disconnectTolerance: 9 });

export const ENVIRONMENT_INSTANCES = Object.freeze([
  ...ROCK_INSTANCES.map((instance) => Object.freeze({ ...instance, kind: "rock" })),
  ...SATELLITE_INSTANCES,
]);

export const PLAYER_SPAWN = Object.freeze({ x: 1600, y: 1750 });
