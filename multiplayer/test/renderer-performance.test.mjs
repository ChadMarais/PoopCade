import assert from "node:assert/strict";
import test from "node:test";
import { DustyOrbitMultiplayerRenderer, cameraScaleForViewport, nextEffectsQuality, renderScaleForViewport } from "../../games/game-03/renderer.js";

test("normal phones see more arena while tablets and foldables retain their framing", () => {
  assert.equal(cameraScaleForViewport(390, 844, true), .86);
  assert.equal(cameraScaleForViewport(844, 390, true), .86);
  assert.equal(cameraScaleForViewport(768, 1024, true), 1);
  assert.equal(cameraScaleForViewport(884, 1104, true), 1);
  assert.equal(cameraScaleForViewport(390, 844, false), 1);
});

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

test("adaptive effects simplify before render resolution drops and recover conservatively", () => {
  assert.equal(nextEffectsQuality(1, 18, 700), .7);
  assert.equal(nextEffectsQuality(.7, 18, 700), .4);
  assert.equal(nextEffectsQuality(.4, 14, 4600), .7);
  assert.equal(nextEffectsQuality(.7, 14, 4600), 1);
  assert.equal(nextEffectsQuality(1, 30, 500), 1, "a brief hitch must not degrade effects");
});

test("offscreen circles and projectile trails are rejected before canvas drawing", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.camera = { x: 1000, y: 500 };
  renderer.viewport = { width: 800, height: 600 };
  assert.equal(renderer.isWorldCircleVisible(1200, 700, 20), true);
  assert.equal(renderer.isWorldCircleVisible(100, 100, 20), false);
  assert.equal(renderer.isWorldSegmentVisible(900, 700, 1100, 700), true, "a trail crossing the viewport edge stays visible");
  assert.equal(renderer.isWorldSegmentVisible(100, 100, 200, 200), false);
});

test("effects are pruned and classified once per render frame", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.effects = [
    { type: "nuke-blast", born: 900, life: 200 },
    { type: "weapon-muzzle", born: 950, life: 100 },
    { type: "death", born: 950, life: 500 },
    { type: "expired", born: 0, life: 10 },
  ];
  renderer.prepareEffectFrame(1000);
  assert.equal(renderer.effects.length, 3);
  assert.deepEqual(renderer.effectPasses.underlay.map((effect) => effect.type), ["nuke-blast"]);
  assert.deepEqual(renderer.effectPasses.foreground.map((effect) => effect.type), ["nuke-blast", "death"]);
});

test("render hot paths apply viewport culling before expensive drawing", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../../games/game-03/renderer.js", import.meta.url), "utf8"));
  const render = source.slice(source.indexOf("  render("), source.indexOf("  drawTerrain("));
  const projectiles = source.slice(source.indexOf("  drawProjectiles("), source.indexOf("  drawLocalProjectiles("));
  assert.match(render, /visibleEnvironment/);
  assert.match(render, /visiblePickups/);
  assert.match(render, /visiblePlayers/);
  assert.ok(projectiles.indexOf("isWorldSegmentVisible") < projectiles.indexOf("ctx.save()"));
});

test("fart clouds use cached sprites instead of rebuilding gradients every frame", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../../games/game-03/renderer.js", import.meta.url), "utf8"));
  const method = source.slice(source.indexOf("  drawFartClouds("), source.indexOf("  collectNukeWarnings("));
  assert.match(method, /ctx\.drawImage\(sprite/);
  assert.doesNotMatch(method, /createRadialGradient/);
});
