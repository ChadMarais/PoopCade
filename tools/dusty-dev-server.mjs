import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BODY_BYTES = 256 * 1024;
const MAP_SOURCE_PATH = "games/game-03/map.js";
const MAP_INSTANCE_IDS = new Set([
  "ROCK A", "ROCK B", "ROCK C", "ROCK D", "ROCK E", "ROCK F",
  "SATELLITE RELAY WEST", "SATELLITE RELAY EAST",
  "OUTPOST CANISTER 01", "OUTPOST SUPPLY CRATE 01",
  "OUTPOST WALL CORNER 01", "OUTPOST WALL STRAIGHT 01",
]);

export const COLLISION_ASSET_PATHS = Object.freeze({
  "rock-cluster-01": "games/game-03/assets/dusty-orbit/rocks/rock-cluster-01.json",
  "satellite-relay-01": "games/game-03/assets/dusty-orbit/satellite/satellite-relay-01.json",
  "satellite-relay-01-left": "games/game-03/assets/dusty-orbit/satellite/satellite-relay-01-left.json",
  "outpost-canister-01": "games/game-03/assets/dusty-orbit/outpost/outpost-canister-01.json",
  "outpost-supply-crate-01": "games/game-03/assets/dusty-orbit/outpost/outpost-supply-crate-01.json",
  "outpost-wall-corner-01": "games/game-03/assets/dusty-orbit/outpost/outpost-wall-corner-01.json",
  "outpost-wall-straight-01": "games/game-03/assets/dusty-orbit/outpost/outpost-wall-straight-01.json",
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
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Collision definition is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function validateCollisionDefinition(assetId, definition) {
  if (!Object.hasOwn(COLLISION_ASSET_PATHS, assetId)) throw new Error("Unknown collision asset.");
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("Definition must be a JSON object.");
  if (definition.id !== assetId) throw new Error("Definition id does not match the selected asset.");
  const points = assetId === "rock-cluster-01" ? definition.collision?.points : definition.collisionPolygon;
  if (!Array.isArray(points) || points.length < 3 || points.length > 128) throw new Error("Collision polygon must contain 3 to 128 points.");
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < -4 || point.x > 4 || point.y < -4 || point.y > 4) {
      throw new Error("Collision points must use finite normalized coordinates.");
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
    validateCollisionDefinition(payload?.assetId, payload?.definition);
  } catch (error) {
    jsonResponse(response, error.statusCode || 400, { ok: false, error: error.message });
    return;
  }
  const relativePath = COLLISION_ASSET_PATHS[payload.assetId];
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

export function validateMapPlacement(placement) {
  if (!placement || typeof placement !== "object" || Array.isArray(placement)) throw new Error("Placement must be an object.");
  if (!MAP_INSTANCE_IDS.has(placement.id)) throw new Error("Unknown map instance.");
  if (!Number.isFinite(placement.x) || placement.x < 0 || placement.x > 3200 || !Number.isFinite(placement.y) || placement.y < 0 || placement.y > 2000) {
    throw new Error("Map placement must stay inside the Dusty Orbit world.");
  }
  if (!Number.isFinite(placement.rotation)) throw new Error("Map rotation must be finite.");
  return { id: placement.id, x: rounded(placement.x), y: rounded(placement.y), rotation: normalizedRotation(placement.rotation) };
}

function escapedRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function replaceMapPlacementSource(source, candidate) {
  const placement = validateMapPlacement(candidate);
  const id = escapedRegExp(JSON.stringify(placement.id));
  const linePattern = new RegExp(`^([ \\t]*Object\\.freeze\\(\\{[^\\r\\n]*id:\\s*${id}[^\\r\\n]*\\}\\),?)[ \\t]*$`, "m");
  const match = source.match(linePattern);
  if (!match) throw new Error("Map instance was not found in the canonical map source.");
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

async function saveMapPlacement(request, response, root) {
  if (!localAuthoringOrigin(request.headers.origin)) {
    jsonResponse(response, 403, { ok: false, error: "Map authoring is restricted to localhost." });
    return;
  }
  if (request.headers.origin) response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
  let placement;
  try {
    const payload = JSON.parse(await requestBody(request));
    placement = validateMapPlacement(payload?.placement);
  } catch (error) {
    jsonResponse(response, error.statusCode || 400, { ok: false, error: error.message });
    return;
  }
  const target = resolve(root, MAP_SOURCE_PATH);
  const source = await readFile(target, "utf8");
  await writeFile(target, replaceMapPlacementSource(source, placement), "utf8");
  jsonResponse(response, 200, { ok: true, instanceId: placement.id, path: MAP_SOURCE_PATH, placement });
}

function authoringHealth(request, response) {
  if (!localAuthoringOrigin(request.headers.origin)) {
    jsonResponse(response, 403, { ok: false, error: "Collision authoring is restricted to localhost." });
    return;
  }
  if (request.headers.origin) response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
  jsonResponse(response, 200, { ok: true, service: "dusty-collision-authoring", writableAssets: Object.keys(COLLISION_ASSET_PATHS), writableMap: MAP_SOURCE_PATH });
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
        authoringHealth(request, response);
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
    console.log(`Dusty Orbit map authoring helper: http://localhost:${port}`);
    console.log("Save writes collision JSON or instance placement directly to the canonical repository files.");
  });
}
