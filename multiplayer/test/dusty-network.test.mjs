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

test("an impact removes its projectile from every buffered interpolation snapshot", () => {
  const network = networkWithSnapshots([
    { type: "snapshot", t: 1000, players: [], projectiles: [{ id: 7, ownerId: "remote", x: 100, y: 50, vx: 680, vy: 0 }] },
    { type: "snapshot", t: 1066, players: [], projectiles: [{ id: 7, ownerId: "remote", x: 145, y: 50, vx: 680, vy: 0 }] },
  ]);

  network.discardProjectile(7);

  assert.equal(network.interpolatedSnapshot(1116, "local").projectiles.length, 0);
  assert.ok(network.snapshots.every((snapshot) => snapshot.projectiles.length === 0));
});

test("server clock offset is applied before choosing the interpolation window", () => {
  const network = networkWithSnapshots([
    { type: "snapshot", t: 1000, players: [{ id: "remote", x: 0, y: 0, vx: 100, vy: 0, aimX: 1, aimY: 0, alive: true }], projectiles: [] },
    { type: "snapshot", t: 1100, players: [{ id: "remote", x: 10, y: 0, vx: 100, vy: 0, aimX: 1, aimY: 0, alive: true }], projectiles: [] },
  ]);
  network.clockOffsetMs = 5000;
  const snapshot = network.interpolatedSnapshot(6150, "local");
  assert.ok(Math.abs(snapshot.players[0].x - 5) < .001);
});

test("snapshot receipt records a monotonic prediction cutoff without adding wire fields", () => {
  const network = networkWithSnapshots([]);
  network.rtt = 80;
  const snapshot = { type: "snapshot", t: 1000, players: [], projectiles: [] };
  network.recordSnapshot(snapshot);
  assert.ok(snapshot.clientReceivedAt >= snapshot.predictionCutoffAt);
  assert.ok(Math.abs(snapshot.clientReceivedAt - snapshot.predictionCutoffAt - 40) < .01);
  assert.equal(JSON.stringify(snapshot).includes("predictionCutoffAt"), false);
});

test("remote movement extrapolates briefly instead of freezing between delayed snapshots", () => {
  const network = networkWithSnapshots([
    { type: "snapshot", t: 1000, players: [{ id: "remote", x: 100, y: 50, vx: 165, vy: 0, aimX: 1, aimY: 0, alive: true }], projectiles: [] },
  ]);
  const player = network.interpolatedSnapshot(1150, "local").players[0];
  assert.ok(Math.abs(player.x - 108.25) < .001);
});

test("teleports and respawns snap rather than interpolating across the map", () => {
  const network = networkWithSnapshots([
    { type: "snapshot", t: 1000, players: [{ id: "remote", x: 100, y: 50, vx: 0, vy: 0, aimX: 1, aimY: 0, alive: false }], projectiles: [] },
    { type: "snapshot", t: 1100, players: [{ id: "remote", x: 900, y: 700, vx: 0, vy: 0, aimX: -1, aimY: 0, alive: true }], projectiles: [] },
  ]);
  const player = network.interpolatedSnapshot(1150, "local").players[0];
  assert.equal(player.x, 900); assert.equal(player.y, 700); assert.equal(player.alive, true);
});

test("aim interpolation takes the shortest arc without collapsing at 180 degrees", () => {
  const network = networkWithSnapshots([
    { type: "snapshot", t: 1000, players: [{ id: "remote", x: 100, y: 50, vx: 0, vy: 0, aimX: -.985, aimY: .174, alive: true }], projectiles: [] },
    { type: "snapshot", t: 1100, players: [{ id: "remote", x: 100, y: 50, vx: 0, vy: 0, aimX: -.985, aimY: -.174, alive: true }], projectiles: [] },
  ]);
  const aim = network.interpolatedSnapshot(1150, "local").players[0];
  assert.ok(aim.aimX < -.999); assert.ok(Math.abs(aim.aimY) < .01);
});
