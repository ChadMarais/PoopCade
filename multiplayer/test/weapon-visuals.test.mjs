import assert from "node:assert/strict";
import test from "node:test";
import { DustyOrbitMultiplayerRenderer } from "../../games/game-03/renderer.js";
import { SHOULDER_SIDE_OFFSET, WEAPON_VISUALS, weaponPose, weaponVisualForTier } from "../../games/game-03/weapon-visuals.js";

function close(actual, expected, tolerance = .001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

test("weapon visual table maps all six tiers and only Tier 1 requires production art", () => {
  assert.deepEqual(Object.keys(WEAPON_VISUALS), ["1", "2", "3", "4", "5", "6"]);
  assert.equal(WEAPON_VISUALS[1].id, "pea-shooter");
  assert.equal(WEAPON_VISUALS[1].kind, "sprite");
  assert.equal(WEAPON_VISUALS[1].asset, "peaShooter");
  for (let tier = 2; tier <= 6; tier++) assert.equal(WEAPON_VISUALS[tier].kind, "procedural");
  assert.equal(weaponVisualForTier(999), WEAPON_VISUALS[1]);
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
  close(expectedForward, 35.98);
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
  renderer.weaponPoses = new Map([["local", { muzzleWorld: { x: 411, y: 277 } }]]);
  renderer.weaponRecoil = new Map();
  renderer.effects = [];
  renderer.localProjectiles = new Map();
  renderer.confirmShot({
    playerId: "local",
    projectile: { id: 7, tier: 1, x: 400, y: 266, vx: 500, vy: 0, spawnedAt: 1000, expiresAt: 1500 },
  }, true);
  const shot = renderer.localProjectiles.get(7);
  assert.deepEqual({ x: shot.startX, y: shot.startY }, { x: 411, y: 277 });
  assert.equal("visualOffsetX" in shot, false);
  assert.equal("convergeMs" in shot, false);
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
