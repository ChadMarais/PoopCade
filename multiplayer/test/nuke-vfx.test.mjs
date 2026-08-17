import assert from "node:assert/strict";
import test from "node:test";
import {
  NUKE_EFFECT_DURATION_MS,
  createNukeBurst,
  nukeTimeline,
  nukeWarningTimeline,
} from "../../games/game-03/nuke-vfx.js";
import { DustyOrbitMultiplayerRenderer } from "../../games/game-03/renderer.js";

test("nuke timeline reaches the authoritative radius and fully decays in 1.5 seconds", () => {
  const ignition = nukeTimeline(50);
  const peak = nukeTimeline(300);
  const radiusReached = nukeTimeline(750);
  const complete = nukeTimeline(NUKE_EFFECT_DURATION_MS);
  assert.ok(ignition.ignitionAlpha > .5);
  assert.ok(peak.coreAlpha > .5);
  assert.equal(radiusReached.shockwaveProgress, 1);
  assert.ok(radiusReached.shockwaveAlpha > 0, "the ring remains visible when it reaches the gameplay radius");
  assert.equal(complete.amount, 1);
  assert.equal(complete.plasmaAlpha, 0);
  assert.equal(complete.decayAlpha, 0);
  assert.equal(NUKE_EFFECT_DURATION_MS, 1500);
});

test("warning progress is driven by authoritative server timestamps", () => {
  assert.deepEqual(nukeWarningTimeline(10_000, 11_000, 10_000), { amount: 0, remainingMs: 1000, finalCharge: 0 });
  const late = nukeWarningTimeline(10_000, 11_000, 10_900);
  assert.equal(late.amount, .9);
  assert.equal(late.remainingMs, 100);
  assert.ok(late.finalCharge > .5);
});

test("procedural burst is deterministic, capped, and scaled from the event radius", () => {
  const first = createNukeBurst(42, 700, 64, 12);
  const second = createNukeBurst(42, 700, 64, 12);
  assert.deepEqual(first, second);
  assert.equal(first.particles.length, 64);
  assert.equal(first.shards.length, 12);
  assert.equal(first.lobes.length, 9);
  assert.ok(first.particles.every((particle) => particle.distance <= 700));
  assert.ok(first.shards.every((shard) => shard.distance <= 700));
  assert.deepEqual(new Set(first.particles.map((particle) => particle.type)), new Set([
    "cyan-spark", "violet-fragment", "white-streak", "magenta-fragment",
  ]));
});

test("renderer spawns one independent blast from the authoritative detonation event", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.effects = [];
  renderer.nukeWarnings = new Map([[9, { id: 9 }]]);
  renderer.detonatedNukeIds = new Map();
  renderer.renderedPlayers = new Map();
  renderer.viewport = { width: 1280, height: 720 };
  renderer.reducedMotion = false;
  renderer.canvas = {};
  const event = { id: 9, ownerId: "owner", x: 320, y: 480, radius: 700, victims: [] };
  renderer.nukeDetonated(event);
  renderer.nukeDetonated(event);
  const blasts = renderer.effects.filter((effect) => effect.type === "nuke-blast");
  assert.equal(blasts.length, 1, "duplicate delivery must not duplicate the visual");
  assert.equal(blasts[0].x, event.x);
  assert.equal(blasts[0].y, event.y);
  assert.equal(blasts[0].radius, event.radius);
  assert.equal(blasts[0].life, NUKE_EFFECT_DURATION_MS);
  assert.equal(blasts[0].particles.length, 32);
  assert.equal(blasts[0].shards.length, 6);
  assert.equal(renderer.nukeWarnings.has(event.id), false);
});

test("reduced motion disables camera shake", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.reducedMotion = true;
  renderer.effects = [{ type: "nuke-blast", born: performance.now(), seed: 2, life: NUKE_EFFECT_DURATION_MS }];
  renderer.viewport = { width: 1280, height: 720 };
  assert.deepEqual(renderer.getNukeScreenShake(), { x: 0, y: 0 });
});
