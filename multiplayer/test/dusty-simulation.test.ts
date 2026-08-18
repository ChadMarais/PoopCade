import assert from "node:assert/strict";
import test from "node:test";
import { distanceToPolygon, pointInPolygon } from "../../games/game-03/collision-geometry.js";
import { DUSTY_GAMEPLAY } from "../src/dusty-gameplay.ts";
import { DUSTY_CANONICAL_COLLISION, DUSTY_PLAYER_HIT_RADIUS, DUSTY_POLYGONS, DUSTY_SATELLITES } from "../src/dusty-map.ts";
import { DustyOrbitSimulation, DUSTY_FIXED_DT, DUSTY_MAX_HIT_REWIND_MS, DUSTY_RESPAWN_MS, DUSTY_SPAWN_PROTECTION_MS } from "../src/dusty-simulation.ts";

function input(seq: number, moveX: number, moveY: number, aimX: number, aimY: number, fire = false) {
  return { type: "input" as const, seq, moveX, moveY, aimX, aimY, fire };
}

function intentInput(seq: number, aimX: number, aimY: number, intents: Array<{ id: number; loadoutId: number; fireStateId: number; aimX: number; aimY: number }>, fire = true) {
  return { type: "input" as const, seq, moveX: 0, moveY: 0, aimX, aimY, fire, fireMode: "intent-v1" as const, fireIntents: intents };
}

test("server imports canonical environment JSON for every live Lunar map instance", () => {
  assert.equal(DUSTY_CANONICAL_COLLISION.normalizedPointCount, 19);
  assert.equal(DUSTY_CANONICAL_COLLISION.instanceCount, 13);
  assert.deepEqual(DUSTY_CANONICAL_COLLISION.definitions.map((item) => item.normalizedPointCount), [19, 13, 13, 12, 8, 18, 12, 8, 8]);
  assert.equal(DUSTY_POLYGONS.length, 13);
  assert.equal(DUSTY_POLYGONS[0].length, 19);
  assert.equal(DUSTY_POLYGONS[0][0].x, 615.704);
  assert.equal(DUSTY_POLYGONS[0][0].y, 585.836);
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

test("authoritative movement retains sparse 10 Hz state and still neutralizes after the 300 ms safety timeout", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000026", "Guest-0026", 1000);
  player.x = 400; player.y = 400;
  for (let tick = 0; tick <= 9; tick++) {
    const now = 1000 + tick * 100 / 3;
    if (tick % 3 === 0) simulation.applyInput(player.id, input(tick + 1, 1, 0, 1, 0), now);
    simulation.step(DUSTY_FIXED_DT, now);
    assert.ok(player.vx > 0, `held movement stopped at tick ${tick}`);
  }
  for (let tick = 10; tick <= 18; tick++) simulation.step(DUSTY_FIXED_DT, 1000 + tick * 100 / 3);
  assert.ok(player.vx > 0, "movement remains held through exactly 300 ms without a refresh");
  simulation.step(DUSTY_FIXED_DT, 1000 + 19 * 100 / 3);
  assert.equal(player.vx, 0, "missing refresh safely neutralizes movement after 300 ms");
});

test("late and duplicate sparse packets cannot overwrite a newer input sequence", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000027", "Guest-0027", 1000);
  assert.equal(simulation.applyInput(player.id, input(10, 1, 0, 1, 0), 1000), true);
  assert.equal(simulation.applyInput(player.id, input(9, -1, 0, -1, 0), 1001), false);
  assert.equal(simulation.applyInput(player.id, input(10, -1, 0, -1, 0), 1002), false);
  simulation.step(DUSTY_FIXED_DT, 1034);
  assert.ok(player.vx > 0);
  assert.equal(player.lastInputSeq, 10);
});

test("jittered held-fire intents keep every authoritative SMG round tied to its displayed aim", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000017", "Guest-0017", 1000);
  player.weaponTier = 4;
  player.protectedUntil = 0;

  const samples = [
    { seq: 1, receivedAt: 1000, aimX: 1, aimY: 0 },
    { seq: 2, receivedAt: 1220, aimX: Math.SQRT1_2, aimY: -Math.SQRT1_2 },
    { seq: 3, receivedAt: 1440, aimX: 0, aimY: -1 },
  ];
  for (const sample of samples) {
    simulation.applyInput(player.id, intentInput(sample.seq, sample.aimX, sample.aimY, [
      { id: sample.seq, loadoutId: 1, fireStateId: 1, aimX: sample.aimX, aimY: sample.aimY },
    ]), sample.receivedAt);
    // A normal 30Hz server tick processes the input after it was received. The
    // network delay must not invalidate a cadence-correct intent.
    simulation.step(DUSTY_FIXED_DT, sample.receivedAt + 34);
  }

  const events = simulation.drainEvents();
  const shots = events.filter((event) => event.type === "shot") as Array<{
    fireIntentId: number; aimX: number; aimY: number; projectile: { inputSeq: number; vx: number; vy: number; fireIntentId: number };
  }>;
  assert.equal(shots.length, 3);
  assert.deepEqual(shots.map((shot) => shot.fireIntentId), [1, 2, 3]);
  assert.deepEqual(shots.map((shot) => shot.projectile.inputSeq), [1, 2, 3]);
  assert.ok(shots[0].projectile.vx > 699 && Math.abs(shots[0].projectile.vy) < .001);
  assert.ok(shots[1].projectile.vx > 494 && shots[1].projectile.vy < -494);
  assert.ok(shots[2].projectile.vy < -699 && Math.abs(shots[2].projectile.vx) < .001,
    "the newest northbound round must not inherit either earlier held-fire aim");
  const you = simulation.snapshot(player.id, 1474).you as any;
  assert.equal(you.weapon.tier, 4);
  assert.equal(you.weapon.cooldownMs, 220);
  assert.equal(you.weaponState.lastFireIntentId, 3);
  assert.equal(events.some((event) => event.type === "fire_intent_rejected"), false);
});

test("jittered Burst intents survive 30Hz processing delay and resample the barrel each round", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000019", "Guest-0019", 1000);
  player.weaponTier = 3;
  player.protectedUntil = 0;
  const samples = [
    { seq: 1, receivedAt: 1000, aimX: 1, aimY: 0 },
    { seq: 2, receivedAt: 1090, aimX: 0, aimY: -1 },
    { seq: 3, receivedAt: 1180, aimX: -1, aimY: 0 },
  ];
  for (const sample of samples) {
    simulation.applyInput(player.id, intentInput(sample.seq, sample.aimX, sample.aimY, [
      { id: sample.seq, loadoutId: 1, fireStateId: 1, aimX: sample.aimX, aimY: sample.aimY },
    ]), sample.receivedAt);
    simulation.step(DUSTY_FIXED_DT, sample.receivedAt + 34);
  }

  const events = simulation.drainEvents();
  const shots = events.filter((event) => event.type === "shot") as Array<any>;
  assert.deepEqual(shots.map((shot) => shot.fireIntentId), [1, 2, 3]);
  assert.deepEqual(shots.map((shot) => shot.projectile.inputSeq), [1, 2, 3]);
  assert.ok(shots[0].projectile.vx > 649 && Math.abs(shots[0].projectile.vy) < .001);
  assert.ok(shots[1].projectile.vy < -649 && Math.abs(shots[1].projectile.vx) < .001);
  assert.ok(shots[2].projectile.vx < -649 && Math.abs(shots[2].projectile.vy) < .001);
  assert.equal(events.some((event) => event.type === "fire_intent_rejected"), false);
});

test("one Shotgun intent echoes stable pellet indices across the authoritative spread group", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000018", "Guest-0018", 1000);
  player.weaponTier = 5;
  player.protectedUntil = 0;
  simulation.applyInput(player.id, intentInput(1, 1, 0, [{ id: 1, loadoutId: 1, fireStateId: 1, aimX: 1, aimY: 0 }]), 1000);
  simulation.step(DUSTY_FIXED_DT, 1000);
  const shots = simulation.drainEvents().filter((event) => event.type === "shot") as Array<any>;
  assert.equal(shots.length, 3);
  assert.deepEqual(shots.map((shot) => shot.fireIntentId), [1, 1, 1]);
  assert.deepEqual(shots.map((shot) => shot.pelletIndex), [0, 1, 2]);
  assert.ok(shots.every((shot) => shot.pelletCount === 3 && shot.projectile.fireIntentId === 1));
});

test("fire intents cannot cross loadouts or disagree with the visible barrel aim", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000020", "Guest-0020", 1000);
  player.weaponTier = 4;
  player.loadoutId = 4;
  player.protectedUntil = 0;

  simulation.applyInput(player.id, intentInput(1, 1, 0, [
    { id: 1, loadoutId: 3, fireStateId: 1, aimX: 1, aimY: 0 },
  ]), 1000);
  simulation.applyInput(player.id, intentInput(2, 1, 0, [
    { id: 2, loadoutId: 4, fireStateId: 1, aimX: 0, aimY: -1 },
  ]), 1001);
  simulation.step(DUSTY_FIXED_DT, 1034);

  const events = simulation.drainEvents();
  const rejected = events.filter((event) => event.type === "fire_intent_rejected") as Array<any>;
  assert.deepEqual(rejected.map(({ fireIntentId, loadoutId, reason }) => ({ fireIntentId, loadoutId, reason })), [
    { fireIntentId: 1, loadoutId: 4, reason: "loadout-changed" },
    { fireIntentId: 2, loadoutId: 4, reason: "aim-mismatch" },
  ]);
  assert.equal(events.some((event) => event.type === "shot"), false);
  assert.equal(player.pendingFireIntents.length, 0);
  assert.equal(player.lastFireIntentId, 2);
});

test("a rejected fire intent advances the receive watermark and cannot amplify events by replay", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000025", "Guest-0025", 1000);
  player.weaponTier = 4;
  player.protectedUntil = 0;
  simulation.drainEvents();

  const rejectedIntent = { id: 1, loadoutId: 99, fireStateId: 1, aimX: 1, aimY: 0 };
  simulation.applyInput(player.id, intentInput(1, 1, 0, [rejectedIntent]), 1000);
  const firstEvents = simulation.drainEvents();
  assert.deepEqual(firstEvents.filter((event) => event.type === "fire_intent_rejected").map((event: any) => ({
    fireIntentId: event.fireIntentId,
    reason: event.reason,
  })), [{ fireIntentId: 1, reason: "loadout-changed" }]);
  assert.equal(player.lastFireIntentId, 1);

  simulation.applyInput(player.id, intentInput(2, 1, 0, [rejectedIntent]), 1001);
  assert.deepEqual(simulation.drainEvents(), [], "replaying a rejected ID must be a silent no-op");
  assert.equal(player.lastFireIntentId, 1);

  simulation.applyInput(player.id, intentInput(3, 0, -1, [
    { id: 2, loadoutId: 1, fireStateId: 1, aimX: 0, aimY: -1 },
  ]), 1002);
  simulation.step(DUSTY_FIXED_DT, 1034);
  const nextEvents = simulation.drainEvents();
  const shot = nextEvents.find((event: any) => event.type === "shot" && event.fireIntentId === 2) as any;
  assert.ok(shot, "the next fresh ID remains usable after the rejected watermark");
  assert.ok(shot.projectile.vy < -699 && Math.abs(shot.projectile.vx) < .001);
});

test("dead players reject fire intents instead of queueing them for respawn", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000021", "Guest-0021", 1000);
  player.alive = false;
  player.hp = 0;
  player.respawnAt = 5000;

  simulation.applyInput(player.id, intentInput(1, 1, 0, [
    { id: 1, loadoutId: 1, fireStateId: 1, aimX: 1, aimY: 0 },
  ]), 1000);

  const events = simulation.drainEvents();
  assert.ok(events.some((event: any) => event.type === "fire_intent_rejected" &&
    event.fireIntentId === 1 && event.reason === "player-inactive"));
  assert.equal(player.pendingFireIntents.length, 0);
  assert.equal(simulation.projectiles.length, 0);
});

test("reconnect invalidates fire-state intents captured by the previous connection", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000023", "Guest-0023", 1000);
  player.protectedUntil = 0;
  simulation.prepareConnection(player.id, 1100);
  assert.equal(player.fireStateId, 2);

  simulation.applyInput(player.id, intentInput(1, 1, 0, [
    { id: 1, loadoutId: 1, fireStateId: 1, aimX: 1, aimY: 0 },
  ]), 1101);
  simulation.step(DUSTY_FIXED_DT, 1134);

  const events = simulation.drainEvents();
  assert.ok(events.some((event: any) => event.type === "fire_intent_rejected" &&
    event.fireIntentId === 1 && event.fireStateId === 2 && event.reason === "fire-state-changed"));
  assert.equal(events.some((event) => event.type === "shot"), false);
  assert.equal(player.pendingFireIntents.length, 0);
});

test("blocked mole emergence and release discard stale aim before a clean repress", () => {
  const simulation = new DustyOrbitSimulation();
  for (const pickup of simulation.pickups) { pickup.active = false; pickup.respawnAt = 9999; }
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000022", "Guest-0022", 1000);
  player.weaponTier = 4;
  player.protectedUntil = 0;
  const safe = { x: player.x, y: player.y };
  const blocked = DUSTY_POLYGONS[0].reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  player.x = blocked.x / DUSTY_POLYGONS[0].length;
  player.y = blocked.y / DUSTY_POLYGONS[0].length;
  player.moleMode = true;
  player.moleUntil = 5000;
  player.lastFireInput = false;

  simulation.applyInput(player.id, intentInput(1, 1, 0, [
    { id: 1, loadoutId: 1, fireStateId: 1, aimX: 1, aimY: 0 },
  ]), 1000);
  simulation.step(DUSTY_FIXED_DT, 1034);
  simulation.applyInput(player.id, intentInput(2, -1, 0, [], false), 1068);
  simulation.step(DUSTY_FIXED_DT, 1102);
  simulation.applyInput(player.id, intentInput(3, -1, 0, [
    { id: 2, loadoutId: 1, fireStateId: 2, aimX: -1, aimY: 0 },
  ]), 1136);
  // A release can supersede the unprocessed press before the next server tick.
  // Its queued west-facing intent must be explicitly discarded.
  simulation.applyInput(player.id, intentInput(4, -1, 0, [], false), 1170);
  simulation.step(DUSTY_FIXED_DT, 1204);

  player.x = safe.x;
  player.y = safe.y;
  simulation.applyInput(player.id, intentInput(5, 0, -1, [
    { id: 3, loadoutId: 1, fireStateId: 3, aimX: 0, aimY: -1 },
  ]), 1238);
  simulation.step(DUSTY_FIXED_DT, 1272);

  const events = simulation.drainEvents();
  const rejected = events.filter((event) => event.type === "fire_intent_rejected") as Array<any>;
  assert.ok(rejected.some((event) => event.fireIntentId === 1 && event.reason === "mole-emergence-blocked"));
  assert.ok(rejected.some((event) => event.fireIntentId === 2 && event.reason === "mole-fire-released"));
  const shots = events.filter((event) => event.type === "shot") as Array<any>;
  assert.equal(shots.length, 1);
  assert.equal(shots[0].fireIntentId, 3);
  assert.equal(shots[0].projectile.inputSeq, 5);
  assert.ok(shots[0].projectile.vy < -699 && Math.abs(shots[0].projectile.vx) < .001,
    "the clean repress must use its north-facing aim, not either discarded mole aim");
  assert.equal(player.moleMode, false);
  assert.equal(player.pendingFireIntents.length, 0);
});

test("packet-bunched held input preserves the mole emergence intent from the preceding sequence", () => {
  const simulation = new DustyOrbitSimulation();
  for (const pickup of simulation.pickups) { pickup.active = false; pickup.respawnAt = 9999; }
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000024", "Guest-0024", 1000);
  player.weaponTier = 4;
  player.protectedUntil = 0;
  player.moleMode = true;
  player.moleUntil = 5000;
  player.lastFireInput = false;

  simulation.applyInput(player.id, intentInput(1, 1, 0, [
    { id: 1, loadoutId: 1, fireStateId: 1, aimX: 1, aimY: 0 },
  ]), 1000);
  // A subsequent 60Hz held-fire sample can arrive before the 30Hz Worker
  // step. It carries no new cadence intent and must not expire seq 1.
  simulation.applyInput(player.id, intentInput(2, 0, -1, []), 1001);
  simulation.step(DUSTY_FIXED_DT, 1034);

  const events = simulation.drainEvents();
  const shots = events.filter((event) => event.type === "shot") as Array<any>;
  assert.equal(events.some((event) => event.type === "fire_intent_rejected"), false);
  assert.equal(shots.length, 1);
  assert.equal(shots[0].fireIntentId, 1);
  assert.equal(shots[0].projectile.inputSeq, 1);
  assert.ok(shots[0].projectile.vx > 699 && Math.abs(shots[0].projectile.vy) < .001,
    "the emergence shot must preserve seq 1's captured east-facing barrel");
  assert.equal(player.moleMode, false);
  assert.equal(player.pendingFireIntents.length, 0);
});

test("packet-bunched stale fire-state rejection leaves mole emergence underground and retryable", () => {
  const simulation = new DustyOrbitSimulation();
  for (const pickup of simulation.pickups) { pickup.active = false; pickup.respawnAt = 9999; }
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000026", "Guest-0026", 1000);
  player.weaponTier = 4;
  player.protectedUntil = 0;
  player.moleMode = true;
  player.moleUntil = 5000;
  player.lastFireInput = false;
  player.fireStateId = 2;
  simulation.drainEvents();

  simulation.applyInput(player.id, intentInput(1, 1, 0, [
    { id: 1, loadoutId: 1, fireStateId: 1, aimX: 1, aimY: 0 },
  ]), 1000);
  // A held sample with no new cadence intent can overtake the rejected rising
  // edge before the Worker step. It must not cause a shotless emergence.
  simulation.applyInput(player.id, intentInput(2, 1, 0, []), 1001);
  simulation.step(DUSTY_FIXED_DT, 1034);

  const rejectedEvents = simulation.drainEvents();
  assert.deepEqual(rejectedEvents.filter((event) => event.type === "fire_intent_rejected").map((event: any) => ({
    fireIntentId: event.fireIntentId,
    fireStateId: event.fireStateId,
    reason: event.reason,
  })), [{ fireIntentId: 1, fireStateId: 2, reason: "fire-state-changed" }]);
  assert.equal(rejectedEvents.some((event) => event.type === "shot" || event.type === "mole_emerged"), false);
  assert.equal(player.moleMode, true, "the stale rejected press must leave the player underground");
  assert.equal(player.lastFireInput, false, "the held emergence edge must remain retryable after resync");
  assert.equal(player.pendingFireIntents.length, 0);

  simulation.applyInput(player.id, intentInput(3, 0, -1, [
    { id: 2, loadoutId: 1, fireStateId: 2, aimX: 0, aimY: -1 },
  ]), 1068);
  simulation.step(DUSTY_FIXED_DT, 1102);

  const retryEvents = simulation.drainEvents();
  assert.equal(retryEvents.some((event) => event.type === "fire_intent_rejected"), false);
  assert.ok(retryEvents.some((event: any) => event.type === "mole_emerged" && event.reason === "manual"));
  const shot = retryEvents.find((event: any) => event.type === "shot" && event.fireIntentId === 2) as any;
  assert.ok(shot, "a fresh intent carrying fire state 2 must emerge and fire while the control remains held");
  assert.equal(shot.projectile.inputSeq, 3);
  assert.ok(shot.projectile.vy < -699 && Math.abs(shot.projectile.vx) < .001);
  assert.equal(player.moleMode, false);
  assert.equal(player.pendingFireIntents.length, 0);
});

test("full projectile capacity keeps a valid Shotgun mole ambush underground until all pellets fit", () => {
  const simulation = new DustyOrbitSimulation();
  for (const pickup of simulation.pickups) { pickup.active = false; pickup.respawnAt = 9999; }
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000027", "Guest-0027", 1000);
  player.weaponTier = 5;
  player.protectedUntil = 0;
  player.moleMode = true;
  player.moleUntil = 5000;
  player.lastFireInput = false;
  simulation.drainEvents();
  for (let index = 0; index < DUSTY_GAMEPLAY.maxProjectiles; index++) {
    simulation.projectiles.push({
      id: 1000 + index, ownerId: player.id, tier: 1,
      x: player.x, y: player.y, vx: 0, vy: 0,
      radius: 3, damage: 1, spawnedAt: 0, expiresAt: 9999,
    });
  }
  assert.equal(simulation.projectiles.length, 300);

  simulation.applyInput(player.id, intentInput(1, 1, 0, [
    { id: 1, loadoutId: 1, fireStateId: 1, aimX: 1, aimY: 0 },
  ]), 1000);
  simulation.step(DUSTY_FIXED_DT, 1034);

  const blockedEvents = simulation.drainEvents();
  assert.equal(blockedEvents.some((event) => event.type === "shot" || event.type === "mole_emerged" || event.type === "fire_intent_rejected"), false);
  assert.equal(player.moleMode, true);
  assert.equal(player.lastFireInput, false);
  assert.equal(player.pendingFireIntents.length, 1, "the valid ambush intent must remain queued, not consumed");
  assert.equal(simulation.projectiles.length, 300);

  simulation.projectiles.splice(0, 3);
  simulation.step(DUSTY_FIXED_DT, 1068);
  const firedEvents = simulation.drainEvents();
  const shots = firedEvents.filter((event: any) => event.type === "shot" && event.fireIntentId === 1) as Array<any>;
  assert.ok(firedEvents.some((event: any) => event.type === "mole_emerged" && event.reason === "manual"));
  assert.equal(shots.length, 3, "all three Shotgun pellets must fit and launch atomically");
  assert.deepEqual(shots.map((shot) => shot.pelletIndex), [0, 1, 2]);
  assert.equal(player.moleMode, false);
  assert.equal(player.pendingFireIntents.length, 0);
  assert.equal(simulation.projectiles.length, 300);
});

test("cooldown drift preserves a valid mole ambush edge until its authoritative trigger time", () => {
  const simulation = new DustyOrbitSimulation();
  for (const pickup of simulation.pickups) { pickup.active = false; pickup.respawnAt = 9999; }
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000028", "Guest-0028", 1000);
  player.weaponTier = 4;
  player.protectedUntil = 0;
  player.moleMode = true;
  player.moleUntil = 5000;
  player.lastFireInput = false;
  player.lastFireAt = 1000;
  simulation.drainEvents();

  simulation.applyInput(player.id, intentInput(1, 0, -1, [
    { id: 1, loadoutId: 1, fireStateId: 1, aimX: 0, aimY: -1 },
  ]), 1100);
  simulation.step(DUSTY_FIXED_DT, 1134);
  const coolingEvents = simulation.drainEvents();
  assert.equal(coolingEvents.some((event) => event.type === "shot" || event.type === "mole_emerged" || event.type === "fire_intent_rejected"), false);
  assert.equal(player.moleMode, true);
  assert.equal(player.lastFireInput, false);
  assert.equal(player.pendingFireIntents.length, 1);

  simulation.step(DUSTY_FIXED_DT, 1220);
  const readyEvents = simulation.drainEvents();
  assert.ok(readyEvents.some((event: any) => event.type === "mole_emerged" && event.reason === "manual"));
  const shot = readyEvents.find((event: any) => event.type === "shot" && event.fireIntentId === 1) as any;
  assert.ok(shot);
  assert.ok(shot.projectile.vy < -699 && Math.abs(shot.projectile.vx) < .001);
  assert.equal(player.moleMode, false);
  assert.equal(player.pendingFireIntents.length, 0);
});

test("server swept projectile collision stops Pea Shooter shots at canonical rocks", () => {
  const simulation = new DustyOrbitSimulation();
  const player = simulation.addPlayer("10000000-0000-4000-8000-000000000002", "Guest-0002", 1000);
  player.x = 1500;
  player.y = 200;
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
  attacker.x = 1450; attacker.y = 1800;
  victim.x = 1650; victim.y = 1831;
  simulation.step(DUSTY_FIXED_DT, 1000);
  victim.y = 1886;
  simulation.step(DUSTY_FIXED_DT, 1100);

  simulation.projectiles.push({
    id: 501, ownerId: attacker.id, tier: 1, x: 1630, y: 1831, vx: 1200, vy: 0,
    radius: 3, damage: 1, spawnedAt: 1100, expiresAt: 9999, rewindMs: 100,
  });
  simulation.step(DUSTY_FIXED_DT, 1134);
  assert.equal(victim.hp, 2, "the shot crosses the victim's 100ms-rewound visible position");
  assert.ok(simulation.drainEvents().some((event) => event.type === "impact" && event.target === "player"));

  victim.hp = 3;
  simulation.projectiles.push({
    id: 502, ownerId: attacker.id, tier: 1, x: 1630, y: 1831, vx: 1200, vy: 0,
    radius: 3, damage: 1, spawnedAt: 1134, expiresAt: 9999, rewindMs: 0,
  });
  simulation.step(DUSTY_FIXED_DT, 1168);
  assert.equal(victim.hp, 3, "the same segment misses the victim's newer hidden server position without rewind");
  assert.equal(DUSTY_MAX_HIT_REWIND_MS, 250);
});

test("combat hit radius covers the opaque player body instead of the smaller movement circle", () => {
  const simulation = new DustyOrbitSimulation();
  for (const pickup of simulation.pickups) { pickup.active = false; pickup.respawnAt = 9999; }
  const attacker = simulation.addPlayer("10000000-0000-4000-8000-000000000010", "Guest-0010", 1000);
  const victim = simulation.addPlayer("10000000-0000-4000-8000-000000000011", "Guest-0011", 1000);
  attacker.protectedUntil = 0; victim.protectedUntil = 0;
  attacker.x = 100; attacker.y = 100; victim.x = 120; victim.y = 133;
  simulation.step(DUSTY_FIXED_DT, 1000);
  simulation.projectiles.push({
    id: 601, ownerId: attacker.id, tier: 1, x: 100, y: 100, vx: 1200, vy: 0,
    radius: 3, damage: 1, spawnedAt: 1000, expiresAt: 9999,
  });
  simulation.step(DUSTY_FIXED_DT, 1034);
  assert.equal(DUSTY_PLAYER_HIT_RADIUS, 34);
  assert.equal(victim.hp, 2, "a round crossing opaque character art must count as a hit");
});

test("projectiles sweep against a moving player's whole tick path", () => {
  const simulation = new DustyOrbitSimulation();
  for (const pickup of simulation.pickups) { pickup.active = false; pickup.respawnAt = 9999; }
  const attacker = simulation.addPlayer("10000000-0000-4000-8000-000000000012", "Guest-0012", 1000);
  const victim = simulation.addPlayer("10000000-0000-4000-8000-000000000013", "Guest-0013", 1000);
  attacker.protectedUntil = 0; victim.protectedUntil = 0;
  attacker.x = 100; attacker.y = 100; victim.x = 130; victim.y = 131; victim.speedUntil = 5000;
  simulation.step(DUSTY_FIXED_DT, 1000);
  simulation.applyInput(victim.id, input(1, 0, 1, 1, 0), 1034);
  simulation.projectiles.push({
    id: 602, ownerId: attacker.id, tier: 6, x: 100, y: 100, vx: 1200, vy: 0,
    radius: 6, damage: 2, spawnedAt: 1000, expiresAt: 9999,
  });
  simulation.step(DUSTY_FIXED_DT, 1034);
  assert.equal(victim.y, 142);
  assert.ok(Math.abs(victim.y - 100) > DUSTY_PLAYER_HIT_RADIUS + 6, "the target's final position alone is a miss");
  assert.equal(victim.hp, 1, "crossing trajectories must hit even when the target's final position misses the projectile segment");
  assert.ok(simulation.drainEvents().some((event) => event.type === "impact" && event.target === "player"));
});

test("a projectile beginning inside a player damages immediately instead of emerging through them", () => {
  const simulation = new DustyOrbitSimulation();
  for (const pickup of simulation.pickups) { pickup.active = false; pickup.respawnAt = 9999; }
  const attacker = simulation.addPlayer("10000000-0000-4000-8000-000000000014", "Guest-0014", 1000);
  const victim = simulation.addPlayer("10000000-0000-4000-8000-000000000015", "Guest-0015", 1000);
  attacker.protectedUntil = 0; victim.protectedUntil = 0;
  attacker.x = 100; attacker.y = 100; victim.x = 120; victim.y = 100;
  simulation.step(DUSTY_FIXED_DT, 1000);
  simulation.projectiles.push({
    id: 603, ownerId: attacker.id, tier: 1, x: 120, y: 100, vx: 1, vy: 0,
    radius: 3, damage: 1, spawnedAt: 1000, expiresAt: 9999,
  });
  simulation.step(DUSTY_FIXED_DT, 1034);
  assert.equal(victim.hp, 2);
  assert.equal(simulation.projectiles.some((projectile) => projectile.id === 603), false);
});

test("spawn protection absorbs projectiles without losing HP", () => {
  const simulation = new DustyOrbitSimulation();
  for (const pickup of simulation.pickups) { pickup.active = false; pickup.respawnAt = 9999; }
  const attacker = simulation.addPlayer("10000000-0000-4000-8000-000000000016", "Guest-0016", 1000);
  const victim = simulation.addPlayer("10000000-0000-4000-8000-000000000017", "Guest-0017", 1000);
  attacker.protectedUntil = 0; victim.protectedUntil = 5000;
  attacker.x = 100; attacker.y = 100; victim.x = 130; victim.y = 100;
  simulation.step(DUSTY_FIXED_DT, 1000);
  simulation.projectiles.push({
    id: 604, ownerId: attacker.id, tier: 1, x: 100, y: 100, vx: 1200, vy: 0,
    radius: 3, damage: 1, spawnedAt: 1000, expiresAt: 9999,
  });
  simulation.step(DUSTY_FIXED_DT, 1034);
  const events = simulation.drainEvents();
  assert.equal(victim.hp, 3, "spawn protection must still prevent damage");
  assert.equal(simulation.projectiles.some((projectile) => projectile.id === 604), false, "the protected body must stop the round");
  assert.ok(events.some((event) => event.type === "impact" && event.target === "player"));
  assert.equal(events.some((event) => event.type === "player_hit" && event.playerId === victim.id), false);
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
