const MOON_BLOB_ROOT = "./assets/characters/moon-blob-01/";
const SHARED_SHADOW = `${MOON_BLOB_ROOT}moon-blob-01-shadow.png`;

function freezeSkin(definition) {
  return Object.freeze({
    ...definition,
    visual: Object.freeze({
      ...definition.visual,
      bodyPivot: Object.freeze({ ...definition.visual.bodyPivot }),
      drawSize: Object.freeze({ ...definition.visual.drawSize }),
      shadowSourceBounds: Object.freeze({ x: 395, y: 404, width: 745, height: 236 }),
      shadowPivot: Object.freeze({ x: 0.5, y: 0.5 }),
      shadowOffset: Object.freeze({ x: 10, y: 10 }),
      shadowDrawSize: Object.freeze({ ...definition.visual.shadowDrawSize }),
      hover: Object.freeze({ idleAmplitude: 1.35, idleRateHz: 0.72, movingAmplitude: 1.7, movingRateHz: 1.05, movementOffset: 1.6 }),
    }),
    weaponMount: Object.freeze({ ...definition.weaponMount }),
  });
}

/**
 * Canonical Dusty Orbit character registry.
 *
 * Character art, lobby copy, render geometry, and weapon docking all live
 * here. Adding a future production character should only require its artwork
 * plus one enabled entry in this array. Physics remain server-standardized.
 */
export const CHARACTER_SKINS = Object.freeze([
  freezeSkin({
    id: "moon-blob-01",
    displayName: "PURPLE NURPLE",
    description: "Small, purple, and alarmingly confident.",
    enabled: true,
    sprite: `${MOON_BLOB_ROOT}moon-blob-01.png`,
    shadow: SHARED_SHADOW,
    visual: {
      bodyPivot: { x: 0.4951171875, y: 0.5009765625 },
      sourceForwardAngleDegrees: 90,
      drawSize: { width: 84, height: 84 },
      shadowDrawSize: { width: 62, height: 44 },
      lobbyScale: 1,
    },
    weaponMount: { forwardOffset: 0, sideOffset: 0 },
  }),
  freezeSkin({
    id: "ivory-dart-01",
    displayName: "SIR PRICKS-A-LOT",
    description: "Pointy, polished, and exhausting at parties.",
    enabled: true,
    sprite: "./assets/characters/ivory-dart-01/ivory-dart-01.png",
    shadow: SHARED_SHADOW,
    visual: {
      bodyPivot: { x: 0.5, y: 0.5 },
      sourceForwardAngleDegrees: 90,
      drawSize: { width: 94, height: 94 },
      shadowDrawSize: { width: 68, height: 46 },
      lobbyScale: 1.18,
    },
    weaponMount: { forwardOffset: 2, sideOffset: 3 },
  }),
  freezeSkin({
    id: "mint-tank-01",
    displayName: "MAJOR DISAPPOINTMENT",
    description: "Built like a fridge. Handles like a grievance.",
    enabled: true,
    sprite: "./assets/characters/mint-tank-01/mint-tank-01.png",
    shadow: SHARED_SHADOW,
    visual: {
      bodyPivot: { x: 0.5, y: 0.48 },
      sourceForwardAngleDegrees: 90,
      drawSize: { width: 92, height: 92 },
      shadowDrawSize: { width: 72, height: 48 },
      lobbyScale: 1.28,
    },
    weaponMount: { forwardOffset: -1, sideOffset: 4 },
  }),
  freezeSkin({
    id: "void-orb-01",
    displayName: "THE PROBE-LEM",
    description: "A glowing HR incident with excellent posture.",
    enabled: true,
    sprite: "./assets/characters/void-orb-01/void-orb-01.png",
    shadow: SHARED_SHADOW,
    visual: {
      bodyPivot: { x: 0.5, y: 0.49 },
      sourceForwardAngleDegrees: 90,
      drawSize: { width: 92, height: 92 },
      shadowDrawSize: { width: 68, height: 46 },
      lobbyScale: 1.22,
    },
    weaponMount: { forwardOffset: 0, sideOffset: 4 },
  }),
]);

export const DEFAULT_CHARACTER_SKIN_ID = CHARACTER_SKINS.find((skin) => skin.enabled)?.id ?? "moon-blob-01";

export function enabledCharacterSkins(registry = CHARACTER_SKINS) {
  return registry.filter((skin) => skin.enabled === true);
}

export function characterSkinById(id, registry = CHARACTER_SKINS) {
  return enabledCharacterSkins(registry).find((skin) => skin.id === id) ?? null;
}

export function validCharacterSkinId(id) {
  return characterSkinById(id)?.id ?? DEFAULT_CHARACTER_SKIN_ID;
}
