import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const AUTHORING_API_VERSION = 3;
const MAP_SOURCE_PATH = "games/game-03/maps/lunar-liability/map.js";
const AUTHORING_MAPS = Object.freeze({
  "lunar-liability": Object.freeze({ mapSourcePath: MAP_SOURCE_PATH, workerSourcePath: "multiplayer/src/dusty-map.ts", width: 3200, height: 2000 }),
  "hell-moon": Object.freeze({ mapSourcePath: "games/game-03/maps/hell-moon/map.js", workerSourcePath: "multiplayer/src/hell-moon-map.ts", width: 4000, height: 2500 }),
});
const MAP_INSTANCE_IDS = new Set([
  "ROCK A", "ROCK B", "ROCK C", "ROCK D", "ROCK E", "ROCK F",
  "SATELLITE RELAY WEST", "SATELLITE RELAY EAST",
  "OUTPOST CANISTER 01", "OUTPOST SUPPLY CRATE 01",
  "OUTPOST WALL CORNER 01", "OUTPOST WALL STRAIGHT 01",
]);

export const COLLISION_ASSET_PATHS = Object.freeze({
  "rock-cluster-01": "games/game-03/maps/lunar-liability/objects/rocks/rock-cluster-01.json",
  "satellite-relay-01": "games/game-03/maps/lunar-liability/objects/satellite/satellite-relay-01.json",
  "satellite-relay-01-left": "games/game-03/maps/lunar-liability/objects/satellite/satellite-relay-01-left.json",
  "outpost-canister-01": "games/game-03/maps/lunar-liability/objects/outpost/outpost-canister-01.json",
  "outpost-supply-crate-01": "games/game-03/maps/lunar-liability/objects/outpost/outpost-supply-crate-01.json",
  "outpost-wall-corner-01": "games/game-03/maps/lunar-liability/objects/outpost/outpost-wall-corner-01.json",
  "outpost-wall-straight-01": "games/game-03/maps/lunar-liability/objects/outpost/outpost-wall-straight-01.json",
});

const MIME_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
});

function jsonResponse(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function localAuthoringOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Authoring request is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function validateCollisionDefinition(assetId, definition, assetPaths = COLLISION_ASSET_PATHS) {
  if (!Object.hasOwn(assetPaths, assetId)) throw new Error("Unknown collision asset.");
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("Definition must be a JSON object.");
  if (definition.id !== assetId) throw new Error("Definition id does not match the selected asset.");
  const points = definition.collision?.points ?? definition.collisionPolygon;
  if (!Array.isArray(points) || points.length < 3 || points.length > 128) throw new Error("Collision polygon must contain 3 to 128 points.");
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < -4 || point.x > 4 || point.y < -4 || point.y > 4) {
      throw new Error("Collision points must use finite normalized coordinates.");
    }
  }
  for (const owner of [definition, definition.collision].filter(Boolean)) {
    for (const property of ["blocksMovement", "blocksProjectiles"]) {
      if (owner[property] !== undefined && typeof owner[property] !== "boolean") throw new Error(`${property} must be true or false.`);
    }
  }
  return definition;
}

async function saveCollisionDefinition(request, response, root) {
  if (!localAuthoringOrigin(request.headers.origin)) {
    jsonResponse(response, 403, { ok: false, error: "Collision authoring is restricted to localhost." });
    return;
  }
  if (request.headers.origin) response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
  let payload;
  try {
    payload = JSON.parse(await requestBody(request));
    const config = authoringMapConfig(payload?.mapId);
    const registry = await discoverAuthoringRegistry(root, config.mapId);
    validateCollisionDefinition(payload?.assetId, payload?.definition, registry.assetPaths);
    payload.relativePath = registry.assetPaths[payload.assetId];
  } catch (error) {
    jsonResponse(response, error.statusCode || 400, { ok: false, error: error.message });
    return;
  }
  const relativePath = payload.relativePath;
  const target = resolve(root, relativePath);
  await writeFile(target, `${JSON.stringify(payload.definition, null, 2)}\n`, "utf8");
  jsonResponse(response, 200, { ok: true, assetId: payload.assetId, path: relativePath });
}

function rounded(value) {
  return Math.round(value * 10) / 10;
}

function normalizedRotation(value) {
  const normalized = ((value % 360) + 540) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : rounded(normalized);
}

export function validateMapPlacement(placement, instanceIds = MAP_INSTANCE_IDS, world = { width: 3200, height: 2000 }) {
  if (!placement || typeof placement !== "object" || Array.isArray(placement)) throw new Error("Placement must be an object.");
  if (!instanceIds.has(placement.id)) throw new Error("Unknown map instance.");
  if (!Number.isFinite(placement.x) || placement.x < 0 || placement.x > world.width || !Number.isFinite(placement.y) || placement.y < 0 || placement.y > world.height) {
    throw new Error("Map placement must stay inside the Nebula Murderball world.");
  }
  if (!Number.isFinite(placement.rotation)) throw new Error("Map rotation must be finite.");
  return { id: placement.id, x: rounded(placement.x), y: rounded(placement.y), rotation: normalizedRotation(placement.rotation) };
}

function escapedRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function replaceMapPlacementSource(source, candidate, instanceIds = MAP_INSTANCE_IDS, world = { width: 3200, height: 2000 }) {
  const placement = validateMapPlacement(candidate, instanceIds, world);
  const id = escapedRegExp(JSON.stringify(placement.id));
  const linePattern = new RegExp(`^([ \\t]*Object\\.freeze\\(\\{[^\\r\\n]*id:\\s*${id}[^\\r\\n]*\\}\\),?)[ \\t]*$`, "m");
  const match = source.match(linePattern);
  if (!match) {
    const number = "-?\\d+(?:\\.\\d+)?";
    const helperPattern = new RegExp(`^([ \\t]*(?:terrain|lava)\\(\\s*${id}\\s*,\\s*\"[^\"]+\"\\s*,\\s*)(${number})(\\s*,\\s*)(${number})(\\s*,\\s*${number}\\s*,\\s*${number}\\s*,\\s*)(${number})(\\s*\\),?)[ \\t]*$`, "m");
    const helperMatch = source.match(helperPattern);
    if (!helperMatch) throw new Error("Map instance was not found in the canonical map source.");
    const helperReplacement = `${helperMatch[1]}${placement.x}${helperMatch[3]}${placement.y}${helperMatch[5]}${placement.rotation}${helperMatch[7]}`;
    return source.replace(helperPattern, helperReplacement);
  }
  let replacement = match[1]
    .replace(/,\s*x:\s*-?\d+(?:\.\d+)?/, `, x: ${placement.x}`)
    .replace(/,\s*y:\s*-?\d+(?:\.\d+)?/, `, y: ${placement.y}`);
  if (/,\s*rotation:\s*-?\d+(?:\.\d+)?/.test(replacement)) {
    replacement = replacement.replace(/,\s*rotation:\s*-?\d+(?:\.\d+)?/, `, rotation: ${placement.rotation}`);
  } else {
    replacement = replacement.replace(/(,\s*height:\s*-?\d+(?:\.\d+)?)(\s*\}\),?)$/, `$1, rotation: ${placement.rotation}$2`);
  }
  if (!replacement.includes(`x: ${placement.x}`) || !replacement.includes(`y: ${placement.y}`) || !replacement.includes(`rotation: ${placement.rotation}`)) {
    throw new Error("Map placement source could not be updated safely.");
  }
  return source.replace(linePattern, replacement);
}

function discoverInstanceIds(source, includeLunarDefaults = true) {
  const ids = new Set(includeLunarDefaults ? MAP_INSTANCE_IDS : []);
  for (const match of source.matchAll(/Object\.freeze\(\{[^\r\n]*\bid:\s*"([^"]+)"[^\r\n]*\bassetId:/g)) ids.add(match[1]);
  for (const match of source.matchAll(/(?:terrain|lava)\(\s*"([^"]+)"\s*,\s*"[^"]+"/g)) ids.add(match[1]);
  return ids;
}

function authoringMapConfig(mapId = "lunar-liability") {
  const config = AUTHORING_MAPS[mapId];
  if (!config) throw new Error("Unknown authoring map.");
  return { mapId, ...config };
}

async function discoverAuthoringRegistry(root, mapId = "lunar-liability") {
  const config = authoringMapConfig(mapId);
  const assetPaths = mapId === "lunar-liability" ? { ...COLLISION_ASSET_PATHS } : {};
  const mapSource = await readFile(resolve(root, config.mapSourcePath), "utf8");
  const objectUrlPrefix = `/games/game-03/maps/${mapId}/objects/`;
  const urls = [...mapSource.matchAll(/["'](\/games\/game-03\/maps\/[^"']+\.json)["']/g)].map((match) => match[1]).filter((url) => url.startsWith(objectUrlPrefix));
  for (const url of urls) {
    const relativePath = url.slice(1);
    try {
      const definition = JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
      if (typeof definition?.id === "string") assetPaths[definition.id] = relativePath;
    } catch {}
  }
  return { assetPaths, instanceIds: discoverInstanceIds(mapSource, mapId === "lunar-liability"), mapSource, config };
}

function importedAssetId(fileName) {
  const withoutExtension = String(fileName || "").replace(/\.[^.]+$/, "");
  const slug = withoutExtension.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error("The image filename must contain at least one letter or number.");
  return slug.slice(0, 64);
}

function importedDefinitionVariable(assetId) {
  const pascal = assetId.split("-").filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join("");
  return `imported${pascal}Definition`;
}

export function appendImportedMapObject(source, definitionUrl, instance) {
  const urlLine = `  ${JSON.stringify(definitionUrl)},`;
  const withUrl = source.replace(
    /(export const ASSET_DEFINITION_URLS\s*=\s*Object\.freeze\(\[)([\s\S]*?)(\]\);)/,
    (_match, start, body, end) => `${start}${body}${body.endsWith("\n") ? "" : "\n"}${urlLine}\n${end}`,
  );
  if (withUrl === source) throw new Error("Could not add the imported asset URL to map.js.");
  const instanceLine = `  Object.freeze({ id: ${JSON.stringify(instance.id)}, assetId: ${JSON.stringify(instance.assetId)}, kind: "imported", x: ${instance.x}, y: ${instance.y}, width: ${instance.width}, height: ${instance.height}, rotation: 0 }),`;
  const updated = withUrl.replace(
    /(export const ENVIRONMENT_INSTANCES\s*=\s*Object\.freeze\(\[)([\s\S]*?)(\]\);)/,
    (_match, start, body, end) => `${start}${body}${body.endsWith("\n") ? "" : "\n"}${instanceLine}\n${end}`,
  );
  if (updated === withUrl) throw new Error("Could not add the imported object placement to map.js.");
  return updated;
}

export function appendImportedWorkerDefinition(source, variableName, definitionPath, assetId) {
  const importLine = `import ${variableName} from ${JSON.stringify(definitionPath)} with { type: "json" };\n`;
  const importAnchor = 'import { collisionBlocksMovement, collisionBlocksProjectiles, transformNormalizedPolygon }';
  if (!source.includes(importAnchor)) throw new Error("Could not add the imported object definition to dusty-map.ts.");
  let updated = source.replace(importAnchor, importLine + importAnchor);
  updated = updated.replace(
    /(const DEFINITIONS(?:\s*:\s*[^=]+)?\s*=\s*Object\.freeze\(\{)([\s\S]*?)(\}\);)/,
    (_match, start, body, end) => `${start}${body}${body.endsWith("\n") ? "" : "\n"}  [${variableName}.id]: ${variableName},\n${end}`,
  );
  if (!updated.includes(`[${variableName}.id]`)) throw new Error("Could not register the imported object with the multiplayer Worker.");
  const canonicalLine = `    Object.freeze({ definitionId: ${variableName}.id, normalizedPointCount: ${variableName}.collision.points.length, source: ${JSON.stringify(definitionPath.replace(/^\.\.\/\.\.\//, ""))} }),`;
  updated = updated.replace(
    /(definitions:\s*Object\.freeze\(\[[\s\S]*?)(\r?\n\s*\]\),)/,
    `$1\n${canonicalLine}$2`,
  );
  return updated;
}

export function removeMapObject(source, instanceId) {
  const id = escapedRegExp(JSON.stringify(instanceId));
  const explicitPattern = new RegExp(`^[ \\t]*Object\\.freeze\\(\\{[^\\r\\n]*id:\\s*${id}[^\\r\\n]*\\}\\),?[ \\t]*(?:\\r?\\n)?`, "m");
  const explicitMatch = source.match(explicitPattern);
  if (explicitMatch) {
    const assetId = explicitMatch[0].match(/\bassetId:\s*"([^"]+)"/)?.[1];
    if (!assetId) throw new Error("Map object has no asset ID.");
    return {
      source: source.replace(explicitPattern, ""),
      assetId,
      imported: /\bkind:\s*"imported"/.test(explicitMatch[0]),
    };
  }

  const helperPattern = new RegExp(`^[ \\t]*(?:(?:export\\s+)?const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*)?(?:terrain|lava)\\(\\s*${id}\\s*,\\s*"([^"]+)"[^\\r\\n]*\\)[;,]?[ \\t]*(?:\\r?\\n)?`, "m");
  const helperMatch = source.match(helperPattern);
  if (!helperMatch) throw new Error("Map object was not found.");
  let updated = source.replace(helperPattern, "");
  const referenceName = helperMatch[1];
  if (referenceName) {
    const referencePattern = new RegExp(`^[ \\t]*${escapedRegExp(referenceName)},?[ \\t]*(?:\\r?\\n)?`, "m");
    updated = updated.replace(referencePattern, "");
  }
  return { source: updated, assetId: helperMatch[2], imported: false };
}

function mapSourceUsesAsset(source, assetId) {
  const quotedAssetId = escapedRegExp(JSON.stringify(assetId));
  return new RegExp(`(?:\\bassetId:\\s*${quotedAssetId}|(?:terrain|lava)\\(\\s*"[^"\\r\\n]+"\\s*,\\s*${quotedAssetId})`).test(source);
}

export function removeImportedWorkerDefinition(source, variableName) {
  const escapedVariable = escapedRegExp(variableName);
  return source
    .replace(new RegExp(`^import\\s+${escapedVariable}\\s+from[^\\r\\n]+(?:\\r?\\n)?`, "m"), "")
    .replace(new RegExp(`^[ \\t]*\\[${escapedVariable}\\.id\\]:\\s*${escapedVariable},[ \\t]*(?:\\r?\\n)?`, "m"), "")
    .replace(new RegExp(`^[ \\t]*Object\\.freeze\\(\\{[^\\r\\n]*definitionId:\\s*${escapedVariable}\\.id[^\\r\\n]*\\}\\),[ \\t]*(?:\\r?\\n)?`, "m"), "");
}

async function deleteMapObject(request, response, root) {
  if (!localAuthoringOrigin(request.headers.origin)) {
    jsonResponse(response, 403, { ok: false, error: "Map authoring is restricted to localhost." });
    return;
  }
  if (request.headers.origin) response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
  try {
    const payload = JSON.parse(await requestBody(request));
    const config = authoringMapConfig(payload?.mapId);
    const registry = await discoverAuthoringRegistry(root, config.mapId);
    const removed = removeMapObject(registry.mapSource, payload?.instanceId);
    const escapedAssetId = escapedRegExp(JSON.stringify(removed.assetId));
    const hasRemainingInstance = mapSourceUsesAsset(removed.source, removed.assetId);
    let nextMapSource = removed.source;
    let assetRemoved = false;
    let workerPath = null;
    let nextWorkerSource = null;
    let assetDirectory = null;
    const definitionPath = registry.assetPaths[removed.assetId];
    if (removed.imported && !hasRemainingInstance && definitionPath?.includes(`/objects/imported/${removed.assetId}/`)) {
      const definitionUrl = `/${definitionPath.replaceAll("\\", "/")}`;
      const definitionPattern = new RegExp(`^[ \\t]*${escapedRegExp(JSON.stringify(definitionUrl))},?[ \\t]*(?:\\r?\\n)?`, "m");
      nextMapSource = nextMapSource.replace(definitionPattern, "");
      workerPath = resolve(root, config.workerSourcePath);
      nextWorkerSource = removeImportedWorkerDefinition(await readFile(workerPath, "utf8"), importedDefinitionVariable(removed.assetId));
      assetDirectory = resolve(root, dirname(definitionPath));
      assetRemoved = true;
    }
    await writeFile(resolve(root, config.mapSourcePath), nextMapSource, "utf8");
    if (workerPath && nextWorkerSource !== null) await writeFile(workerPath, nextWorkerSource, "utf8");
    if (assetDirectory) await rm(assetDirectory, { recursive: true, force: true });
    jsonResponse(response, 200, { ok: true, instanceId: payload.instanceId, assetId: removed.assetId, assetRemoved, path: config.mapSourcePath });
  } catch (error) {
    jsonResponse(response, error.statusCode || 400, { ok: false, error: error.message });
  }
}

function parseImportedImage(payload) {
  const expectedMime = payload?.mimeType;
  if (expectedMime !== "image/png" && expectedMime !== "image/webp") throw new Error("Only PNG and WebP object images can be imported.");
  const match = String(payload?.dataUrl || "").match(/^data:(image\/(?:png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[1] !== expectedMime) throw new Error("The imported image data is invalid.");
  const bytes = Buffer.from(match[2], "base64");
  const png = expectedMime === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = expectedMime === "image/webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!png && !webp) throw new Error("The uploaded file does not match its image type.");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("Object images must be 8 MB or smaller.");
  return { bytes, extension: expectedMime === "image/png" ? ".png" : ".webp" };
}

async function importMapObject(request, response, root) {
  if (!localAuthoringOrigin(request.headers.origin)) {
    jsonResponse(response, 403, { ok: false, error: "Map authoring is restricted to localhost." });
    return;
  }
  if (request.headers.origin) response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
  try {
    const payload = JSON.parse(await requestBody(request));
    const image = parseImportedImage(payload);
    const naturalWidth = Number(payload.naturalWidth);
    const naturalHeight = Number(payload.naturalHeight);
    if (!Number.isInteger(naturalWidth) || !Number.isInteger(naturalHeight) || naturalWidth < 1 || naturalHeight < 1 || naturalWidth > 8192 || naturalHeight > 8192) {
      throw new Error("Object image dimensions are invalid.");
    }
    const config = authoringMapConfig(payload.mapId);
    const registry = await discoverAuthoringRegistry(root, config.mapId);
    const baseId = importedAssetId(payload.fileName);
    let assetId = baseId;
    for (let suffix = 2; Object.hasOwn(registry.assetPaths, assetId); suffix += 1) assetId = `${baseId}-${suffix}`;
    let instanceNumber = 1;
    let instanceId = `${assetId.toUpperCase()} ${String(instanceNumber).padStart(2, "0")}`;
    while (registry.instanceIds.has(instanceId)) {
      instanceNumber += 1;
      instanceId = `${assetId.toUpperCase()} ${String(instanceNumber).padStart(2, "0")}`;
    }
    const placement = payload.placement || {};
    const width = Math.max(24, Math.min(800, Math.round(Number(placement.width) || 240)));
    const height = Math.max(24, Math.min(800, Math.round(Number(placement.height) || 240)));
    const instance = {
      id: instanceId,
      assetId,
      kind: "imported",
      x: Math.max(0, Math.min(config.width, Math.round(Number(placement.x) || config.width / 2))),
      y: Math.max(0, Math.min(config.height, Math.round(Number(placement.y) || config.height / 2))),
      width,
      height,
      rotation: 0,
    };
    const sprite = `${assetId}${image.extension}`;
    const definition = {
      id: assetId,
      sprite,
      anchor: { x: .5, y: .5 },
      depthSortAnchor: { x: .5, y: .82 },
      collision: {
        coordinateSpace: "normalized-image",
        type: "polygon",
        points: [{ x: .08, y: .08 }, { x: .92, y: .08 }, { x: .92, y: .92 }, { x: .08, y: .92 }],
        blocksMovement: true,
        blocksProjectiles: true,
      },
      gameplay: { destructible: false, walkable: false },
    };
    const directoryPath = `games/game-03/maps/${config.mapId}/objects/imported/${assetId}`;
    const definitionPath = `${directoryPath}/${assetId}.json`;
    const imagePath = `${directoryPath}/${sprite}`;
    const definitionUrl = `/${definitionPath.replaceAll("\\", "/")}`;
    const mapPath = resolve(root, config.mapSourcePath);
    const workerPath = resolve(root, config.workerSourcePath);
    const workerDefinitionPath = `../../${definitionPath.replaceAll("\\", "/")}`;
    const variableName = importedDefinitionVariable(assetId);
    const nextMapSource = appendImportedMapObject(registry.mapSource, definitionUrl, instance);
    const workerSource = await readFile(workerPath, "utf8");
    const nextWorkerSource = appendImportedWorkerDefinition(workerSource, variableName, workerDefinitionPath, assetId);
    await mkdir(resolve(root, directoryPath), { recursive: true });
    await writeFile(resolve(root, imagePath), image.bytes);
    await writeFile(resolve(root, definitionPath), `${JSON.stringify(definition, null, 2)}\n`, "utf8");
    await writeFile(mapPath, nextMapSource, "utf8");
    await writeFile(workerPath, nextWorkerSource, "utf8");
    jsonResponse(response, 201, { ok: true, definition, instance, definitionPath, imagePath, imageUrl: `/${imagePath.replaceAll("\\", "/")}` });
  } catch (error) {
    jsonResponse(response, error.statusCode || 400, { ok: false, error: error.message });
  }
}

async function saveMapPlacement(request, response, root) {
  if (!localAuthoringOrigin(request.headers.origin)) {
    jsonResponse(response, 403, { ok: false, error: "Map authoring is restricted to localhost." });
    return;
  }
  if (request.headers.origin) response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
  let placement;
  let target;
  let source;
  let instanceIds;
  let config;
  try {
    const payload = JSON.parse(await requestBody(request));
    config = authoringMapConfig(payload?.mapId);
    target = resolve(root, config.mapSourcePath);
    source = await readFile(target, "utf8");
    instanceIds = discoverInstanceIds(source, config.mapId === "lunar-liability");
    placement = validateMapPlacement(payload?.placement, instanceIds, config);
  } catch (error) {
    jsonResponse(response, error.statusCode || 400, { ok: false, error: error.message });
    return;
  }
  await writeFile(target, replaceMapPlacementSource(source, placement, instanceIds, config), "utf8");
  jsonResponse(response, 200, { ok: true, instanceId: placement.id, path: config.mapSourcePath, placement });
}

async function authoringHealth(request, response, root) {
  if (!localAuthoringOrigin(request.headers.origin)) {
    jsonResponse(response, 403, { ok: false, error: "Collision authoring is restricted to localhost." });
    return;
  }
  if (request.headers.origin) response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
  const registries = (await Promise.all(Object.keys(AUTHORING_MAPS).map(async (mapId) => {
    try { return await discoverAuthoringRegistry(root, mapId); } catch { return null; }
  }))).filter(Boolean);
  jsonResponse(response, 200, {
    ok: true,
    service: "dusty-collision-authoring",
    apiVersion: AUTHORING_API_VERSION,
    writableAssets: registries.flatMap((registry) => Object.keys(registry.assetPaths)),
    writableMap: MAP_SOURCE_PATH,
    writableMaps: Object.values(AUTHORING_MAPS).map((config) => config.mapSourcePath),
    objectImport: true,
    objectDelete: true,
  });
}

function safeStaticPath(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const target = resolve(root, `.${decoded}`);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) return null;
  return target;
}

async function serveStatic(request, response, root, pathname) {
  let target = safeStaticPath(root, pathname);
  if (!target) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    let details = await stat(target);
    if (details.isDirectory()) {
      target = resolve(target, "index.html");
      details = await stat(target);
    }
    if (!details.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": details.size,
      "Content-Type": MIME_TYPES[extname(target).toLowerCase()] || "application/octet-stream",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}

export function createDustyDevServer({ root = REPOSITORY_ROOT, logger = console } = {}) {
  const resolvedRoot = resolve(root);
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/__dusty-orbit/authoring-health") {
        await authoringHealth(request, response, resolvedRoot);
        return;
      }
      if (request.method === "POST" && url.pathname === "/__dusty-orbit/import-object") {
        await importMapObject(request, response, resolvedRoot);
        return;
      }
      if (request.method === "POST" && url.pathname === "/__dusty-orbit/delete-object") {
        await deleteMapObject(request, response, resolvedRoot);
        return;
      }
      if (request.method === "POST" && url.pathname === "/__dusty-orbit/save-collision") {
        await saveCollisionDefinition(request, response, resolvedRoot);
        return;
      }
      if (request.method === "POST" && url.pathname === "/__dusty-orbit/save-placement") {
        await saveMapPlacement(request, response, resolvedRoot);
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD, POST" }).end("Method not allowed");
        return;
      }
      await serveStatic(request, response, resolvedRoot, url.pathname);
    } catch (error) {
      logger.error(error);
      if (!response.headersSent) jsonResponse(response, 500, { ok: false, error: "Local authoring server error." });
      else response.destroy();
    }
  });
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const host = "127.0.0.1";
  const port = 8081;
  const server = createDustyDevServer();
  server.listen(port, host, () => {
    console.log(`Nebula Murderball map authoring helper: http://localhost:${port}`);
    console.log("Import and save write object art, collision JSON, and placement directly to the canonical repository files.");
  });
}
