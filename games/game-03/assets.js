import * as DEFAULT_MAP from "./maps/lunar-liability/map.js?v=20260817";
import { collisionBlocksMovement, collisionBlocksProjectiles, depthSortY, transformNormalizedPolygon } from "./collision-geometry.js?v=20260817-5";
import { DEFAULT_CHARACTER_SKIN_ID, characterSkinById } from "./character-skins.js?v=20260814-2";

const ASSET_VERSION = "20260817-2";
const versioned = (url) => `${url}?v=${ASSET_VERSION}`;
const POWERUP_ART = Object.freeze({
  health: Object.freeze({ sprite: "health.png", sourceBounds: Object.freeze({ x: 229, y: 193, width: 797, height: 785 }) }),
  spy: Object.freeze({ sprite: "spy.png", sourceBounds: Object.freeze({ x: 306, y: 180, width: 654, height: 793 }) }),
  speed: Object.freeze({ sprite: "speed.png", sourceBounds: Object.freeze({ x: 193, y: 107, width: 869, height: 919 }) }),
  mole: Object.freeze({ sprite: "mole.png", sourceBounds: Object.freeze({ x: 0, y: 0, width: 192, height: 183 }) }),
  shield: Object.freeze({ sprite: "shield.png", sourceBounds: Object.freeze({ x: 0, y: 0, width: 187, height: 192 }) }),
  teleport: Object.freeze({ sprite: "teleport.png", sourceBounds: Object.freeze({ x: 0, y: 0, width: 175, height: 192 }) }),
  fart: Object.freeze({ sprite: "fart.png", sourceBounds: Object.freeze({ x: 0, y: 0, width: 161, height: 192 }) }),
});
const WEAPON_ART = Object.freeze({
  peaShooter: Object.freeze({ sprite: "weapon-pea-shooter.png", sourceBounds: Object.freeze({ x: 0, y: 0, width: 256, height: 199 }) }),
  pistol: Object.freeze({ sprite: "weapon-pistol.png", sourceBounds: Object.freeze({ x: 166, y: 322, width: 972, height: 552 }) }),
  burst: Object.freeze({ sprite: "weapon-burst.png", sourceBounds: Object.freeze({ x: 66, y: 325, width: 1127, height: 586 }) }),
  smg: Object.freeze({ sprite: "weapon-smg.png", sourceBounds: Object.freeze({ x: 64, y: 302, width: 1138, height: 621 }) }),
  shotgun: Object.freeze({ sprite: "weapon-shotgun.png", sourceBounds: Object.freeze({ x: 44, y: 281, width: 1184, height: 657 }) }),
  plasmaCannon: Object.freeze({ sprite: "weapon-plasma-cannon.png", sourceBounds: Object.freeze({ x: 27, y: 260, width: 1204, height: 706 }) }),
  randomGenerator: Object.freeze({ sprite: "weapon-random-generator.png", sourceBounds: Object.freeze({ x: 0, y: 0, width: 1254, height: 1254 }) }),
});

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return response.json();
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}`));
    image.src = url;
  });
}

async function loadCharacterAsset(skin) {
  const [body, shadow] = await Promise.all([loadImage(versioned(skin.sprite)), loadImage(versioned(skin.shadow))]);
  return {
    skin,
    definition: { ...skin.visual, bodyPivot: { normalized: skin.visual.bodyPivot } },
    body,
    shadow,
  };
}

export async function loadDustyOrbitAssets(mapDefinition = DEFAULT_MAP, onProgress = () => {}) {
  if (typeof mapDefinition === "function") {
    onProgress = mapDefinition;
    mapDefinition = DEFAULT_MAP;
  }
  const { ASSET_DEFINITION_URLS, BOUNDARY_COLLIDERS = [], BOUNDARY_OVERLAY = null, ENVIRONMENT_INSTANCES, MAP_METADATA, PLAYABLE_AREA = null, SATELLITE_CONNECTION, TERRAIN_MODE = "single", TERRAIN_URL, TERRAIN_VARIATION_TILES = [], WORLD } = mapDefinition;
  if (!MAP_METADATA || !Array.isArray(ASSET_DEFINITION_URLS) || !WORLD) throw new Error("Invalid Nebula Murderball map definition.");
  onProgress("Loading canonical collision geometry…", 0.12);
  const environmentDefinitions = await Promise.all(ASSET_DEFINITION_URLS.map((url) => loadJson(versioned(url))));
  onProgress("Loading Nebula Murderball artwork…", 0.34);
  const defaultSkin = characterSkinById(DEFAULT_CHARACTER_SKIN_ID);
  if (!defaultSkin) throw new Error("Nebula Murderball requires one enabled default character skin.");
  const powerupRoot = "./assets/powerups/";
  const weaponRoot = "./assets/weapons/";
  const definitionById = new Map(environmentDefinitions.map((definition) => [definition.id, definition]));
  const definitionRoot = new Map(ASSET_DEFINITION_URLS.map((url, index) => [environmentDefinitions[index].id, url.slice(0, url.lastIndexOf("/") + 1)]));
  const [terrain, terrainVariationImages, boundaryOverlayImage, environmentImages, defaultCharacter, health, spy, speed, mole, shield, teleport, fart, peaShooter, pistol, burst, smg, shotgun, plasmaCannon, randomGenerator] = await Promise.all([
    loadImage(TERRAIN_URL),
    Promise.all(TERRAIN_VARIATION_TILES.map((tile) => loadImage(tile.url))),
    BOUNDARY_OVERLAY?.url ? loadImage(BOUNDARY_OVERLAY.url) : Promise.resolve(null),
    Promise.all(environmentDefinitions.map((definition) => loadImage(versioned(definitionRoot.get(definition.id) + definition.sprite)))),
    loadCharacterAsset(defaultSkin),
    loadImage(versioned(powerupRoot + POWERUP_ART.health.sprite)),
    loadImage(versioned(powerupRoot + POWERUP_ART.spy.sprite)),
    loadImage(versioned(powerupRoot + POWERUP_ART.speed.sprite)),
    loadImage(versioned(powerupRoot + POWERUP_ART.mole.sprite)),
    loadImage(versioned(powerupRoot + POWERUP_ART.shield.sprite)),
    loadImage(versioned(powerupRoot + POWERUP_ART.teleport.sprite)),
    loadImage(versioned(powerupRoot + POWERUP_ART.fart.sprite)),
    loadImage(versioned(weaponRoot + WEAPON_ART.peaShooter.sprite)),
    loadImage(versioned(weaponRoot + WEAPON_ART.pistol.sprite)),
    loadImage(versioned(weaponRoot + WEAPON_ART.burst.sprite)),
    loadImage(versioned(weaponRoot + WEAPON_ART.smg.sprite)),
    loadImage(versioned(weaponRoot + WEAPON_ART.shotgun.sprite)),
    loadImage(versioned(weaponRoot + WEAPON_ART.plasmaCannon.sprite)),
    loadImage(versioned(weaponRoot + WEAPON_ART.randomGenerator.sprite)),
  ]);
  onProgress("Building shared environment polygons…", 0.8);
  const imageByAssetId = new Map(environmentDefinitions.map((definition, index) => [definition.id, environmentImages[index]]));
  const environment = ENVIRONMENT_INSTANCES.map((instance) => {
    const definition = definitionById.get(instance.assetId);
    if (!definition) throw new Error(`Missing environment definition for ${instance.assetId}.`);
    return {
      ...instance,
      definition,
      image: imageByAssetId.get(instance.assetId),
      polygon: transformNormalizedPolygon(definition, instance),
      depthY: depthSortY(definition, instance),
    };
  });
  const rocks = environment.filter((item) => item.kind === "rock");
  const satellites = environment.filter((item) => item.kind === "satellite");
  const healingStations = environment.filter((item) => item.kind === "healing-station");
  const weaponStations = environment.filter((item) => item.kind === "weapon-station");
  const characters = new Map([[defaultCharacter.skin.id, defaultCharacter]]);
  const characterLoads = new Map();
  const ensureCharacterSkin = (skinId) => {
    const skin = characterSkinById(skinId);
    if (!skin) return Promise.resolve(defaultCharacter);
    if (characters.has(skin.id)) return Promise.resolve(characters.get(skin.id));
    if (!characterLoads.has(skin.id)) characterLoads.set(skin.id, loadCharacterAsset(skin).then((asset) => {
      characters.set(skin.id, asset);
      characterLoads.delete(skin.id);
      return asset;
    }));
    return characterLoads.get(skin.id);
  };
  return {
    map: MAP_METADATA,
    world: WORLD,
    playableArea: PLAYABLE_AREA,
    terrain,
    terrainMode: TERRAIN_MODE,
    terrainVariations: TERRAIN_VARIATION_TILES.map((tile, index) => ({ ...tile, image: terrainVariationImages[index] })),
    boundaryOverlay: boundaryOverlayImage ? { ...BOUNDARY_OVERLAY, image: boundaryOverlayImage } : null,
    rock: rocks[0]?.image,
    rockDefinition: rocks[0]?.definition,
    rocks,
    satellites,
    healingStations,
    weaponStations,
    satelliteConnection: SATELLITE_CONNECTION,
    environment,
    polygons: [
      ...environment.filter((item) => collisionBlocksMovement(item.definition)).map((item) => item.polygon),
      ...BOUNDARY_COLLIDERS.map((item) => item.polygon),
    ],
    projectilePolygons: [
      ...environment.filter((item) => collisionBlocksProjectiles(item.definition)).map((item) => item.polygon),
      ...BOUNDARY_COLLIDERS.map((item) => item.polygon),
    ],
    boundaryPolygons: BOUNDARY_COLLIDERS.map((item) => item.polygon),
    characters,
    character: defaultCharacter,
    ensureCharacterSkin,
    powerups: {
      health: { image: health, sourceBounds: POWERUP_ART.health.sourceBounds },
      spy: { image: spy, sourceBounds: POWERUP_ART.spy.sourceBounds },
      speed: { image: speed, sourceBounds: POWERUP_ART.speed.sourceBounds },
      mole: { image: mole, sourceBounds: POWERUP_ART.mole.sourceBounds },
      shield: { image: shield, sourceBounds: POWERUP_ART.shield.sourceBounds },
      teleport: { image: teleport, sourceBounds: POWERUP_ART.teleport.sourceBounds },
      fart: { image: fart, sourceBounds: POWERUP_ART.fart.sourceBounds },
    },
    weapons: {
      peaShooter: { image: peaShooter, sourceBounds: WEAPON_ART.peaShooter.sourceBounds },
      pistol: { image: pistol, sourceBounds: WEAPON_ART.pistol.sourceBounds },
      burst: { image: burst, sourceBounds: WEAPON_ART.burst.sourceBounds },
      smg: { image: smg, sourceBounds: WEAPON_ART.smg.sourceBounds },
      shotgun: { image: shotgun, sourceBounds: WEAPON_ART.shotgun.sourceBounds },
      plasmaCannon: { image: plasmaCannon, sourceBounds: WEAPON_ART.plasmaCannon.sourceBounds },
      randomGenerator: { image: randomGenerator, sourceBounds: WEAPON_ART.randomGenerator.sourceBounds },
    },
  };
}
