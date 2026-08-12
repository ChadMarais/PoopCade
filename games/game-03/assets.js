import { ROCK_INSTANCES, TERRAIN_URL, WORLD } from "./map.js?v=20260812";
import { transformNormalizedPolygon } from "./collision-geometry.js?v=20260812";

const ASSET_VERSION = "20260812";
const versioned = (url) => `${url}?v=${ASSET_VERSION}`;
const ROCK_DEFINITION_URL = versioned("./assets/dusty-orbit/rocks/rock-cluster-01.json");
const CHARACTER_DEFINITION_URL = versioned("./assets/characters/moon-blob-01/moon-blob-01.json");

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
  const [rockDefinition, characterDefinition] = await Promise.all([
    loadJson(ROCK_DEFINITION_URL),
    loadJson(CHARACTER_DEFINITION_URL),
  ]);
  onProgress("Loading Dusty Orbit artwork…", 0.34);
  const root = "./assets/characters/moon-blob-01/";
  const rockRoot = "./assets/dusty-orbit/rocks/";
  const [terrain, rock, body, shadow] = await Promise.all([
    loadImage(TERRAIN_URL),
    loadImage(versioned(rockRoot + rockDefinition.sprite)),
    loadImage(versioned(root + characterDefinition.sprite)),
    loadImage(versioned(root + characterDefinition.shadow)),
  ]);
  onProgress("Building shared rock polygons…", 0.8);
  const rocks = ROCK_INSTANCES.map((instance) => ({
    ...instance,
    polygon: transformNormalizedPolygon(rockDefinition, instance),
    depthY: instance.y + (rockDefinition.depth?.sortAnchorY - rockDefinition.anchor.y) * instance.height,
  }));
  return {
    world: WORLD,
    terrain,
    rock,
    rockDefinition,
    rocks,
    polygons: rocks.map((item) => item.polygon),
    character: { definition: characterDefinition, body, shadow },
  };
}
