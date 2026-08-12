import assert from "node:assert/strict";
import test from "node:test";
import { ArenaNetwork } from "../../games/game-03/network.js";

function networkWithSnapshots(snapshots) {
  const network = new ArenaNetwork({ url: "ws://invalid", sessionId: "unused", name: "Guest-0000", onState() {}, onMessage() {} });
  network.snapshots = snapshots;
  return network;
}

test("a newly observed Dusty projectile starts at its spawn point and advances within the interpolation window", () => {
  const snapshots = [
    { type: "snapshot", t: 1000, players: [], projectiles: [] },
    { type: "snapshot", t: 1066, players: [], projectiles: [{ id: 1, x: 117.7, y: 50, vx: 680, vy: 0, spawnedAt: 1040 }] },
  ];
  const network = networkWithSnapshots(snapshots);
  const atSpawn = network.interpolatedSnapshot(1140).projectiles[0];
  const tenMsLater = network.interpolatedSnapshot(1150).projectiles[0];
  assert.ok(Math.abs(atSpawn.x - 100) < 0.2);
  assert.ok(tenMsLater.x > atSpawn.x + 6.5);
  assert.ok(tenMsLater.x < 108);
});

test("projectiles extrapolate only briefly when a snapshot is delayed", () => {
  const network = networkWithSnapshots([
    { type: "snapshot", t: 1000, players: [], projectiles: [{ id: 1, x: 100, y: 50, vx: 680, vy: 0, spawnedAt: 900 }] },
  ]);
  const projectile = network.interpolatedSnapshot(1220).projectiles[0];
  assert.equal(projectile.x, 168);
});

test("local projectiles are excluded from snapshots while remote projectiles retain the interpolation buffer", () => {
  const network = networkWithSnapshots([
    { type: "snapshot", t: 1000, players: [], projectiles: [
      { id: 1, ownerId: "local", x: 100, y: 50, vx: 680, vy: 0, spawnedAt: 900 },
      { id: 2, ownerId: "remote", x: 100, y: 80, vx: 680, vy: 0, spawnedAt: 900 },
    ] },
  ]);
  const snapshot = network.interpolatedSnapshot(1100, "local");
  const local = snapshot.projectiles.find((projectile) => projectile.id === 1);
  const remote = snapshot.projectiles.find((projectile) => projectile.id === 2);
  assert.equal(local, undefined);
  assert.equal(remote.x, 100);
});
