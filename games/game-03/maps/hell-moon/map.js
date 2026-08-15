export const MAP_METADATA = Object.freeze({
  id: "hell-moon",
  arenaId: "hell-moon-001",
  name: "HELL MOON",
  description: "Four fractured volcanic territories orbit a brutal central combat ring.",
  previewUrl: "/games/game-03/maps/hell-moon/preview/hell-moon-lobby-preview.webp?v=20260815-1",
  moduleUrl: "/games/game-03/maps/hell-moon/map.js",
  maxPlayers: 15,
});

// Twenty-five percent larger on each axis than Lunar Liability (3200 x 2000).
export const WORLD = Object.freeze({ width: 4000, height: 2500 });

export const ASSET_DEFINITION_URLS = Object.freeze([
  "/games/game-03/maps/hell-moon/objects/imported/lava3-2/lava3-2.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava1-2/lava1-2.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava3-1/lava3-1.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava1-1/lava1-1.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava1-2-2/lava1-2-2.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava1-3/lava1-3.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava1-2-3/lava1-2-3.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava1-3-2/lava1-3-2.json",
  "/games/game-03/maps/hell-moon/terrain/features/hell-moon-center-arena.json",
  "/games/game-03/maps/hell-moon/terrain/features/hell-moon-scorch-decal.json",
  "/games/game-03/maps/hell-moon/terrain/features/hell-moon-basalt-island.json",
  "/games/game-03/maps/hell-moon/terrain/features/hell-moon-cliff-corner.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava1-3-3/lava1-3-3.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava1-1-2/lava1-1-2.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava1-2-4/lava1-2-4.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava1-2-5/lava1-2-5.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava2/lava2.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava2-2/lava2-2.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava2-3/lava2-3.json",
  "/games/game-03/maps/hell-moon/objects/imported/lava2-4/lava2-4.json",
  "/games/game-03/maps/hell-moon/objects/imported/sat/sat.json",
  "/games/game-03/maps/hell-moon/objects/imported/sat-copy/sat-copy.json",
  "/games/game-03/maps/hell-moon/objects/imported/core1/core1.json",
  "/games/game-03/maps/hell-moon/objects/imported/building1/building1.json",
  "/games/game-03/maps/hell-moon/objects/imported/bunker1/bunker1.json",
  "/games/game-03/maps/hell-moon/objects/imported/powergrid1/powergrid1.json",
  "/games/game-03/maps/hell-moon/objects/imported/powergrid1-2/powergrid1-2.json",
  "/games/game-03/maps/hell-moon/objects/imported/pipe1/pipe1.json",
  "/games/game-03/maps/hell-moon/objects/imported/crate1/crate1.json",
]);

export const TERRAIN_URL = "/games/game-03/maps/hell-moon/terrain/hell-moon-ground-tile.png?v=20260815-2";
export const TERRAIN_MODE = "tile";
export const TERRAIN_VARIATION_TILES = Object.freeze([
  Object.freeze({
    url: "/games/game-03/maps/hell-moon/terrain/hell-moon-ground-variation.png?v=20260815-1",
    chance: .72,
    opacity: .82,
  }),
]);
// A modular strip is projected along the same clockwise polygon used by the
// authoritative collision rim. `sourceAnchorY` is the authored cliff lip: the
// transparent pixels below it fall over playable ground while the lava and
// drifting debris stay outside the arena.
export const BOUNDARY_OVERLAY = Object.freeze({
  mode: "polygon-strip",
  url: "/games/game-03/maps/hell-moon/boundary/hell-moon-volcanic-rim.png?v=20260815-1",
  thickness: 420,
  sourceAnchorY: 430,
  overlap: 60,
});

const freezePolygon = (points) => Object.freeze(points.map((point) => Object.freeze(point)));

// This deliberately avoids a rounded rectangle. Broad bays, shoulders and
// fractured corners make the arena read as one floating chunk of alien rock.
export const PLAYABLE_AREA = freezePolygon([
  { x: 310, y: 590 }, { x: 500, y: 330 }, { x: 870, y: 185 }, { x: 1260, y: 235 },
  { x: 1600, y: 125 }, { x: 1980, y: 185 }, { x: 2340, y: 105 }, { x: 2730, y: 175 },
  { x: 3160, y: 225 }, { x: 3525, y: 420 }, { x: 3735, y: 700 }, { x: 3690, y: 1010 },
  { x: 3800, y: 1310 }, { x: 3700, y: 1640 }, { x: 3750, y: 1900 }, { x: 3500, y: 2160 },
  { x: 3150, y: 2305 }, { x: 2740, y: 2260 }, { x: 2380, y: 2370 }, { x: 2000, y: 2300 },
  { x: 1640, y: 2385 }, { x: 1240, y: 2290 }, { x: 850, y: 2330 }, { x: 500, y: 2140 },
  { x: 275, y: 1840 }, { x: 330, y: 1530 }, { x: 200, y: 1240 }, { x: 305, y: 920 },
]);

const boundarySide = (id, outerEdge, innerEdge) => Object.freeze({
  id,
  polygon: freezePolygon([...outerEdge, ...[...innerEdge].reverse()]),
});

// Four concave perimeter polygons replace the old 28 overlapping rectangles.
// Each polygon follows every irregular point on one complete side and fills
// only the non-playable space between that edge and the world limit.
export const BOUNDARY_COLLIDERS = Object.freeze([
  boundarySide("HELL MOON RIM NORTH", [{ x: 0, y: 0 }, { x: WORLD.width, y: 0 }], PLAYABLE_AREA.slice(0, 11)),
  boundarySide("HELL MOON RIM EAST", [{ x: WORLD.width, y: 0 }, { x: WORLD.width, y: WORLD.height }], PLAYABLE_AREA.slice(10, 16)),
  boundarySide("HELL MOON RIM SOUTH", [{ x: WORLD.width, y: WORLD.height }, { x: 0, y: WORLD.height }], PLAYABLE_AREA.slice(15, 24)),
  boundarySide("HELL MOON RIM WEST", [{ x: 0, y: WORLD.height }, { x: 0, y: 0 }], [...PLAYABLE_AREA.slice(23), PLAYABLE_AREA[0]]),
]);

const terrain = (id, assetId, x, y, width, height, rotation = 0) => Object.freeze({
  id, assetId, kind: "terrain", renderLayer: "terrain", x, y, width, height, rotation,
});
const lava = (id, assetId, x, y, width, height, rotation = 0) => Object.freeze({
  id, assetId, kind: "lava-ditch", renderLayer: "terrain", x, y, width, height, rotation,
});

// Low-contrast glowing patches break up the repeating base tile without
// becoming navigation obstacles.
export const SCORCH_INSTANCES = Object.freeze([
]);

// Four visual territory anchors surround the center. They stay walkable for
// this terrain-layout phase; their cover props can be authored independently.
export const REGION_INSTANCES = Object.freeze([
]);

// Four broken diagonal magma faults divide the outer landmass into north,
// east, south and west regions. Every definition blocks movement but opts out
// of projectile collision so players can shoot across the below-grade lava.
export const LAVA_TRENCH_INSTANCES = Object.freeze([
  lava("NW FAULT 03", "lava1-2", 1124.2, 625.3, 530, 225, 34),
  lava("NW FAULT EDGE", "lava1-3", 1475.8, 862.8, 450, 210, 28),
  lava("NE FAULT 02", "lava1-2-2", 2561.5, 844, 540, 235, -38),
  lava("NE FAULT 03", "lava1-3", 2900, 620, 530, 225, -34),
  lava("SW FAULT 02", "lava1-2", 1449, 1635.5, 540, 235, -38),
  lava("SW FAULT 03", "lava1-3-2", 1100, 1880, 530, 225, -34),
  lava("SE FAULT 02", "lava1-3", 2566.6, 1651.1, 540, 235, 38),
  lava("SE FAULT 03", "lava1-2-3", 2900, 1880, 530, 225, 34),
]);

export const RIM_FEATURE_INSTANCES = Object.freeze([
]);

export const CENTER_ARENA_INSTANCE = terrain("HELL MOON CENTRAL COMBAT RING", "hell-moon-center-arena", 2000, 1250, 820, 820, 0);

export const ROCK_INSTANCES = Object.freeze([]);
export const SATELLITE_INSTANCES = Object.freeze([
  Object.freeze({ id: "SAT 01", assetId: "sat", kind: "satellite", x: 560.5, y: 1196.5, width: 360, height: 360, rotation: 0 }),
  Object.freeze({ id: "SAT-COPY 01", assetId: "sat-copy", kind: "satellite", x: 3436, y: 1224, width: 360, height: 360, rotation: 0 }),
]);
export const HEALING_STATION_INSTANCES = Object.freeze([
  Object.freeze({ id: "CORE1 01", assetId: "core1", kind: "healing-station", x: 2001.5, y: 1175, width: 360, height: 360, rotation: 0 }),
]);
export const OUTPOST_INSTANCES = Object.freeze([]);
export const SATELLITE_CONNECTION = Object.freeze({ connectTolerance: 6, disconnectTolerance: 9 });
export const HEALING_STATION_CONNECTION = Object.freeze({ connectTolerance: 6, disconnectTolerance: 9, healIntervalMs: 2000 });
export const ENVIRONMENT_INSTANCES = Object.freeze([
  ...SCORCH_INSTANCES,
  ...REGION_INSTANCES,
  ...LAVA_TRENCH_INSTANCES,
  ...RIM_FEATURE_INSTANCES,
  CENTER_ARENA_INSTANCE,
  Object.freeze({ id: "LAVA1-3-3 01", assetId: "lava1-3-3", kind: "imported", x: 806.5, y: 402.5, width: 360, height: 180, rotation: 33.2 }),
  Object.freeze({ id: "LAVA1-1-2 01", assetId: "lava1-1-2", kind: "imported", x: 3201, y: 409, width: 360, height: 180, rotation: -35.9 }),
  Object.freeze({ id: "LAVA1-2-4 01", assetId: "lava1-2-4", kind: "imported", x: 3219.5, y: 2095, width: 360, height: 180, rotation: 33.8 }),
  Object.freeze({ id: "LAVA1-2-5 01", assetId: "lava1-2-5", kind: "imported", x: 781.2, y: 2094, width: 360, height: 180, rotation: -37.6 }),
  Object.freeze({ id: "LAVA2 01", assetId: "lava2", kind: "imported", x: 1766.9, y: 1468, width: 360, height: 360, rotation: -90.1 }),
  Object.freeze({ id: "LAVA2-2 01", assetId: "lava2-2", kind: "imported", x: 2243, y: 1469, width: 360, height: 360, rotation: -179 }),
  Object.freeze({ id: "LAVA2-3 01", assetId: "lava2-3", kind: "imported", x: 1768.9, y: 1015, width: 360, height: 360, rotation: 0 }),
  Object.freeze({ id: "LAVA2-4 01", assetId: "lava2-4", kind: "imported", x: 2237.5, y: 1016, width: 360, height: 360, rotation: 89.5 }),
  ...SATELLITE_INSTANCES,
  ...HEALING_STATION_INSTANCES,
  Object.freeze({ id: "BUILDING1 01", assetId: "building1", kind: "imported", x: 2495.7, y: 408.4, width: 360, height: 360, rotation: -0.5 }),
  Object.freeze({ id: "BUNKER1 01", assetId: "bunker1", kind: "imported", x: 1491.4, y: 430.5, width: 360, height: 360, rotation: -0.7 }),
  Object.freeze({ id: "POWERGRID1 01", assetId: "powergrid1", kind: "imported", x: 3330, y: 749.2, width: 360, height: 360, rotation: 0 }),
  Object.freeze({ id: "POWERGRID1-2 01", assetId: "powergrid1-2", kind: "imported", x: 903, y: 1665.5, width: 360, height: 360, rotation: 0 }),
  Object.freeze({ id: "PIPE1 01", assetId: "pipe1", kind: "imported", x: 2467.7, y: 2008, width: 360, height: 360, rotation: 0.2 }),
  Object.freeze({ id: "CRATE1 01", assetId: "crate1", kind: "imported", x: 1509.8, y: 2040.3, width: 360, height: 360, rotation: 0.9 }),
]);

export const PLAYER_SPAWNS = Object.freeze([
  Object.freeze({ x: 1780, y: 470 }), Object.freeze({ x: 2220, y: 470 }),
  Object.freeze({ x: 3370, y: 1060 }), Object.freeze({ x: 3370, y: 1420 }),
  Object.freeze({ x: 1780, y: 2050 }), Object.freeze({ x: 2220, y: 2050 }),
  Object.freeze({ x: 650, y: 1060 }), Object.freeze({ x: 650, y: 1420 }),
  Object.freeze({ x: 2000, y: 1090 }), Object.freeze({ x: 2000, y: 1410 }),
]);

export const PLAYER_SPAWN = Object.freeze({ x: 2000, y: 1250 });
