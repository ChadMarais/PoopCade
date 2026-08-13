import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { COLLISION_ASSET_PATHS, createDustyDevServer, replaceMapPlacementSource, validateMapPlacement } from "../../tools/dusty-dev-server.mjs";

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
  const mapPath = join(root, "games/game-03/map.js");
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
    assert.equal((await health.json()).service, "dusty-collision-authoring");

    const definition = {
      id: "satellite-relay-01-left",
      anchor: { x: .5, y: .5 },
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
});

test("outpost definitions and placements are writable in debug authoring mode", () => {
  assert.equal(COLLISION_ASSET_PATHS["outpost-wall-straight-01"], "games/game-03/assets/dusty-orbit/outpost/outpost-wall-straight-01.json");
  assert.deepEqual(
    validateMapPlacement({ id: "OUTPOST SUPPLY CRATE 01", x: 1600, y: 1000, rotation: 12.25 }),
    { id: "OUTPOST SUPPLY CRATE 01", x: 1600, y: 1000, rotation: 12.3 },
  );
});
