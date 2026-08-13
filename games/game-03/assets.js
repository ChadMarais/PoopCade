import { ASSET_DEFINITION_URLS, ENVIRONMENT_INSTANCES, SATELLITE_CONNECTION, TERRAIN_URL, WORLD } from "./map.js?v=20260813-3";
import { collisionBlocksMovement, depthSortY, transformNormalizedPolygon } from "./collision-geometry.js?v=20260813";

const ASSET_VERSION = "20260813-8";
const versioned = (url) => `${url}?v=${ASSET_VERSION}`;
const CHARACTER_DEFINITION_URL = versioned("./assets/characters/moon-blob-01/moon-blob-01.json");
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

export async function loadDustyOrbitAssets(onProgress = () => {}) {
  onProgress("Loading canonical collision geometry…", 0.12);
  const [environmentDefinitions, characterDefinition] = await Promise.all([
    Promise.all(ASSET_DEFINITION_URLS.map((url) => loadJson(versioned(url)))),
    loadJson(CHARACTER_DEFINITION_URL),
  ]);
  onProgress("Loading Dusty Orbit artwork…", 0.34);
  const characterRoot = "./assets/characters/moon-blob-01/";
  const powerupRoot = "./assets/dusty-orbit/powerups/";
  const weaponRoot = "./assets/weapons/";
  const definitionById = new Map(environmentDefinitions.map((definition) => [definition.id, definition]));
  const definitionRoot = new Map(ASSET_DEFINITION_URLS.map((url, index) => [environmentDefinitions[index].id, url.slice(0, url.lastIndexOf("/") + 1)]));
  const [terrain, environmentImages, body, shadow, health, spy, speed, mole, shield, teleport, fart, peaShooter] = await Promise.all([
    loadImage(TERRAIN_URL),
    Promise.all(environmentDefinitions.map((definition) => loadImage(versioned(definitionRoot.get(definition.id) + definition.sprite)))),
    loadImage(versioned(characterRoot + characterDefinition.sprite)),
    loadImage(versioned(characterRoot + characterDefinition.shadow)),
    loadImage(versioned(powerupRoot + POWERUP_ART.health.sprite)),
    loadImage(versioned(powerupRoot + POWERUP_ART.spy.sprite)),
    loadImage(versioned(powerupRoot + POWERUP_ART.speed.sprite)),
    loadImage(versioned(powerupRoot + POWERUP_ART.mole.sprite)),
    loadImage(versioned(powerupRoot + POWERUP_ART.shield.sprite)),
    loadImage(versioned(powerupRoot + POWERUP_ART.teleport.sprite)),
    loadImage(versioned(powerupRoot + POWERUP_ART.fart.sprite)),
    loadImage(versioned(weaponRoot + WEAPON_ART.peaShooter.sprite)),
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
  return {
    world: WORLD,
    terrain,
    rock: rocks[0]?.image,
    rockDefinition: rocks[0]?.definition,
    rocks,
    satellites,
    satelliteConnection: SATELLITE_CONNECTION,
    environment,
    polygons: environment.filter((item) => collisionBlocksMovement(item.definition)).map((item) => item.polygon),
    character: { definition: characterDefinition, body, shadow },
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
    },
  };
}
