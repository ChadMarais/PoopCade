import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DustyOrbitMultiplayerRenderer, snapshotRenderTime } from "../../games/game-03/renderer.js";
import { SHOULDER_SIDE_OFFSET, WEAPON_VISUALS, weaponPose, weaponVisualForTier } from "../../games/game-03/weapon-visuals.js";

function close(actual, expected, tolerance = .001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

test("weapon visual table maps all six tiers to production art", () => {
  assert.deepEqual(Object.keys(WEAPON_VISUALS), ["1", "2", "3", "4", "5", "6"]);
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
    ],
  );
  assert.equal(WEAPON_VISUALS[1].muzzle.x, .985);
  for (let tier = 2; tier <= 6; tier++) assert.equal(WEAPON_VISUALS[tier].muzzle.x, .997);
  for (const sprite of ["pea-shooter", "pistol", "burst", "smg", "shotgun", "plasma-cannon"]) {
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

test("local confirmed shots stay on the currently rendered muzzle line without convergence", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.pendingLocalShotConfirmations = [];
  renderer.weaponPoses = new Map([["local", { muzzleWorld: { x: 411, y: 277 }, forward: { x: 1, y: 0 } }]]);
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.localProjectiles = new Map();
  renderer.confirmShot({
    playerId: "local",
    projectile: { id: 7, tier: 1, x: 400, y: 266, vx: 500, vy: 0, spawnedAt: 1000, expiresAt: 1500 },
  }, true);
  assert.equal(renderer.localProjectiles.size, 0, "the network callback must not use a cached muzzle pose");
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
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.localProjectiles = new Map();
  for (const [index, degrees] of [-8, 0, 8].entries()) {
    const angle = degrees * Math.PI / 180;
    renderer.confirmShot({
      playerId: "local",
      projectile: { id: 80 + index, tier: 5, x: 400, y: 266, vx: Math.cos(angle) * 700, vy: Math.sin(angle) * 700, spawnedAt: 1000, expiresAt: 1550 },
    }, true);
  }
  renderer.flushLocalShotConfirmations();
  assert.equal(renderer.localProjectiles.size, 3);
  assert.deepEqual([...renderer.localProjectiles.values()].map((shot) => Math.round(Math.atan2(shot.vy, shot.vx) * 180 / Math.PI)), [-8, 0, 8]);
  assert.ok([...renderer.localProjectiles.values()].every((shot) => shot.startX === 411 && shot.startY === 277));
});

test("Shotgun spread rotates around the gun's current muzzle direction", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.pendingLocalShotConfirmations = [];
  renderer.weaponPoses = new Map([["local", { muzzleWorld: { x: 500, y: 350 }, forward: { x: 0, y: 1 } }]]);
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.localProjectiles = new Map();
  for (const [index, degrees] of [-8, 0, 8].entries()) {
    const angle = degrees * Math.PI / 180;
    renderer.confirmShot({
      playerId: "local", shotId: 90, aimX: 1, aimY: 0,
      projectile: { id: 90 + index, tier: 5, vx: Math.cos(angle) * 700, vy: Math.sin(angle) * 700, spawnedAt: 1000, expiresAt: 1550 },
    }, true);
  }
  renderer.flushLocalShotConfirmations();
  assert.deepEqual([...renderer.localProjectiles.values()].map((shot) => Math.round(Math.atan2(shot.vy, shot.vx) * 180 / Math.PI)), [82, 90, 98]);
  assert.ok([...renderer.localProjectiles.values()].every((shot) => shot.startX === 500 && shot.startY === 350));
});

test("network transit never fast-forwards a bullet away from its muzzle", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.pendingLocalShotConfirmations = [];
  renderer.weaponPoses = new Map([["local", { muzzleWorld: { x: 411, y: 277 }, forward: { x: 1, y: 0 } }]]);
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.localProjectiles = new Map();
  const beforeConfirmation = performance.now();
  const oldServerTime = Date.now() - 500;
  renderer.confirmShot({
    playerId: "local",
    projectile: { id: 70, tier: 1, x: 400, y: 266, vx: 500, vy: 0, spawnedAt: oldServerTime, expiresAt: oldServerTime + 750 },
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

test("movement during confirmation delay still launches from the currently visible aligned muzzle", () => {
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
  assert.deepEqual({ x: shot.startX, y: shot.startY }, { x: 421, y: 456 });
  assert.deepEqual({ vx: shot.vx, vy: shot.vy }, { vx: 500, vy: 0 });
});

test("the current gun muzzle corrects a delayed confirmation immediately before launch", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.pendingLocalShotConfirmations = [];
  renderer.weaponPoses = new Map([["local", { muzzleWorld: { x: 411, y: 277 }, forward: { x: 0, y: -1 } }]]);
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.localProjectiles = new Map();
  renderer.confirmShot({
    playerId: "local",
    shotId: 8,
    aimX: 1,
    aimY: 0,
    projectile: { id: 8, tier: 2, x: 395, y: 266, vx: 600, vy: 0, spawnedAt: 1000, expiresAt: 1750 },
  }, true);
  renderer.flushLocalShotConfirmations();
  const shot = renderer.localProjectiles.get(8);
  assert.deepEqual({ x: shot.startX, y: shot.startY }, { x: 411, y: 277 });
  assert.ok(Math.abs(shot.vx) < 1e-9);
  assert.equal(shot.vy, -600, "the bullet must be redirected onto the gun's current north-facing barrel");
  assert.equal(renderer.pendingLocalShotConfirmations.length, 0);
});

test("queued launch groups each receive their own aligned gun frame", () => {
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.localPlayerId = "local";
  renderer.pendingLocalShotConfirmations = [];
  renderer.weaponPoses = new Map([["local", { muzzleWorld: { x: 410, y: 270 }, forward: { x: 1, y: 0 } }]]);
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.localProjectiles = new Map();
  renderer.confirmShot({ playerId: "local", shotId: 20, aimX: 1, aimY: 0, projectile: { id: 20, tier: 4, vx: 700, vy: 0, spawnedAt: 1000, expiresAt: 1900 } }, true);
  renderer.confirmShot({ playerId: "local", shotId: 21, aimX: 0, aimY: 1, projectile: { id: 21, tier: 4, vx: 0, vy: 700, spawnedAt: 1020, expiresAt: 1920 } }, true);

  renderer.flushLocalShotConfirmations();
  assert.deepEqual([...renderer.localProjectiles.keys()], [20]);
  assert.equal(renderer.pendingLocalShotConfirmations.length, 1);

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

test("render flushes local confirmations only after drawing the current gun pose", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../../games/game-03/renderer.js", import.meta.url), "utf8");
  const render = source.slice(source.indexOf("  render(snapshot"), source.indexOf("  drawTerrain()"));
  assert.ok(render.indexOf("this.drawPlayer(") < render.indexOf("this.flushLocalShotConfirmations()"));
  assert.ok(render.indexOf("this.flushLocalShotConfirmations()") < render.indexOf('this.drawEffects("muzzle")'));
  assert.ok(render.indexOf('this.drawEffects("muzzle")') < render.indexOf("this.drawLocalProjectiles()"));
  assert.ok(render.indexOf("this.drawLocalProjectiles()") < render.indexOf('this.drawEffects("foreground")'));
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
