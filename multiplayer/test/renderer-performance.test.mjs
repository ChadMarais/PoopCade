import assert from "node:assert/strict";
import test from "node:test";
import { DustyOrbitMultiplayerRenderer, renderScaleForViewport } from "../../games/game-03/renderer.js";

test("large high-DPI viewports stay inside the Murderball render-pixel budget", () => {
  assert.equal(renderScaleForViewport(1366, 768, 2), 2);
  assert.ok(renderScaleForViewport(1920, 1080, 2) < 1.5);
  assert.equal(renderScaleForViewport(3840, 2160, 2), .75);
});

test("cached static scenery renders as one viewport copy per frame", () => {
  const calls = [];
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.assets = { world: { width: 4000, height: 2500 } };
  renderer.camera = { x: 125.5, y: 240.25 };
  renderer.viewport = { width: 1280, height: 720, dpr: 1 };
  renderer.staticWorldSurface = { cached: true };
  renderer.ctx = { drawImage: (...args) => calls.push(args) };
  renderer.drawTerrain = () => assert.fail("terrain should not be rebuilt");
  renderer.drawBoundaryOverlay = () => assert.fail("boundary should not be rebuilt");
  renderer.drawTerrainFeatures = () => assert.fail("terrain features should not be rebuilt");

  renderer.drawStaticWorld();

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(1), [125.5, 240.25, 1280, 720, 0, 0, 1280, 720]);
});

test("static scenery keeps the existing drawing fallback when caching is unavailable", () => {
  const calls = [];
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.staticWorldSurface = null;
  renderer.drawTerrain = () => calls.push("terrain");
  renderer.drawBoundaryOverlay = () => calls.push("boundary");
  renderer.drawTerrainFeatures = () => calls.push("features");

  renderer.drawStaticWorld();

  assert.deepEqual(calls, ["terrain", "boundary", "features"]);
});
