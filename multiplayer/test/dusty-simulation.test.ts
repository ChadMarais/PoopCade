import assert from "node:assert/strict";
import test from "node:test";
import { distanceToPolygon, pointInPolygon } from "../../games/game-03/collision-geometry.js";
import { DUSTY_CANONICAL_COLLISION, DUSTY_POLYGONS, DUSTY_SATELLITES } from "../src/dusty-map.ts";
import { DustyOrbitSimulation, DUSTY_FIXED_DT, DUSTY_MAX_HIT_REWIND_MS, DUSTY_RESPAWN_MS, DUSTY_SPAWN_PROTECTION_MS } from "../src/dusty-simulation.ts";

function input(seq: number, moveX: number, moveY: number, aimX: number, aimY: number, fire = false) {
  return { type: "input" as const, seq, moveX, moveY, aimX, aimY, fire };
}

test("server imports canonical rock and satellite JSON for all eight scaled instances", () => {
  assert.equal(DUSTY_CANONICAL_COLLISION.normalizedPointCount, 19);
  assert.equal(DUSTY_CANONICAL_COLLISION.instanceCount, 8);
  assert.deepEqual(DUSTY_CANONICAL_COLLISION.definitions.map((item) => item.normalizedPointCount), [19, 13, 13]);
  assert.equal(DUSTY_POLYGONS.length, 8);
  assert.equal(DUSTY_POLYGONS[0].length, 19);
  assert.equal(DUSTY_POLYGONS[0][0].x, 557.6);
  assert.equal(DUSTY_POLYGONS[0][0].y, 453.576);
});

test("east and west satellites retain independent canonical collision definitions", () => {
  const [west, east] = DUSTY_SATELLITES;
  assert.equal(west.assetId, "satellite-relay-01");
  assert.equal(east.assetId, "satellite-relay-01-left");
  assert.equal(west.polygon.length, 13);
  assert.equal(east.polygon.length, 13);
  assert.notDeepEqual(west.polygon, east.polygon);
  assert.ok(west.polygon.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.ok(east.polygon.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test("authoritative movement slides a 17-unit player circle and never enters rock polygons", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000001", "Guest-0001", 1000);
  player.x = 1350;
  player.y = 260;
  for (let step = 0; step < 50; step++) {
    const now = 1000 + step * 34;
    simulation.applyInput(player.id, input(step + 1, 0, 1, 1, 0), now);
    simulation.step(DUSTY_FIXED_DT, now);
  }
  assert.equal(pointInPolygon(player, DUSTY_POLYGONS[1]), false);
  assert.ok(distanceToPolygon(player, DUSTY_POLYGONS[1]) >= 16.99);
});

test("input acknowledgement advances only when the newest pending intent is simulated", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000006", "Guest-0006", 1000);
  simulation.applyInput(player.id, input(1, 1, 0, 1, 0), 1000);
  simulation.applyInput(player.id, input(2, 1, 0, 1, 0), 1001);
  assert.equal((simulation.snapshot(player.id, 1001).you as { ack: number }).ack, 0);
  simulation.step(DUSTY_FIXED_DT, 1034);
  assert.equal((simulation.snapshot(player.id, 1034).you as { ack: number }).ack, 2);
});

test("a reconnect neutralizes stale movement and fire without resetting its input sequence", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000007", "Guest-0007", 1000);
  player.protectedUntil = 0;
  simulation.applyInput(player.id, input(1, 1, 0, 1, 0, true), 1000);
  simulation.step(DUSTY_FIXED_DT, 1000);
  assert.equal(player.lastInputSeq, 1);
  assert.ok(player.vx > 0);
  simulation.prepareConnection(player.id, 1010);
  assert.equal(player.lastInputSeq, 1);
  assert.equal(player.lastProcessedInputSeq, 1);
  assert.equal(player.input.fire, false);
  assert.equal(player.input.moveX, 0);
  assert.equal(player.vx, 0);
});

test("server swept projectile collision stops Pea Shooter shots at canonical rocks", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000002", "Guest-0002", 1000);
  player.x = 1350;
  player.y = 270;
  player.protectedUntil = 0;
  simulation.applyInput(player.id, input(1, 0, 0, 0, 1, true), 1000);
  simulation.step(DUSTY_FIXED_DT, 1000);
  assert.equal(simulation.projectiles.length, 1);
  for (let step = 1; step < 10 && simulation.projectiles.length; step++) simulation.step(DUSTY_FIXED_DT, 1000 + step * 34);
  assert.equal(simulation.projectiles.length, 0);
  const events = simulation.drainEvents();
  const shot = events.find((event) => event.type === "shot") as { projectile?: { id?: number; vx?: number; vy?: number } } | undefined;
  const impact = events.find((event) => event.type === "impact" && event.target === "rock") as { projectileId?: number; ownerId?: string } | undefined;
  assert.ok(Number.isSafeInteger(shot?.projectile?.id));
  assert.ok(Number.isFinite(shot?.projectile?.vx));
  assert.ok(Number.isFinite(shot?.projectile?.vy));
  assert.equal(impact?.projectileId, shot?.projectile?.id);
  assert.equal(impact?.ownerId, player.id);
});

test("a projectile grazing outside a polygon continues and can never hit its owner", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000005", "Guest-0005", 1000);
  player.x = 1000;
  player.y = 340;
  player.protectedUntil = 0;
  simulation.applyInput(player.id, input(1, 0, 0, 1, 0, true), 1000);
  simulation.step(DUSTY_FIXED_DT, 1000);
  for (let step = 1; step < 8; step++) simulation.step(DUSTY_FIXED_DT, 1000 + step * 34);
  assert.equal(player.hp, 3);
  assert.equal(simulation.projectiles.length, 1);
  assert.ok(simulation.projectiles[0].x > 1100);
  assert.equal(simulation.drainEvents().some((event) => event.type === "impact" && event.target === "rock"), false);
});

test("bounded rewind hits the authoritative position that an online shooter actually saw", () => {
  const simulation = new DustyOrbitSimulation();
  for (const pickup of simulation.pickups) { pickup.active = false; pickup.respawnAt = 9999; }
  const attacker = simulation.addPlayer("10000000-0000-4000-8000-000000000008", "Guest-0008", 1000);
  const victim = simulation.addPlayer("10000000-0000-4000-8000-000000000009", "Guest-0009", 1000);
  attacker.protectedUntil = 0; victim.protectedUntil = 0;
  attacker.x = 1450; attacker.y = 900;
  victim.x = 1650; victim.y = 931;
  simulation.step(DUSTY_FIXED_DT, 1000);
  victim.y = 986;
  simulation.step(DUSTY_FIXED_DT, 1100);

  simulation.projectiles.push({
    id: 501, ownerId: attacker.id, tier: 1, x: 1630, y: 931, vx: 1200, vy: 0,
    radius: 3, damage: 1, spawnedAt: 1100, expiresAt: 9999, rewindMs: 100,
  });
  simulation.step(DUSTY_FIXED_DT, 1134);
  assert.equal(victim.hp, 2, "the shot crosses the victim's 100ms-rewound visible position");
  assert.ok(simulation.drainEvents().some((event) => event.type === "impact" && event.target === "player"));

  victim.hp = 3;
  simulation.projectiles.push({
    id: 502, ownerId: attacker.id, tier: 1, x: 1630, y: 931, vx: 1200, vy: 0,
    radius: 3, damage: 1, spawnedAt: 1134, expiresAt: 9999, rewindMs: 0,
  });
  simulation.step(DUSTY_FIXED_DT, 1168);
  assert.equal(victim.hp, 3, "the same segment misses the victim's newer hidden server position without rewind");
  assert.equal(DUSTY_MAX_HIT_REWIND_MS, 250);
});

test("three authoritative hits kill, preserve the killer counter, and respawn after two seconds", () => {
  const simulation = new DustyOrbitSimulation();
  const attacker = simulation.addPlayer("10000000-0000-4000-8000-000000000003", "Guest-0003", 1000);
  const victim = simulation.addPlayer("10000000-0000-4000-8000-000000000004", "Guest-0004", 1000);
  attacker.protectedUntil = 0;
  victim.protectedUntil = 0;
  attacker.aimX = 1;
  attacker.aimY = 0;
  // The weapon is mounted on the outer shoulder, so a straight-east barrel
  // line is intentionally offset from the attacker's centreline.
  victim.y = 900 + 31;
  for (let shot = 0; shot < 3; shot++) {
    const fireAt = 1000 + shot * 1100;
    simulation.applyInput(attacker.id, input(shot + 1, 0, 0, 1, 0, true), fireAt);
    for (let frame = 0; frame < 12; frame++) simulation.step(DUSTY_FIXED_DT, fireAt + frame * 34);
  }
  assert.equal(victim.alive, false);
  assert.equal(victim.hp, 0);
  assert.equal(victim.killScore, 0);
  assert.equal(attacker.kills, 1);
  const deathEvent = simulation.drainEvents().find((event) => event.type === "death") as { x?: number; y?: number } | undefined;
  assert.deepEqual({ x: deathEvent?.x, y: deathEvent?.y }, { x: 1650, y: 931 });
  assert.ok(victim.respawnAt >= 3200 + DUSTY_RESPAWN_MS);
  const respawnAt = victim.respawnAt;
  simulation.step(DUSTY_FIXED_DT, respawnAt);
  assert.equal(victim.alive, true);
  assert.equal(victim.hp, 3);
  assert.equal(victim.protectedUntil, respawnAt + DUSTY_SPAWN_PROTECTION_MS);
  assert.equal(attacker.kills, 1);
  const respawnEvent = simulation.drainEvents().find((event) => event.type === "respawn") as { playerId?: string; x?: number; y?: number } | undefined;
  assert.deepEqual({ playerId: respawnEvent?.playerId, x: respawnEvent?.x, y: respawnEvent?.y }, { playerId: victim.id, x: victim.x, y: victim.y });
});
