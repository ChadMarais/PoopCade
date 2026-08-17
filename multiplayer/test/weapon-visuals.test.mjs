import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DustyOrbitMultiplayerRenderer, snapshotRenderTime } from "../../games/game-03/renderer.js";
import { SHOULDER_SIDE_OFFSET, WEAPON_VISUALS, weaponPose, weaponVisualForTier } from "../../games/game-03/weapon-visuals.js";

function close(actual, expected, tolerance = .001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

const SMG = Object.freeze({ tier: 4, name: "SMG", cooldownMs: 220, speed: 700, lifetimeMs: 900, radius: 3, count: 1, spreadDegrees: [0], burstSpacingMs: 0 });
const BURST = Object.freeze({ tier: 3, name: "BURST", cooldownMs: 800, speed: 650, lifetimeMs: 800, radius: 3.2, count: 3, spreadDegrees: [0, 0, 0], burstSpacingMs: 90 });
const SHOTGUN = Object.freeze({ tier: 5, name: "SHOTGUN", cooldownMs: 850, speed: 700, lifetimeMs: 550, radius: 3, count: 3, spreadDegrees: [-8, 0, 8], burstSpacingMs: 0 });
const GENERATED_BURST = Object.freeze({ tier: 6, visualTier: 7, name: "WARP SPITTER", cooldownMs: 240, speed: 1600, lifetimeMs: 1050, radius: 6, count: 12, spreadDegrees: [0], burstSpacingMs: 22, generated: true });
const GENERATED_SCATTER = Object.freeze({ tier: 6, visualTier: 7, name: "TRASH COMPACTOR", cooldownMs: 900, speed: 900, lifetimeMs: 800, radius: 5, count: 9, spreadDegrees: [-32, -24, -16, -8, 0, 8, 16, 24, 32], burstSpacingMs: 0, generated: true });

function localRenderer(pose = null) {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.pendingLocalShotConfirmations = [];
  renderer.localInputPoses = new Map();
  renderer.preparedLocalInputs = new Map();
  renderer.predictedShotGroups = new Map();
  renderer.localProjectiles = new Map();
  renderer.weaponPoses = new Map(pose ? [["local", pose]] : []);
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.nextPredictedProjectileId = -1;
  renderer.nextFireIntentId = 0;
  renderer.localFirePrediction = null;
  renderer.lastLocalLaunch = null;
  renderer.canvas = null;
  return renderer;
}

test("weapon visual table maps all standard tiers and the generated loadout to production art", () => {
  assert.deepEqual(Object.keys(WEAPON_VISUALS), ["1", "2", "3", "4", "5", "6", "7"]);
  assert.equal(WEAPON_VISUALS[1].id, "pea-shooter");
  assert.equal(WEAPON_VISUALS[1].kind, "sprite");
  assert.equal(WEAPON_VISUALS[1].asset, "peaShooter");
  assert.equal(WEAPON_VISUALS[2].id, "pistol");
  assert.equal(WEAPON_VISUALS[2].kind, "sprite");
  assert.equal(WEAPON_VISUALS[2].asset, "pistol");
  assert.deepEqual(
    Object.values(WEAPON_VISUALS).map(({ id, kind, asset }) => ({ id, kind, asset })),
    [
      { id: "pea-shooter", kind: "sprite", asset: "peaShooter" },
      { id: "pistol", kind: "sprite", asset: "pistol" },
      { id: "burst", kind: "sprite", asset: "burst" },
      { id: "smg", kind: "sprite", asset: "smg" },
      { id: "shotgun", kind: "sprite", asset: "shotgun" },
      { id: "plasma-cannon", kind: "sprite", asset: "plasmaCannon" },
      { id: "random-generator", kind: "sprite", asset: "randomGenerator" },
    ],
  );
  assert.equal(WEAPON_VISUALS[1].muzzle.x, .985);
  for (let tier = 2; tier <= 6; tier++) assert.equal(WEAPON_VISUALS[tier].muzzle.x, .997);
  assert.equal(WEAPON_VISUALS[7].flipX, true);
  for (const sprite of ["pea-shooter", "pistol", "burst", "smg", "shotgun", "plasma-cannon", "random-generator"]) {
    assert.equal(existsSync(resolve("..", "games", "game-03", "assets", "weapons", `weapon-${sprite}.png`)), true);
  }
  assert.equal(weaponVisualForTier(999), WEAPON_VISUALS[1]);
});

test("new production sprites preserve their authored projectile launch distances", () => {
  const expectedDistances = new Map([[3, 36], [4, 36], [5, 36], [6, 42]]);
  for (const [tier, expected] of expectedDistances) {
    const visual = WEAPON_VISUALS[tier];
    const distance = visual.forwardOffset + (visual.muzzle.x - visual.pivot.x) * visual.drawSize.width;
    close(distance, expected, .01);
  }
});

test("Pea Shooter stays right-side docked and muzzle-aligned through 360 degrees", () => {
  const visual = WEAPON_VISUALS[1];
  const expectedForward = visual.forwardOffset + (visual.muzzle.x - visual.pivot.x) * visual.drawSize.width;
  const expectedSide = visual.sideOffset + (visual.muzzle.y - visual.pivot.y) * visual.drawSize.height;
  for (let degrees = 0; degrees < 360; degrees += 45) {
    const angle = degrees * Math.PI / 180;
    const forward = { x: Math.cos(angle), y: Math.sin(angle) };
    const perpendicular = { x: -forward.y, y: forward.x };
    const pose = weaponPose({ x: 400, y: 300, aimX: forward.x, aimY: forward.y, weaponTier: 1 }, visual);
    const muzzleDelta = { x: pose.muzzleWorld.x - 400, y: pose.muzzleWorld.y - 300 };
    const pivotDelta = { x: pose.pivotWorld.x - 400, y: pose.pivotWorld.y - 300 };
    close(pose.angle, angle > Math.PI ? angle - Math.PI * 2 : angle);
    close(pivotDelta.x * forward.x + pivotDelta.y * forward.y, visual.forwardOffset);
    close(pivotDelta.x * perpendicular.x + pivotDelta.y * perpendicular.y, visual.sideOffset);
    close(muzzleDelta.x * forward.x + muzzleDelta.y * forward.y, expectedForward);
    close(muzzleDelta.x * perpendicular.x + muzzleDelta.y * perpendicular.y, expectedSide);
  }
  close(expectedForward, 37.87);
  close(expectedSide, SHOULDER_SIDE_OFFSET);
});

test("all weapon tiers use the same shoulder-side mount through every aim quadrant", () => {
  for (const visual of Object.values(WEAPON_VISUALS)) for (let degrees = 0; degrees < 360; degrees += 45) {
    const angle = degrees * Math.PI / 180;
    const forward = { x: Math.cos(angle), y: Math.sin(angle) };
    const perpendicular = { x: -forward.y, y: forward.x };
    const pose = weaponPose({ x: 400, y: 300, aimX: forward.x, aimY: forward.y, weaponTier: visual.tier }, visual);
    const pivotDelta = { x: pose.pivotWorld.x - 400, y: pose.pivotWorld.y - 300 };
    close(pivotDelta.x * perpendicular.x + pivotDelta.y * perpendicular.y, SHOULDER_SIDE_OFFSET);
  }
});

test("recoil moves only backward along aim and returns without changing the side mount", () => {
  const visual = WEAPON_VISUALS[1];
  const normal = weaponPose({ x: 100, y: 100, aimX: 1, aimY: 0, weaponTier: 1 }, visual);
  const recoiled = weaponPose({ x: 100, y: 100, aimX: 1, aimY: 0, weaponTier: 1 }, visual, { recoil: visual.recoilDistance });
  close(normal.muzzleWorld.x - recoiled.muzzleWorld.x, visual.recoilDistance);
  close(normal.muzzleWorld.y, recoiled.muzzleWorld.y);
});

test("character drawing always completes before the shoulder weapon foreground pass", () => {
  const source = DustyOrbitMultiplayerRenderer.prototype.drawPlayer.toString();
  assert.ok(source.indexOf("ctx.drawImage(body") < source.indexOf("this.drawWeaponModule(modulePose"));
  assert.equal(source.includes("modulePose.depthOffset"), false);
});

test("an unmatched local confirmation uses the muzzle captured for its own input", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.pendingLocalShotConfirmations = [];
  renderer.weaponPoses = new Map([["local", { muzzleWorld: { x: 411, y: 277 }, forward: { x: 1, y: 0 } }]]);
  renderer.localInputPoses = new Map([[40, { muzzleWorld: { x: 411, y: 277 }, forward: { x: 1, y: 0 } }]]);
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.localProjectiles = new Map();
  renderer.confirmShot({
    playerId: "local",
    projectile: { id: 7, inputSeq: 40, tier: 1, x: 400, y: 266, vx: 500, vy: 0, spawnedAt: 1000, expiresAt: 1500 },
  }, true);
  assert.equal(renderer.localProjectiles.size, 1);
  renderer.flushLocalShotConfirmations();
  const shot = renderer.localProjectiles.get(7);
  assert.deepEqual({ x: shot.startX, y: shot.startY }, { x: 411, y: 277 });
  assert.equal(shot.firstFrame, true);
  assert.equal("visualOffsetX" in shot, false);
  assert.equal("convergeMs" in shot, false);
});

test("local Shotgun pellets preserve all three authoritative spread directions", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.pendingLocalShotConfirmations = [];
  renderer.weaponPoses = new Map([["local", { muzzleWorld: { x: 411, y: 277 }, forward: { x: 1, y: 0 } }]]);
  renderer.localInputPoses = new Map([[40, { muzzleWorld: { x: 411, y: 277 }, forward: { x: 1, y: 0 } }]]);
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.localProjectiles = new Map();
  for (const [index, degrees] of [-8, 0, 8].entries()) {
    const angle = degrees * Math.PI / 180;
    renderer.confirmShot({
      playerId: "local",
      projectile: { id: 80 + index, inputSeq: 40, tier: 5, x: 400, y: 266, vx: Math.cos(angle) * 700, vy: Math.sin(angle) * 700, spawnedAt: 1000, expiresAt: 1550 },
    }, true);
  }
  renderer.flushLocalShotConfirmations();
  assert.equal(renderer.localProjectiles.size, 3);
  assert.deepEqual([...renderer.localProjectiles.values()].map((shot) => Math.round(Math.atan2(shot.vy, shot.vx) * 180 / Math.PI)), [-8, 0, 8]);
  assert.ok([...renderer.localProjectiles.values()].every((shot) => shot.startX === 411 && shot.startY === 277));
});

test("a delayed Shotgun confirmation stays on its historical muzzle and spread after the gun turns", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.pendingLocalShotConfirmations = [];
  renderer.weaponPoses = new Map([["local", { muzzleWorld: { x: 500, y: 350 }, forward: { x: 0, y: 1 } }]]);
  renderer.localInputPoses = new Map([[40, { muzzleWorld: { x: 500, y: 350 }, forward: { x: 1, y: 0 } }]]);
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.localProjectiles = new Map();
  for (const [index, degrees] of [-8, 0, 8].entries()) {
    const angle = degrees * Math.PI / 180;
    renderer.confirmShot({
      playerId: "local", shotId: 90, aimX: 1, aimY: 0,
      projectile: { id: 90 + index, inputSeq: 40, tier: 5, vx: Math.cos(angle) * 700, vy: Math.sin(angle) * 700, spawnedAt: 1000, expiresAt: 1550 },
    }, true);
  }
  renderer.flushLocalShotConfirmations();
  assert.deepEqual([...renderer.localProjectiles.values()].map((shot) => Math.round(Math.atan2(shot.vy, shot.vx) * 180 / Math.PI)), [-8, 0, 8]);
  assert.ok([...renderer.localProjectiles.values()].every((shot) => shot.startX === 500 && shot.startY === 350));
});

test("network transit never fast-forwards a bullet away from its muzzle", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.pendingLocalShotConfirmations = [];
  renderer.weaponPoses = new Map([["local", { muzzleWorld: { x: 411, y: 277 }, forward: { x: 1, y: 0 } }]]);
  renderer.localInputPoses = new Map([[40, { muzzleWorld: { x: 411, y: 277 }, forward: { x: 1, y: 0 } }]]);
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.localProjectiles = new Map();
  const beforeConfirmation = performance.now();
  const oldServerTime = Date.now() - 500;
  renderer.confirmShot({
    playerId: "local",
    projectile: { id: 70, inputSeq: 40, tier: 1, x: 400, y: 266, vx: 500, vy: 0, spawnedAt: oldServerTime, expiresAt: oldServerTime + 750 },
  }, true);
  renderer.flushLocalShotConfirmations();
  const shot = renderer.localProjectiles.get(70);
  assert.ok(shot.born >= beforeConfirmation, "the visual projectile must start now, not at the server's historical timestamp");
  assert.deepEqual({ x: shot.startX, y: shot.startY }, { x: 411, y: 277 });
});

test("the first rendered projectile sample is exactly the nozzle coordinate", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localProjectiles = new Map([[72, {
    id: 72,
    startX: 411,
    startY: 277,
    previousX: 411,
    previousY: 277,
    vx: 500,
    vy: 0,
    born: performance.now() - 250,
    life: 750,
    firstFrame: true,
  }]]);
  renderer.lastLocalLaunch = { projectileId: 72, muzzleWorld: { x: 411, y: 277 }, direction: { x: 1, y: 0 }, firstRenderError: null };
  let drawn = null;
  renderer.drawProjectiles = (projectiles) => { drawn = projectiles[0]; };
  renderer.drawLocalProjectiles();
  assert.deepEqual({ x: drawn.x, y: drawn.y }, { x: 411, y: 277 });
  assert.deepEqual({ x: drawn.trailStartX, y: drawn.trailStartY }, { x: 411, y: 277 });
  assert.equal(renderer.lastLocalLaunch.firstRenderError, 0);
  assert.equal(renderer.localProjectiles.get(72).firstFrame, false);

  const stored = renderer.localProjectiles.get(72);
  stored.born = performance.now() - 16;
  renderer.drawLocalProjectiles();
  assert.ok(drawn.x > 411, "the second frame advances forward");
  assert.deepEqual({ x: drawn.trailStartX, y: drawn.trailStartY }, { x: 411, y: 277 });
});

test("an impact arriving before the next render cannot resurrect a local projectile", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.localProjectiles = new Map();
  renderer.pendingLocalShotConfirmations = [];
  renderer.weaponPoses = new Map([["local", {
    muzzleWorld: { x: 411, y: 277 },
    forward: { x: 1, y: 0 },
  }]]);
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.lastLocalLaunch = null;
  renderer.canvas = null;

  renderer.confirmShot({
    playerId: "local",
    shotId: 73,
    aimX: 1,
    aimY: 0,
    projectile: { id: 73, tier: 6, x: 400, y: 266, vx: 1200, vy: 0, spawnedAt: 1000, expiresAt: 2000 },
  }, true);
  assert.equal(renderer.localProjectiles.has(73), true);
  assert.equal(renderer.pendingLocalShotConfirmations.length, 0);

  renderer.impact({ projectileId: 73, x: 430, y: 266, target: "player" });
  assert.equal(renderer.pendingLocalShotConfirmations.length, 0, "the authoritative impact cancels the deferred launch");

  renderer.flushLocalShotConfirmations();
  assert.equal(renderer.localProjectiles.has(73), false, "the dead projectile must stay dead on the next frame");
});

test("a predicted local projectile stops visually when it crosses a static collider", () => {
  const renderer = localRenderer();
  renderer.assets = { projectilePolygons: [[
    { x: 10, y: -10 }, { x: 20, y: -10 }, { x: 20, y: 10 }, { x: 10, y: 10 },
  ]] };
  renderer.localProjectiles.set(-1, {
    id: -1, tier: 1, radius: 2, startX: 0, startY: 0, previousX: 0, previousY: 0,
    vx: 1000, vy: 0, born: performance.now() - 25, life: 500, firstFrame: false,
  });
  let drawn = null;
  renderer.drawProjectiles = (projectiles) => { drawn = projectiles; };

  renderer.drawLocalProjectiles();

  assert.deepEqual(drawn, []);
  assert.equal(renderer.localProjectiles.has(-1), false);
});

test("movement during confirmation delay cannot move a historical shot onto a newer muzzle", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.pendingLocalShotConfirmations = [];
  renderer.localProjectiles = new Map();
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.weaponPoses = new Map([["local", {
    tier: 1,
    angle: 0,
    forward: { x: 1, y: 0 },
    muzzleWorld: { x: 321, y: 456 },
  }]]);
  renderer.localInputPoses = new Map([[40, {
    tier: 1, angle: 0, forward: { x: 1, y: 0 }, muzzleWorld: { x: 321, y: 456 },
  }]]);
  renderer.confirmShot({
    playerId: "local",
    projectile: { id: 71, inputSeq: 40, tier: 1, x: 300, y: 400, vx: 500, vy: 0, spawnedAt: Date.now(), expiresAt: Date.now() + 500 },
  }, true);
  // This is the pose drawPlayer() calculates on the confirmation's actual
  // render frame, after movement has advanced the character.
  renderer.weaponPoses.set("local", {
    tier: 1,
    angle: 0,
    forward: { x: 1, y: 0 },
    muzzleWorld: { x: 421, y: 456 },
  });
  renderer.flushLocalShotConfirmations();
  const shot = renderer.localProjectiles.get(71);
  assert.deepEqual({ x: shot.startX, y: shot.startY }, { x: 321, y: 456 });
  assert.deepEqual({ vx: shot.vx, vy: shot.vy }, { vx: 500, vy: 0 });
});

test("turning toward a new target cannot redirect an older confirmed shot", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.pendingLocalShotConfirmations = [];
  renderer.weaponPoses = new Map([["local", { muzzleWorld: { x: 411, y: 277 }, forward: { x: 0, y: -1 } }]]);
  renderer.localInputPoses = new Map([[40, { muzzleWorld: { x: 411, y: 277 }, forward: { x: 1, y: 0 } }]]);
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.localProjectiles = new Map();
  renderer.confirmShot({
    playerId: "local",
    shotId: 8,
    aimX: 1,
    aimY: 0,
    projectile: { id: 8, inputSeq: 40, tier: 2, x: 395, y: 266, vx: 600, vy: 0, spawnedAt: 1000, expiresAt: 1750 },
  }, true);
  renderer.flushLocalShotConfirmations();
  const shot = renderer.localProjectiles.get(8);
  assert.deepEqual({ x: shot.startX, y: shot.startY }, { x: 411, y: 277 });
  assert.deepEqual({ vx: shot.vx, vy: shot.vy }, { vx: 600, vy: 0 });
  assert.deepEqual(renderer.lastLocalLaunch.direction, { x: 1, y: 0 }, "the old eastbound shot must not be presented as the first northbound shot");
  assert.equal(renderer.pendingLocalShotConfirmations.length, 0);
});

test("multiple delayed confirmations use their own captured input poses without a render-frame backlog", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.pendingLocalShotConfirmations = [];
  renderer.weaponPoses = new Map([["local", { muzzleWorld: { x: 410, y: 270 }, forward: { x: 1, y: 0 } }]]);
  renderer.localInputPoses = new Map([
    [20, { muzzleWorld: { x: 410, y: 270 }, forward: { x: 1, y: 0 } }],
    [21, { muzzleWorld: { x: 420, y: 290 }, forward: { x: 0, y: 1 } }],
  ]);
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.localProjectiles = new Map();
  renderer.confirmShot({ playerId: "local", shotId: 20, aimX: 1, aimY: 0, projectile: { id: 20, inputSeq: 20, tier: 4, vx: 700, vy: 0, spawnedAt: 1000, expiresAt: 1900 } }, true);
  renderer.confirmShot({ playerId: "local", shotId: 21, aimX: 0, aimY: 1, projectile: { id: 21, inputSeq: 21, tier: 4, vx: 0, vy: 700, spawnedAt: 1020, expiresAt: 1920 } }, true);

  renderer.flushLocalShotConfirmations();
  assert.deepEqual([...renderer.localProjectiles.keys()], [20, 21]);
  assert.equal(renderer.pendingLocalShotConfirmations.length, 0);

  renderer.weaponPoses.set("local", { muzzleWorld: { x: 420, y: 290 }, forward: { x: 0, y: 1 } });
  renderer.flushLocalShotConfirmations();
  assert.deepEqual([...renderer.localProjectiles.keys()], [20, 21]);
  assert.deepEqual({ x: renderer.localProjectiles.get(21).startX, y: renderer.localProjectiles.get(21).startY }, { x: 420, y: 290 });
});

test("a confirmed local bullet uses the exact nozzle produced in its render frame", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.pendingLocalShotConfirmations = [];
  renderer.localProjectiles = new Map();
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.weaponPoses = new Map([["local", {
    tier: 2,
    angle: Math.PI / 2,
    forward: { x: 0, y: 1 },
    muzzleWorld: { x: 321, y: 456 },
  }]]);
  renderer.localInputPoses = new Map([[41, {
    tier: 2, angle: Math.PI / 2, forward: { x: 0, y: 1 }, muzzleWorld: { x: 321, y: 456 },
  }]]);
  const now = Date.now();
  renderer.confirmShot({
    playerId: "local",
    projectile: { id: 9, inputSeq: 41, tier: 2, x: 300, y: 400, vx: 0, vy: 600, spawnedAt: now, expiresAt: now + 750 },
  }, true);
  renderer.flushLocalShotConfirmations();
  const shot = renderer.localProjectiles.get(9);
  assert.deepEqual({ x: shot.startX, y: shot.startY }, { x: 321, y: 456 });
  assert.deepEqual({ vx: shot.vx, vy: shot.vy }, { vx: 0, vy: 600 });
});

test("render predicts after drawing the current gun pose and before painting the muzzle/projectile", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../../games/game-03/renderer.js", import.meta.url), "utf8");
  const render = source.slice(source.indexOf("  render(snapshot"), source.indexOf("  drawTerrain()"));
  assert.ok(render.indexOf("this.drawPlayer(") < render.indexOf("onLocalPoseReady("));
  assert.ok(render.indexOf("onLocalPoseReady(") < render.indexOf("this.flushLocalShotConfirmations()"));
  assert.ok(render.indexOf("this.flushLocalShotConfirmations()") < render.indexOf('this.drawEffects("muzzle")'));
  assert.ok(render.indexOf('this.drawEffects("muzzle")') < render.indexOf("this.drawLocalProjectiles()"));
  assert.ok(render.indexOf("this.drawLocalProjectiles()") < render.indexOf('this.drawEffects("foreground")'));
});

test("local prediction launches immediately from the exact visible muzzle and aim", () => {
  const pose = { muzzleWorld: { x: 411, y: 277 }, forward: { x: 1, y: 0 } };
  const renderer = localRenderer(pose);
  const intents = renderer.prepareLocalInput(
    { seq: 1, aimX: 1, aimY: 0, fire: true },
    { alive: true, speedRemaining: 0 },
    SMG,
    { localNow: 100, serverNow: 1000, weaponState: { loadoutId: 4, fireStateId: 6, nextTriggerAt: 1000, lastFireIntentId: 0 } },
  );
  assert.equal(intents.length, 1);
  assert.deepEqual({ loadoutId: intents[0].loadoutId, fireStateId: intents[0].fireStateId }, { loadoutId: 4, fireStateId: 6 });
  assert.equal(renderer.localProjectiles.size, 0, "an unsent prepared input must not paint a bullet");
  assert.equal(renderer.commitLocalInput(1), 1);
  const shot = [...renderer.localProjectiles.values()][0];
  assert.deepEqual({ x: shot.startX, y: shot.startY }, pose.muzzleWorld);
  close(shot.vx / Math.hypot(shot.vx, shot.vy), pose.forward.x);
  close(shot.vy / Math.hypot(shot.vx, shot.vy), pose.forward.y);
  assert.equal(shot.fireIntentId, intents[0].id);
});

test("a delayed confirmation adopts the predicted projectile instead of firing sideways from a newer gun pose", () => {
  const firingPose = { muzzleWorld: { x: 411, y: 277 }, forward: { x: 1, y: 0 } };
  const renderer = localRenderer(firingPose);
  const [intent] = renderer.prepareLocalInput(
    { seq: 10, aimX: 1, aimY: 0, fire: true }, { alive: true }, SMG,
    { localNow: 100, serverNow: 1000, weaponState: { loadoutId: 1, fireStateId: 1, nextTriggerAt: 1000 } },
  );
  renderer.commitLocalInput(10);
  const predictedId = [...renderer.localProjectiles.keys()][0];
  renderer.weaponPoses.set("local", { muzzleWorld: { x: 520, y: 420 }, forward: { x: 0, y: -1 } });
  renderer.confirmShot({
    playerId: "local", shotId: 80, fireIntentId: intent.id, pelletIndex: 0,
    projectile: { id: 80, fireIntentId: intent.id, pelletIndex: 0, tier: 4, inputSeq: 10, x: 400, y: 266, vx: 700, vy: 0, spawnedAt: 1000, expiresAt: 1900 },
  }, true);
  assert.equal(renderer.localProjectiles.has(predictedId), false);
  assert.equal(renderer.localProjectiles.size, 1, "confirmation must not create a second delayed bullet");
  const shot = renderer.localProjectiles.get(80);
  assert.deepEqual({ x: shot.startX, y: shot.startY }, firingPose.muzzleWorld);
  assert.deepEqual({ vx: shot.vx, vy: shot.vy }, { vx: 700, vy: 0 });
  assert.equal(renderer.effects.filter((effect) => effect.type === "weapon-muzzle").length, 1);
});

test("held SMG fire stays muzzle-aligned while moving and turning between rounds", () => {
  const renderer = localRenderer();
  const samples = [
    { seq: 1, serverNow: 1000, pose: { muzzleWorld: { x: 100, y: 200 }, forward: { x: 1, y: 0 } } },
    { seq: 2, serverNow: 1234, pose: { muzzleWorld: { x: 130, y: 180 }, forward: { x: Math.SQRT1_2, y: -Math.SQRT1_2 } } },
    { seq: 3, serverNow: 1468, pose: { muzzleWorld: { x: 165, y: 160 }, forward: { x: 0, y: -1 } } },
  ];
  for (const sample of samples) {
    renderer.weaponPoses.set("local", sample.pose);
    const intents = renderer.prepareLocalInput(
      { seq: sample.seq, aimX: sample.pose.forward.x, aimY: sample.pose.forward.y, fire: true },
      { alive: true }, SMG,
      { localNow: sample.serverNow - 900, serverNow: sample.serverNow, weaponState: { loadoutId: 1, fireStateId: 1, nextTriggerAt: 1000 } },
    );
    assert.equal(intents.length, 1);
    renderer.commitLocalInput(sample.seq);
    const group = renderer.predictedShotGroups.get(intents[0].id);
    const shot = renderer.localProjectiles.get(group.projectiles[0].tempId);
    const speed = Math.hypot(shot.vx, shot.vy);
    assert.deepEqual({ x: shot.startX, y: shot.startY }, sample.pose.muzzleWorld);
    close(shot.vx / speed, sample.pose.forward.x);
    close(shot.vy / speed, sample.pose.forward.y);
  }
});

test("timed burst prediction gives every round a new intent and re-samples the live barrel", () => {
  const renderer = localRenderer();
  const directions = [{ x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }];
  const times = [1000, 1100, 1200];
  const intentIds = [];
  for (let index = 0; index < times.length; index++) {
    const pose = { muzzleWorld: { x: 300 + index * 10, y: 250 }, forward: directions[index] };
    renderer.weaponPoses.set("local", pose);
    const intents = renderer.prepareLocalInput(
      { seq: index + 1, aimX: pose.forward.x, aimY: pose.forward.y, fire: true }, { alive: true }, BURST,
      { localNow: 100 + index * 100, serverNow: times[index], weaponState: { loadoutId: 2, fireStateId: 1, nextTriggerAt: 1000 } },
    );
    assert.equal(intents.length, 1);
    renderer.commitLocalInput(index + 1);
    intentIds.push(intents[0].id);
    const group = renderer.predictedShotGroups.get(intents[0].id);
    close(group.projectiles[0].direction.x, pose.forward.x);
    close(group.projectiles[0].direction.y, pose.forward.y);
  }
  assert.equal(new Set(intentIds).size, 3);
});

test("Shotgun prediction uses one intent, one muzzle, and authoritative pellet indices", () => {
  const pose = { muzzleWorld: { x: 500, y: 350 }, forward: { x: 1, y: 0 } };
  const renderer = localRenderer(pose);
  const [intent] = renderer.prepareLocalInput(
    { seq: 7, aimX: 1, aimY: 0, fire: true }, { alive: true }, SHOTGUN,
    { localNow: 100, serverNow: 1000, weaponState: { loadoutId: 3, fireStateId: 1, nextTriggerAt: 1000 } },
  );
  renderer.commitLocalInput(7);
  assert.equal(renderer.predictedShotGroups.get(intent.id).projectiles.length, 3);
  assert.deepEqual([...renderer.localProjectiles.values()].map((shot) => Math.round(Math.atan2(shot.vy, shot.vx) * 180 / Math.PI)), [-8, 0, 8]);
  for (const [pelletIndex, degrees] of [-8, 0, 8].entries()) {
    const radians = degrees * Math.PI / 180;
    renderer.confirmShot({
      playerId: "local", shotId: 90, fireIntentId: intent.id, pelletIndex,
      projectile: { id: 90 + pelletIndex, fireIntentId: intent.id, pelletIndex, pelletCount: 3, tier: 5, inputSeq: 7, vx: Math.cos(radians) * 700, vy: Math.sin(radians) * 700, spawnedAt: 1000, expiresAt: 1550 },
    }, true);
  }
  assert.deepEqual([...renderer.localProjectiles.keys()], [90, 91, 92]);
  assert.ok([...renderer.localProjectiles.values()].every((shot) => shot.startX === 500 && shot.startY === 350));
});

test("prepared prediction is transactional across send commit and rollback", () => {
  const pose = { muzzleWorld: { x: 411, y: 277 }, forward: { x: 1, y: 0 } };
  const renderer = localRenderer(pose);
  const options = {
    localNow: 100,
    serverNow: 1000,
    weaponState: { loadoutId: 4, fireStateId: 7, nextTriggerAt: 1000, lastFireIntentId: 0 },
  };

  const [unsent] = renderer.prepareLocalInput(
    { seq: 1, aimX: 1, aimY: 0, fire: true }, { alive: true }, SMG, options,
  );
  assert.equal(unsent.id, 1);
  assert.equal(unsent.loadoutId, 4);
  assert.equal(unsent.fireStateId, 7);
  assert.equal(renderer.preparedLocalInputs.has(1), true);
  assert.equal(renderer.localProjectiles.size, 0);
  assert.equal(renderer.effects.length, 0);

  renderer.rollbackLocalInput(1);
  assert.equal(renderer.preparedLocalInputs.has(1), false);
  assert.equal(renderer.localInputPoses.has(1), false);
  assert.equal(renderer.nextFireIntentId, 0);
  assert.equal(renderer.localProjectiles.size, 0);

  const [retry] = renderer.prepareLocalInput(
    { seq: 2, aimX: 1, aimY: 0, fire: true }, { alive: true }, SMG, options,
  );
  assert.equal(retry.id, 1, "a failed send must not burn an intent id or cadence slot");
  assert.equal(renderer.commitLocalInput(2), 1);
  assert.equal(renderer.commitLocalInput(2), 0, "commit is idempotent after the transaction is consumed");
  assert.equal(renderer.localProjectiles.size, 1);
  assert.equal(renderer.effects.filter((effect) => effect.type === "weapon-muzzle").length, 1);
});

test("server rejection removes every unconfirmed pellet in the predicted intent group", () => {
  const renderer = localRenderer({ muzzleWorld: { x: 500, y: 350 }, forward: { x: 1, y: 0 } });
  const [intent] = renderer.prepareLocalInput(
    { seq: 8, aimX: 1, aimY: 0, fire: true }, { alive: true }, SHOTGUN,
    { localNow: 100, serverNow: 1000, weaponState: { loadoutId: 3, fireStateId: 1, nextTriggerAt: 1000 } },
  );
  renderer.commitLocalInput(8);
  assert.equal(renderer.predictedShotGroups.get(intent.id).projectiles.length, 3);
  assert.equal(renderer.localProjectiles.size, 3);

  renderer.rejectLocalFireIntent(intent.id);
  assert.equal(renderer.predictedShotGroups.has(intent.id), false);
  assert.equal(renderer.localProjectiles.size, 0);
  renderer.rejectLocalFireIntent(intent.id);
  assert.equal(renderer.localProjectiles.size, 0, "duplicate rejection remains harmless");
});

test("generated visual-tier-7 burst and scatter keep their strange authored cadence and spread", () => {
  const burstRenderer = localRenderer({ muzzleWorld: { x: 200, y: 300 }, forward: { x: 1, y: 0 } });
  const firstBurst = burstRenderer.prepareLocalInput(
    { seq: 20, aimX: 1, aimY: 0, fire: true }, { alive: true }, GENERATED_BURST,
    { localNow: 100, serverNow: 1000, weaponState: { loadoutId: 9, fireStateId: 4, nextTriggerAt: 1000 } },
  );
  assert.equal(firstBurst.length, 1);
  burstRenderer.commitLocalInput(20);

  const northPose = { muzzleWorld: { x: 230, y: 260 }, forward: { x: 0, y: -1 } };
  burstRenderer.weaponPoses.set("local", northPose);
  const catchUpBurst = burstRenderer.prepareLocalInput(
    { seq: 21, aimX: 0, aimY: -1, fire: true }, { alive: true }, GENERATED_BURST,
    { localNow: 166, serverNow: 1066, weaponState: { loadoutId: 9, fireStateId: 4, nextTriggerAt: 1000 } },
  );
  assert.equal(catchUpBurst.length, 3, "22ms generated bursts may emit three due rounds in one render input");
  burstRenderer.commitLocalInput(21);
  assert.equal(burstRenderer.localProjectiles.size, 4);
  assert.ok([...burstRenderer.localProjectiles.values()].every((shot) => shot.tier === 7));
  for (const intent of catchUpBurst) {
    const predicted = burstRenderer.predictedShotGroups.get(intent.id).projectiles[0];
    close(predicted.direction.x, 0);
    close(predicted.direction.y, -1);
  }

  const scatterRenderer = localRenderer({ muzzleWorld: { x: 500, y: 350 }, forward: { x: 1, y: 0 } });
  const [scatterIntent] = scatterRenderer.prepareLocalInput(
    { seq: 30, aimX: 1, aimY: 0, fire: true }, { alive: true }, GENERATED_SCATTER,
    { localNow: 200, serverNow: 2000, weaponState: { loadoutId: 10, fireStateId: 5, nextTriggerAt: 2000 } },
  );
  scatterRenderer.commitLocalInput(30);
  const scatter = scatterRenderer.predictedShotGroups.get(scatterIntent.id);
  assert.equal(scatter.projectiles.length, 9);
  assert.ok([...scatterRenderer.localProjectiles.values()].every((shot) => shot.tier === 7));
  assert.deepEqual(scatter.projectiles.map((shot) => Math.round(Math.atan2(shot.direction.y, shot.direction.x) * 180 / Math.PI)),
    [-32, -24, -16, -8, 0, 8, 16, 24, 32]);
});

test("fart clouds animate from server snapshot time despite a skewed PC clock", () => {
  const serverNow = 1_000_000;
  assert.equal(snapshotRenderTime({ t: serverNow }, serverNow + 60_000), serverNow);
  assert.equal(snapshotRenderTime({}, serverNow + 60_000), serverNow + 60_000);
});

test("local mole burrow dirt uses the currently rendered movement lead instead of the stale pickup position", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.renderedPlayers = new Map([["local", { x: 500, y: 300, vx: 165, vy: 0 }]]);
  renderer.weaponHiddenByMole = new Set();
  renderer.weaponPoses = new Map();
  renderer.moleTransitions = new Map();
  renderer.effects = [];
  renderer.moleBurrowed({ playerId: "local", x: 120, y: 90, vx: 165, vy: 0 });
  assert.equal(renderer.effects[0].x, 527);
  assert.equal(renderer.effects[0].y, 300);
});
