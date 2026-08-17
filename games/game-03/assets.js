import * as DEFAULT_MAP from "./maps/lunar-liability/map.js?v=20260817-4";
import { mobileOptimizedAssetUrl } from "./asset-profile.js?v=20260817-1";
import { collisionBlocksMovement, collisionBlocksProjectiles, depthSortY, transformNormalizedPolygon } from "./collision-geometry.js?v=20260817-5";
import { DEFAULT_CHARACTER_SKIN_ID, characterSkinById } from "./character-skins.js?v=20260814-2";

const ASSET_VERSION = "20260817-4";
const versioned = (url) => `${url}?v=${ASSET_VERSION}`;
const POWERUP_ART = Object.freeze({
  health: Object.freeze({ sprite: "health.png", canvas: Object.freeze({ width: 1254, height: 1254 }), sourceBounds: Object.freeze({ x: 229, y: 193, width: 797, height: 785 }) }),
  spy: Object.freeze({ sprite: "spy.png", canvas: Object.freeze({ width: 1254, height: 1254 }), sourceBounds: Object.freeze({ x: 306, y: 180, width: 654, height: 793 }) }),
  speed: Object.freeze({ sprite: "speed.png", canvas: Object.freeze({ width: 1254, height: 1254 }), sourceBounds: Object.freeze({ x: 193, y: 107, width: 869, height: 919 }) }),
  mole: Object.freeze({ sprite: "mole.png", canvas: Object.freeze({ width: 192, height: 183 }), sourceBounds: Object.freeze({ x: 0, y: 0, width: 192, height: 183 }) }),
  shield: Object.freeze({ sprite: "shield.png", canvas: Object.freeze({ width: 187, height: 192 }), sourceBounds: Object.freeze({ x: 0, y: 0, width: 187, height: 192 }) }),
  teleport: Object.freeze({ sprite: "teleport.png", canvas: Object.freeze({ width: 175, height: 192 }), sourceBounds: Object.freeze({ x: 0, y: 0, width: 175, height: 192 }) }),
  fart: Object.freeze({ sprite: "fart.png", canvas: Object.freeze({ width: 161, height: 192 }), sourceBounds: Object.freeze({ x: 0, y: 0, width: 161, height: 192 }) }),
});
const WEAPON_ART = Object.freeze({
  peaShooter: Object.freeze({ sprite: "weapon-pea-shooter.png", canvas: Object.freeze({ width: 256, height: 199 }), sourceBounds: Object.freeze({ x: 0, y: 0, width: 256, height: 199 }) }),
  pistol: Object.freeze({ sprite: "weapon-pistol.png", canvas: Object.freeze({ width: 1254, height: 1254 }), sourceBounds: Object.freeze({ x: 166, y: 322, width: 972, height: 552 }) }),
  burst: Object.freeze({ sprite: "weapon-burst.png", canvas: Object.freeze({ width: 1254, height: 1254 }), sourceBounds: Object.freeze({ x: 66, y: 325, width: 1127, height: 586 }) }),
  smg: Object.freeze({ sprite: "weapon-smg.png", canvas: Object.freeze({ width: 1254, height: 1254 }), sourceBounds: Object.freeze({ x: 64, y: 302, width: 1138, height: 621 }) }),
  shotgun: Object.freeze({ sprite: "weapon-shotgun.png", canvas: Object.freeze({ width: 1254, height: 1254 }), sourceBounds: Object.freeze({ x: 44, y: 281, width: 1184, height: 657 }) }),
  plasmaCannon: Object.freeze({ sprite: "weapon-plasma-cannon.png", canvas: Object.freeze({ width: 1254, height: 1254 }), sourceBounds: Object.freeze({ x: 27, y: 260, width: 1204, height: 706 }) }),
  randomGenerator: Object.freeze({ sprite: "weapon-random-generator.png", canvas: Object.freeze({ width: 1254, height: 1254 }), sourceBounds: Object.freeze({ x: 0, y: 0, width: 1254, height: 1254 }) }),
});

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return response.json();
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const preferredUrl = mobileOptimizedAssetUrl(url);
    let triedOriginal = preferredUrl === url;
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => {
      if (!triedOriginal) {
        triedOriginal = true;
        image.src = url;
        return;
      }
      reject(new Error(`Could not load ${url}`));
    };
    image.src = preferredUrl;
  });
}

async function loadImagesInBatches(urls, concurrency = 4) {
  const results = new Array(urls.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < urls.length) {
      const index = cursor++;
      results[index] = await loadImage(urls[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return results;
}

function scaledSourceBounds(art, image) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scaleX = width / art.canvas.width;
  const scaleY = height / art.canvas.height;
  return {
    x: art.sourceBounds.x * scaleX,
    y: art.sourceBounds.y * scaleY,
    width: art.sourceBounds.width * scaleX,
    height: art.sourceBounds.height * scaleY,
  };
}

async function loadCharacterAsset(skin) {
  const [body, shadow] = await Promise.all([loadImage(versioned(skin.sprite)), loadImage(versioned(skin.shadow))]);
  return {
    skin,
    definition: {
      ...skin.visual,
      bodyPivot: { normalized: skin.visual.bodyPivot },
      shadowSourceBounds: scaledSourceBounds({ canvas: { width: 1536, height: 1024 }, sourceBounds: skin.visual.shadowSourceBounds }, shadow),
    },
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
  const requiredAssetIds = new Set(ENVIRONMENT_INSTANCES.map((instance) => instance.assetId));
  const activeEnvironmentDefinitions = environmentDefinitions.filter((definition) => requiredAssetIds.has(definition.id));
  onProgress("Loading Nebula Murderball artwork…", 0.34);
  const defaultSkin = characterSkinById(DEFAULT_CHARACTER_SKIN_ID);
  if (!defaultSkin) throw new Error("Nebula Murderball requires one enabled default character skin.");
  const powerupRoot = "./assets/powerups/";
  const weaponRoot = "./assets/weapons/";
  const definitionById = new Map(environmentDefinitions.map((definition) => [definition.id, definition]));
  const definitionRoot = new Map(ASSET_DEFINITION_URLS.map((url, index) => [environmentDefinitions[index].id, url.slice(0, url.lastIndexOf("/") + 1)]));
  const mapImageUrls = [
    TERRAIN_URL,
    ...TERRAIN_VARIATION_TILES.map((tile) => tile.url),
    ...(BOUNDARY_OVERLAY?.url ? [BOUNDARY_OVERLAY.url] : []),
    ...activeEnvironmentDefinitions.map((definition) => versioned(definitionRoot.get(definition.id) + definition.sprite)),
  ];
  const powerupKeys = Object.keys(POWERUP_ART);
  const weaponKeys = Object.keys(WEAPON_ART);
  const sharedImageUrls = [
    ...powerupKeys.map((key) => versioned(powerupRoot + POWERUP_ART[key].sprite)),
    ...weaponKeys.map((key) => versioned(weaponRoot + WEAPON_ART[key].sprite)),
  ];
  const [mapImages, defaultCharacter, sharedImages] = await Promise.all([
    loadImagesInBatches(mapImageUrls, 4),
    loadCharacterAsset(defaultSkin),
    loadImagesInBatches(sharedImageUrls, 2),
  ]);
  let mapImageIndex = 0;
  const terrain = mapImages[mapImageIndex++];
  const terrainVariationImages = mapImages.slice(mapImageIndex, mapImageIndex += TERRAIN_VARIATION_TILES.length);
  const boundaryOverlayImage = BOUNDARY_OVERLAY?.url ? mapImages[mapImageIndex++] : null;
  const environmentImages = mapImages.slice(mapImageIndex);
  const powerupImages = sharedImages.slice(0, powerupKeys.length);
  const weaponImages = sharedImages.slice(powerupKeys.length);
  const powerupImageByKey = new Map(powerupKeys.map((key, index) => [key, powerupImages[index]]));
  const weaponImageByKey = new Map(weaponKeys.map((key, index) => [key, weaponImages[index]]));
  onProgress("Building shared environment polygons…", 0.8);
  const imageByAssetId = new Map(activeEnvironmentDefinitions.map((definition, index) => [definition.id, environmentImages[index]]));
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
      ...Object.fromEntries(powerupKeys.map((key) => [key, { image: powerupImageByKey.get(key), sourceBounds: scaledSourceBounds(POWERUP_ART[key], powerupImageByKey.get(key)) }])),
    },
    weapons: {
      ...Object.fromEntries(weaponKeys.map((key) => [key, { image: weaponImageByKey.get(key), sourceBounds: scaledSourceBounds(WEAPON_ART[key], weaponImageByKey.get(key)) }])),
    },
  };
}
