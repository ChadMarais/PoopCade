import assert from "node:assert/strict";
import test from "node:test";
import { DustyOrbitMultiplayerRenderer, renderScaleForViewport } from "../../games/game-03/renderer.js";

test("large high-DPI viewports stay inside the Murderball render-pixel budget", () => {
  assert.equal(renderScaleForViewport(1366, 768, 2), 1);
  assert.equal(renderScaleForViewport(1920, 1080, 2), 1);
  assert.equal(renderScaleForViewport(3840, 2160, 2), .65);
  assert.equal(renderScaleForViewport(1280, 720, 2, .7), .7);
});

test("static scenery draws only the chunks intersecting the viewport", () => {
  const calls = [];
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.assets = { world: { width: 4000, height: 2500 } };
  renderer.camera = { x: 125.5, y: 240.25 };
  renderer.viewport = { width: 1280, height: 720, dpr: 1 };
  renderer.ctx = { drawImage: (...args) => calls.push(args) };
  renderer.getStaticWorldChunk = (column, row) => ({
    surface: { width: 384, height: 384 },
    worldX: column * 512,
    worldY: row * 512,
    width: 512,
    height: 512,
  });

  renderer.drawStaticWorld();

  assert.equal(calls.length, 6);
  assert.deepEqual(calls[0].slice(-4), [-125.5, -240.25, 512, 512]);
});

test("adaptive quality lowers resolution only after sustained slow frames", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.renderQuality = 1;
  renderer.frameTimeEma = 25;
  renderer.lastQualityChange = 0;
  let resizes = 0;
  renderer.resize = () => { resizes += 1; };

  renderer.updateAdaptiveQuality(.025, 2000);

  assert.equal(renderer.renderQuality, .9);
  assert.equal(resizes, 1);
});

test("fart clouds use cached sprites instead of rebuilding gradients every frame", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../../games/game-03/renderer.js", import.meta.url), "utf8"));
  const method = source.slice(source.indexOf("  drawFartClouds("), source.indexOf("  collectNukeWarnings("));
  assert.match(method, /ctx\.drawImage\(sprite/);
  assert.doesNotMatch(method, /createRadialGradient/);
});
