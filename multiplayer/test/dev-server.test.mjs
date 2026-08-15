import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { COLLISION_ASSET_PATHS, appendImportedMapObject, appendImportedWorkerDefinition, createDustyDevServer, removeMapObject, replaceMapPlacementSource, validateMapPlacement } from "../../tools/dusty-dev-server.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("local authoring server saves canonical collision and map placement code", async () => {
  const root = await mkdtemp(join(tmpdir(), "dusty-authoring-"));
  const relativePath = COLLISION_ASSET_PATHS["satellite-relay-01-left"];
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, "{}\n", "utf8");
  const mapPath = join(root, "games/game-03/maps/lunar-liability/map.js");
  await mkdir(dirname(mapPath), { recursive: true });
  const mapSource = 'export const ROCK_INSTANCES = Object.freeze([\n  Object.freeze({ id: "ROCK A", assetId: "rock-cluster-01", x: 650, y: 450, width: 240, height: 240 }),\n]);\n';
  await writeFile(mapPath, mapSource, "utf8");
  await writeFile(join(root, "index.html"), "<!doctype html><title>Dusty QA</title>", "utf8");
  const server = createDustyDevServer({ root, logger: { error() {} } });
  const port = await listen(server);
  try {
    const health = await fetch(`http://127.0.0.1:${port}/__dusty-orbit/authoring-health`, {
      headers: { Origin: `http://localhost:${port}` },
    });
    assert.equal(health.status, 200);
    const healthResult = await health.json();
    assert.equal(healthResult.service, "dusty-collision-authoring");
    assert.equal(healthResult.apiVersion, 3);

    const definition = {
      id: "satellite-relay-01-left",
      anchor: { x: .5, y: .5 },
      blocksMovement: true,
      blocksProjectiles: false,
      collisionPolygon: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .5, y: .8 }],
    };
    const response = await fetch(`http://127.0.0.1:${port}/__dusty-orbit/save-collision`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: `http://localhost:${port}` },
      body: JSON.stringify({ assetId: definition.id, definition }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), `http://localhost:${port}`);
    assert.deepEqual(await response.json(), { ok: true, assetId: definition.id, path: relativePath });
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), definition);

    const invalidBehavior = await fetch(`http://127.0.0.1:${port}/__dusty-orbit/save-collision`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: `http://localhost:${port}` },
      body: JSON.stringify({ assetId: definition.id, definition: { ...definition, blocksProjectiles: "sometimes" } }),
    });
    assert.equal(invalidBehavior.status, 400);
    assert.match((await invalidBehavior.json()).error, /blocksProjectiles must be true or false/);

    const placementResponse = await fetch(`http://127.0.0.1:${port}/__dusty-orbit/save-placement`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: `http://localhost:${port}` },
      body: JSON.stringify({ placement: { id: "ROCK A", x: 712.34, y: 488.76, rotation: 405 } }),
    });
    assert.equal(placementResponse.status, 200);
    const placementResult = await placementResponse.json();
    assert.deepEqual(placementResult.placement, { id: "ROCK A", x: 712.3, y: 488.8, rotation: 45 });
    assert.match(await readFile(mapPath, "utf8"), /id: "ROCK A".*x: 712\.3, y: 488\.8.*rotation: 45/);

    const rejected = await fetch(`http://127.0.0.1:${port}/__dusty-orbit/save-collision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://example.com" },
      body: JSON.stringify({ assetId: definition.id, definition }),
    });
    assert.equal(rejected.status, 403);

    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Dusty QA/);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("map placement serialization is bounded and only rewrites the selected instance", () => {
  assert.deepEqual(validateMapPlacement({ id: "ROCK B", x: 100, y: 200, rotation: -540 }), { id: "ROCK B", x: 100, y: 200, rotation: -180 });
  assert.throws(() => validateMapPlacement({ id: "UNKNOWN", x: 100, y: 200, rotation: 0 }), /Unknown map instance/);
  const source = [
    '  Object.freeze({ id: "ROCK A", assetId: "rock-cluster-01", x: 650, y: 450, width: 240, height: 240 }),',
    '  Object.freeze({ id: "ROCK B", assetId: "rock-cluster-01", x: 1350, y: 420, width: 320, height: 320, rotation: 5 }),',
  ].join("\n");
  const updated = replaceMapPlacementSource(source, { id: "ROCK B", x: 1400, y: 500, rotation: 25 });
  assert.match(updated, /ROCK A.*x: 650, y: 450/);
  assert.match(updated, /ROCK B.*x: 1400, y: 500.*rotation: 25/);

  const helperSource = '  lava("NW FAULT 02", "lava1-1", 1390, 810, 540, 235, 38),';
  const helperUpdated = replaceMapPlacementSource(
    helperSource,
    { id: "NW FAULT 02", x: 1425.25, y: 830.75, rotation: 401 },
    new Set(["NW FAULT 02"]),
    { width: 4000, height: 2500 },
  );
  assert.equal(helperUpdated, '  lava("NW FAULT 02", "lava1-1", 1425.3, 830.8, 540, 235, 41),');
});

test("outpost definitions and placements are writable in debug authoring mode", () => {
  assert.equal(COLLISION_ASSET_PATHS["outpost-wall-straight-01"], "games/game-03/maps/lunar-liability/objects/outpost/outpost-wall-straight-01.json");
  assert.deepEqual(
    validateMapPlacement({ id: "OUTPOST SUPPLY CRATE 01", x: 1600, y: 1000, rotation: 12.25 }),
    { id: "OUTPOST SUPPLY CRATE 01", x: 1600, y: 1000, rotation: 12.3 },
  );
});

test("imported object source registration adds its asset, placement, and Worker definition", () => {
  const mapSource = [
    "export const ASSET_DEFINITION_URLS = Object.freeze([",
    '  "/games/game-03/maps/lunar-liability/objects/rocks/rock.json",',
    "]);",
    "export const ENVIRONMENT_INSTANCES = Object.freeze([",
    "  ...ROCK_INSTANCES,",
    "]);",
  ].join("\n");
  const instance = { id: "MOON BOX 01", assetId: "moon-box", x: 400, y: 500, width: 120, height: 80 };
  const updatedMap = appendImportedMapObject(mapSource, "/games/game-03/maps/lunar-liability/objects/imported/moon-box/moon-box.json", instance);
  assert.match(updatedMap, /moon-box\/moon-box\.json/);
  assert.match(updatedMap, /id: "MOON BOX 01".*kind: "imported".*width: 120, height: 80/);

  const workerSource = [
    'import rockDefinition from "../../rock.json" with { type: "json" };',
    'import { collisionBlocksMovement, collisionBlocksProjectiles, transformNormalizedPolygon } from "../../collision-geometry.js";',
    "const DEFINITIONS = Object.freeze({",
    "  [rockDefinition.id]: rockDefinition,",
    "});",
    "const collision = { definitions: Object.freeze([",
    '    Object.freeze({ definitionId: rockDefinition.id, normalizedPointCount: 3, source: "rock.json" }),',
    "  ]), };",
  ].join("\n");
  const updatedWorker = appendImportedWorkerDefinition(workerSource, "importedMoonBoxDefinition", "../../objects/imported/moon-box/moon-box.json", "moon-box");
  assert.match(updatedWorker, /import importedMoonBoxDefinition/);
  assert.match(updatedWorker, /\[importedMoonBoxDefinition\.id\]: importedMoonBoxDefinition/);
  assert.match(updatedWorker, /normalizedPointCount: importedMoonBoxDefinition\.collision\.points\.length/);
});

test("map object deletion supports generated terrain and removes only the selected placement", () => {
  const source = [
    '  lava("NW FAULT 01", "lava1-1", 1280, 720, 540, 235, 38),',
    '  lava("NW FAULT 02", "lava1-1", 1390, 810, 540, 235, 38),',
    'export const CENTER_ARENA_INSTANCE = terrain("CENTER RING", "center-ring", 2000, 1250, 820, 820, 0);',
    '  CENTER_ARENA_INSTANCE,',
    '  Object.freeze({ id: "MOON BOX 01", assetId: "moon-box", kind: "imported", x: 400, y: 500, width: 120, height: 80 }),',
  ].join("\n");

  const terrainRemoved = removeMapObject(source, "NW FAULT 02");
  assert.equal(terrainRemoved.assetId, "lava1-1");
  assert.equal(terrainRemoved.imported, false);
  assert.match(terrainRemoved.source, /NW FAULT 01/);
  assert.doesNotMatch(terrainRemoved.source, /NW FAULT 02/);

  const centerRemoved = removeMapObject(source, "CENTER RING");
  assert.equal(centerRemoved.assetId, "center-ring");
  assert.doesNotMatch(centerRemoved.source, /CENTER_ARENA_INSTANCE|CENTER RING/);

  const importedRemoved = removeMapObject(source, "MOON BOX 01");
  assert.equal(importedRemoved.assetId, "moon-box");
  assert.equal(importedRemoved.imported, true);
  assert.doesNotMatch(importedRemoved.source, /MOON BOX 01/);
});

test("the live Hell Moon Worker exposes a first-import-compatible definition registry", async () => {
  const workerSource = await readFile(new URL("../src/hell-moon-map.ts", import.meta.url), "utf8");
  assert.match(workerSource, /const DEFINITIONS\s*=\s*Object\.freeze\(\{/);
  assert.match(workerSource, /\[centerArenaDefinition\.id\]: centerArenaDefinition/);
  const updated = appendImportedWorkerDefinition(workerSource, "importedProbeDefinition", "../../objects/imported/probe/probe.json", "probe");
  assert.match(updated, /\[importedProbeDefinition\.id\]: importedProbeDefinition/);
  assert.match(updated, /definitionId: importedProbeDefinition\.id/);
});

test("local authoring server imports a Hell Moon image with an immediately writable collision map", async () => {
  const root = await mkdtemp(join(tmpdir(), "dusty-import-"));
  const mapPath = join(root, "games/game-03/maps/hell-moon/map.js");
  const workerPath = join(root, "multiplayer/src/hell-moon-map.ts");
  await mkdir(dirname(mapPath), { recursive: true });
  await mkdir(dirname(workerPath), { recursive: true });
  await writeFile(mapPath, await readFile(new URL("../../games/game-03/maps/hell-moon/map.js", import.meta.url), "utf8"), "utf8");
  await writeFile(workerPath, await readFile(new URL("../src/hell-moon-map.ts", import.meta.url), "utf8"), "utf8");
  const server = createDustyDevServer({ root, logger: { error() {} } });
  const port = await listen(server);
  try {
    const generatedDelete = await fetch(`http://127.0.0.1:${port}/__dusty-orbit/delete-object`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: `http://localhost:${port}` },
      body: JSON.stringify({ mapId: "hell-moon", instanceId: "NW FAULT 03" }),
    });
    const generatedDeleteResult = await generatedDelete.json();
    assert.equal(generatedDelete.status, 200, generatedDeleteResult.error);
    assert.equal(generatedDeleteResult.assetRemoved, false);
    assert.doesNotMatch(await readFile(mapPath, "utf8"), /NW FAULT 03/);
    assert.match(await readFile(mapPath, "utf8"), /NW FAULT EDGE/);
    assert.match(await readFile(workerPath, "utf8"), /importedLava12Definition/);

    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    const imported = await fetch(`http://127.0.0.1:${port}/__dusty-orbit/import-object`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: `http://localhost:${port}` },
      body: JSON.stringify({
        mapId: "hell-moon",
        fileName: "Moon Box.png",
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${pngBytes.toString("base64")}`,
        naturalWidth: 300,
        naturalHeight: 200,
        placement: { x: 900, y: 700, width: 300, height: 200 },
      }),
    });
    const result = await imported.json();
    assert.equal(imported.status, 201, result.error);
    assert.equal(result.definition.id, "moon-box");
    assert.match(result.definitionPath, /maps\/hell-moon\/objects\/imported/);
    assert.equal(result.definition.collision.points.length, 4);
    assert.equal(result.instance.id, "MOON-BOX 01");
    assert.match(await readFile(mapPath, "utf8"), /MOON-BOX 01/);
    assert.match(await readFile(workerPath, "utf8"), /importedMoonBoxDefinition/);
    assert.deepEqual(JSON.parse(await readFile(join(root, result.definitionPath), "utf8")), result.definition);

    result.definition.collision.points[0] = { x: .2, y: .25 };
    const collisionSave = await fetch(`http://127.0.0.1:${port}/__dusty-orbit/save-collision`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: `http://localhost:${port}` },
      body: JSON.stringify({ mapId: "hell-moon", assetId: result.definition.id, definition: result.definition }),
    });
    assert.equal(collisionSave.status, 200);
    assert.deepEqual(JSON.parse(await readFile(join(root, result.definitionPath), "utf8")).collision.points[0], { x: .2, y: .25 });

    const deleted = await fetch(`http://127.0.0.1:${port}/__dusty-orbit/delete-object`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: `http://localhost:${port}` },
      body: JSON.stringify({ mapId: "hell-moon", instanceId: result.instance.id }),
    });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).assetRemoved, true);
    assert.doesNotMatch(await readFile(mapPath, "utf8"), /MOON-BOX 01|moon-box\/moon-box\.json/);
    assert.doesNotMatch(await readFile(workerPath, "utf8"), /importedMoonBoxDefinition/);
    await assert.rejects(readFile(join(root, result.definitionPath), "utf8"), /ENOENT/);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});
