import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { COLLISION_ASSET_PATHS, createDustyDevServer } from "../../tools/dusty-dev-server.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("local authoring server saves only canonical collision JSON definitions", async () => {
  const root = await mkdtemp(join(tmpdir(), "dusty-authoring-"));
  const relativePath = COLLISION_ASSET_PATHS["satellite-relay-01-left"];
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, "{}\n", "utf8");
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
