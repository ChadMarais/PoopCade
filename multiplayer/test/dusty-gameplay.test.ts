import assert from "node:assert/strict";
import test from "node:test";
import { pointInPolygon } from "../../games/game-03/collision-geometry.js";
import { DUSTY_GAMEPLAY, DUSTY_WEAPONS, POWERUP_TYPES, type PowerupType } from "../src/dusty-gameplay.ts";
import { DUSTY_PLAYER_RADIUS, DUSTY_POLYGONS } from "../src/dusty-map.ts";
import { DustyOrbitSimulation, DUSTY_FIXED_DT, type DustyPlayer, type DustyProjectile } from "../src/dusty-simulation.ts";

const A = "20000000-0000-4000-8000-000000000001";
const B = "20000000-0000-4000-8000-000000000002";
const C = "20000000-0000-4000-8000-000000000003";
const D = "20000000-0000-4000-8000-000000000004";
function intent(seq: number, options: Partial<{ moveX: number; moveY: number; aimX: number; aimY: number; fire: boolean; nuke: boolean }> = {}) {
  return { type: "input" as const, seq, moveX: 0, moveY: 0, aimX: 1, aimY: 0, fire: false, nuke: false, ...options };
}
function fresh(random = () => .1234) {
  const simulation = new DustyOrbitSimulation(random);
  for (const pickup of simulation.pickups) pickup.active = false;
  return simulation;
}
function add(simulation: DustyOrbitSimulation, id: string, name: string, now = 1000) {
  const player = simulation.addPlayer(id, name, now);
  player.protectedUntil = 0;
  player.x = id === A ? 300 : id === B ? 600 : 900;
  player.y = 300;
  return player;
}
function collect(simulation: DustyOrbitSimulation, player: DustyPlayer, type: PowerupType, now: number) {
  const pickup = simulation.pickups[0];
  pickup.type = type; pickup.x = player.x; pickup.y = player.y; pickup.active = true; pickup.respawnAt = 0;
  simulation.applyInput(player.id, intent(player.lastInputSeq + 1), now);
  simulation.step(DUSTY_FIXED_DT, now);
  return pickup;
}
function projectile(ownerId: string, damage = 1): DustyProjectile {
  return { id: 99, ownerId, tier: 1, x: 0, y: 0, vx: 1, vy: 0, radius: 3, damage, spawnedAt: 0, expiresAt: 9999 };
}
function eventsOf(simulation: DustyOrbitSimulation, type: string) { return simulation.drainEvents().filter((event) => event.type === type); }

test("central weapon table defines the six requested tiers and range progression", () => {
  assert.deepEqual(DUSTY_WEAPONS.map(({ tier, name, cooldownMs, speed, lifetimeMs, damage, radius, count }) => ({ tier, name, cooldownMs, speed, lifetimeMs, damage, radius, count })), [
    { tier: 1, name: "PEA SHOOTER", cooldownMs: 1000, speed: 500, lifetimeMs: 500, damage: 1, radius: 3, count: 1 },
    { tier: 2, name: "PISTOL", cooldownMs: 700, speed: 600, lifetimeMs: 750, damage: 1, radius: 3.2, count: 1 },
    { tier: 3, name: "BURST", cooldownMs: 800, speed: 650, lifetimeMs: 800, damage: 1, radius: 3.2, count: 3 },
    { tier: 4, name: "SMG", cooldownMs: 220, speed: 700, lifetimeMs: 900, damage: 1, radius: 3, count: 1 },
    { tier: 5, name: "SHOTGUN", cooldownMs: 850, speed: 700, lifetimeMs: 550, damage: 1, radius: 3, count: 5 },
    { tier: 6, name: "PLASMA CANNON", cooldownMs: 450, speed: 1200, lifetimeMs: 1000, damage: 2, radius: 6, count: 1 },
  ]);
  assert.equal(DUSTY_WEAPONS[0].speed * DUSTY_WEAPONS[0].lifetimeMs / 1000, 250);
  assert.equal(DUSTY_WEAPONS[5].speed * DUSTY_WEAPONS[5].lifetimeMs / 1000, 1200);
});

test("server schedules Burst rounds, enforces SMG cooldown, and creates the Shotgun fan", () => {
  const simulation = fresh();
  const player = add(simulation, A, "Guest-1001");
  player.weaponTier = 3;
  simulation.applyInput(A, intent(1, { fire: true }), 1000); simulation.step(DUSTY_FIXED_DT, 1000);
  assert.equal(eventsOf(simulation, "shot").length, 1);
  simulation.applyInput(A, intent(2, { fire: true }), 1100); simulation.step(DUSTY_FIXED_DT, 1100);
  simulation.applyInput(A, intent(3, { fire: true }), 1200); simulation.step(DUSTY_FIXED_DT, 1200);
  assert.equal(eventsOf(simulation, "shot").length, 2);

  simulation.projectiles.length = 0; player.weaponTier = 4; player.lastFireAt = -Infinity;
  simulation.applyInput(A, intent(4, { fire: true }), 1300); simulation.step(DUSTY_FIXED_DT, 1300);
  simulation.applyInput(A, intent(5, { fire: true }), 1400); simulation.step(DUSTY_FIXED_DT, 1400);
  assert.equal(eventsOf(simulation, "shot").length, 1);
  simulation.applyInput(A, intent(6, { fire: true }), 1530); simulation.step(DUSTY_FIXED_DT, 1530);
  assert.equal(eventsOf(simulation, "shot").length, 1);

  simulation.projectiles.length = 0; player.weaponTier = 5; player.lastFireAt = -Infinity;
  simulation.applyInput(A, intent(7, { fire: true }), 1600); simulation.step(DUSTY_FIXED_DT, 1600);
  const shots = eventsOf(simulation, "shot") as Array<{ projectile: DustyProjectile }>;
  assert.equal(shots.length, 5);
  assert.equal(new Set(shots.map((shot) => Math.round(Math.atan2(shot.projectile.vy, shot.projectile.vx) * 180 / Math.PI))).size, 5);
});

test("Plasma is server-authored at tier 6 with two damage", () => {
  const simulation = fresh(); const player = add(simulation, A, "Guest-1001"); player.weaponTier = 6;
  simulation.applyInput(A, intent(1, { fire: true }), 1000); simulation.step(DUSTY_FIXED_DT, 1000);
  const shot = eventsOf(simulation, "shot")[0] as { projectile: DustyProjectile };
  assert.equal(shot.projectile.tier, 6); assert.equal(shot.projectile.damage, 2); assert.equal(shot.projectile.radius, 6);
  assert.equal(Math.hypot(shot.projectile.vx, shot.projectile.vy), 1200);
});

test("kills upgrade, deaths downgrade one tier, and score never drops below zero", () => {
  const simulation = fresh(); const killer = add(simulation, A, "Guest-1001"); const victim = add(simulation, B, "Guest-1002");
  (simulation as any).killPlayer(victim, killer.id, 1000, "projectile");
  assert.equal(killer.kills, 1); assert.equal(killer.killScore, 1); assert.equal(killer.weaponTier, 2);
  assert.equal(victim.deaths, 1); assert.equal(victim.killScore, 0); assert.equal(victim.weaponTier, 1);
  const death = eventsOf(simulation, "death")[0] as { x: number; y: number };
  assert.deepEqual({ x: death.x, y: death.y }, { x: 600, y: 300 });
  victim.alive = true; victim.hp = 3; victim.weaponTier = 5; victim.killScore = 2;
  (simulation as any).killPlayer(victim, killer.id, 1100, "projectile");
  assert.equal(victim.weaponTier, 4); assert.equal(victim.killScore, 1);
  killer.weaponTier = 6; victim.alive = true; victim.hp = 3;
  (simulation as any).killPlayer(victim, killer.id, 1200, "projectile");
  assert.equal(victim.killScore, 0); assert.equal(killer.weaponTier, 6);
  victim.alive = true; victim.hp = 3;
  (simulation as any).killPlayer(victim, killer.id, 1300, "projectile"); assert.equal(victim.killScore, 0);
});

test("health does not consume at full HP and shield absorbs exactly one projectile", () => {
  const simulation = fresh(); const player = add(simulation, A, "Guest-1001"); const attacker = add(simulation, B, "Guest-1002");
  const health = collect(simulation, player, "health", 1000); assert.equal(health.active, true); assert.equal(player.hp, 3);
  player.hp = 1; collect(simulation, player, "health", 1100); assert.equal(player.hp, 2);
  collect(simulation, player, "health", 1200); assert.equal(player.hp, 3);
  collect(simulation, player, "shield", 1300); assert.equal(player.shieldHits, 1);
  const shield = collect(simulation, player, "shield", 1400); assert.equal(shield.active, true); assert.equal(player.shieldHits, 1);
  (simulation as any).damagePlayer(player.id, projectile(attacker.id), 1500); assert.equal(player.hp, 3); assert.equal(player.shieldHits, 0);
  (simulation as any).damagePlayer(player.id, projectile(attacker.id), 1600); assert.equal(player.hp, 2);
});

test("speed doubles authoritative movement, refreshes without stacking, and expires", () => {
  const simulation = fresh(); const player = add(simulation, A, "Guest-1001");
  collect(simulation, player, "speed", 1000); const firstUntil = player.speedUntil;
  simulation.applyInput(A, intent(2, { moveX: 1 }), 1034); simulation.step(DUSTY_FIXED_DT, 1034); assert.equal(Math.round(player.vx), 330);
  collect(simulation, player, "speed", 2000); assert.equal(player.speedUntil, 12000); assert.ok(player.speedUntil > firstUntil);
  simulation.applyInput(A, intent(4, { moveX: 1 }), 12000); simulation.step(DUSTY_FIXED_DT, 12000); assert.equal(Math.round(player.vx), 165);
});

test("teleport repeatedly chooses player-radius-safe points inside the world", () => {
  let value = 0; const simulation = fresh(() => (value = (value + .173) % 1)); const player = add(simulation, A, "Guest-1001");
  for (let index = 0; index < 40; index++) {
    collect(simulation, player, "teleport", 1000 + index * 20);
    assert.equal(simulation.isValidNormalPosition(player), true);
    assert.ok(player.x >= DUSTY_PLAYER_RADIUS && player.x <= 3200 - DUSTY_PLAYER_RADIUS);
  }
});

test("mole tunnels through rocks, blocks damage/pickups/fire, filters snapshots, and requires a clean exit press", () => {
  const simulation = fresh(); const mole = add(simulation, A, "Guest-1001"); const viewer = add(simulation, B, "Guest-1002");
  const polygon = DUSTY_POLYGONS[0];
  const inside = polygon.find((point) => pointInPolygon({ x: point.x + 2, y: point.y + 2 }, polygon));
  assert.ok(inside);
  collect(simulation, mole, "mole", 1000);
  const burrow = eventsOf(simulation, "mole_burrowed")[0] as { playerId: string; x: number; y: number };
  assert.deepEqual({ playerId: burrow.playerId, x: burrow.x, y: burrow.y }, { playerId: mole.id, x: 300, y: 300 });
  mole.x = inside!.x + 2; mole.y = inside!.y + 2;
  const pickup = simulation.pickups[0]; pickup.type = "health"; pickup.x = mole.x; pickup.y = mole.y; pickup.active = true;
  simulation.applyInput(A, intent(2, { moveX: 1, fire: true }), 1100); simulation.step(DUSTY_FIXED_DT, 1100);
  assert.equal(mole.moleMode, true); assert.equal(pickup.active, true); assert.equal(simulation.projectiles.length, 0);
  (simulation as any).damagePlayer(mole.id, projectile(viewer.id), 1100); assert.equal(mole.hp, 3);
  const viewerSnapshot = simulation.snapshot(viewer.id, 1100) as any;
  assert.equal(viewerSnapshot.players.some((player: any) => player.id === mole.id), false);
  assert.equal(viewerSnapshot.minimapPlayers.some((player: any) => player.id === mole.id), false);
  assert.equal(mole.emergeBlockedUntil > 1100, true);
  mole.x = 300; mole.y = 300;
  simulation.applyInput(A, intent(3, { fire: false }), 1200); simulation.step(DUSTY_FIXED_DT, 1200);
  simulation.applyInput(A, intent(4, { fire: true }), 1234); simulation.step(DUSTY_FIXED_DT, 1234);
  assert.equal(mole.moleMode, false); assert.equal(simulation.projectiles.length, 0);
  const emerged = eventsOf(simulation, "mole_emerged")[0] as { playerId: string; x: number; y: number };
  assert.deepEqual({ playerId: emerged.playerId, x: emerged.x, y: emerged.y }, { playerId: mole.id, x: 300, y: 300 });
  simulation.applyInput(A, intent(5, { fire: false }), 1268); simulation.step(DUSTY_FIXED_DT, 1268);
  simulation.applyInput(A, intent(6, { fire: true }), 1302); simulation.step(DUSTY_FIXED_DT, 1302);
  assert.equal(simulation.projectiles.length, 1);
});

test("mole timeout emerges on valid ground and force-resolves invalid camping", () => {
  const simulation = fresh(); const player = add(simulation, A, "Guest-1001"); collect(simulation, player, "mole", 1000);
  simulation.applyInput(A, intent(2), 10999); simulation.step(DUSTY_FIXED_DT, 10999); assert.equal(player.moleMode, true);
  simulation.applyInput(A, intent(3), 11000); simulation.step(DUSTY_FIXED_DT, 11000); assert.equal(player.moleMode, false);
  player.moleMode = true; player.moleUntil = 12000; player.x = DUSTY_POLYGONS[0][0].x + 2; player.y = DUSTY_POLYGONS[0][0].y + 2;
  simulation.applyInput(A, intent(4), 12000); simulation.step(DUSTY_FIXED_DT, 12000); assert.equal(player.moleMode, true);
  simulation.applyInput(A, intent(5), 14000); simulation.step(DUSTY_FIXED_DT, 14000); assert.equal(player.moleMode, false); assert.equal(simulation.isValidNormalPosition(player), true);
});

test("fart clouds coexist, conceal without invulnerability, and expire after five seconds", () => {
  const simulation = fresh(); const player = add(simulation, A, "Guest-1001"); const viewer = add(simulation, B, "Guest-1002");
  collect(simulation, player, "fart", 1000); collect(simulation, viewer, "fart", 1100); assert.equal(simulation.fartClouds.length, 2);
  assert.equal(simulation.fartClouds[0].radius, 360);
  player.x = simulation.fartClouds[0].x; player.y = simulation.fartClouds[0].y;
  let snapshot = simulation.snapshot(viewer.id, 1200) as any; assert.equal(snapshot.players.some((item: any) => item.id === player.id), false);
  player.weaponTier = 1; simulation.applyInput(A, intent(3, { fire: true }), 1200); simulation.step(DUSTY_FIXED_DT, 1200); assert.ok(simulation.projectiles.some((item) => item.ownerId === player.id));
  (simulation as any).damagePlayer(player.id, projectile(viewer.id), 1200); assert.equal(player.hp, 2);
  (simulation as any).damagePlayer(player.id, projectile(viewer.id, 2), 1300); assert.equal(player.alive, false);
  simulation.step(DUSTY_FIXED_DT, 6200); assert.equal(simulation.fartClouds.length, 0);
});

test("spy reveals visible players on minimap but stealth wins", () => {
  const simulation = fresh(); const spy = add(simulation, A, "Guest-1001"); const visible = add(simulation, B, "Guest-1002"); const hidden = add(simulation, C, "Guest-1003");
  collect(simulation, spy, "spy", 1000); hidden.moleMode = true; hidden.moleUntil = 9999;
  let snapshot = simulation.snapshot(spy.id, 1100) as any;
  assert.equal(snapshot.minimapPlayers.some((player: any) => player.id === visible.id), true);
  assert.equal(snapshot.minimapPlayers.some((player: any) => player.id === hidden.id), false);
  hidden.moleMode = false; snapshot = simulation.snapshot(spy.id, 1200) as any;
  assert.equal(snapshot.minimapPlayers.some((player: any) => player.id === hidden.id), true);
});

test("ten kills arm one nuke; detonation bypasses shield, mole, and concealment and charges again", () => {
  const simulation = fresh(); const owner = add(simulation, A, "Guest-1001"); const shielded = add(simulation, B, "Guest-1002"); const mole = add(simulation, C, "Guest-1003"); const outside = add(simulation, D, "Guest-1004");
  owner.kills = 9; owner.nukeProgress = 9; owner.weaponTier = 6;
  const dummy = { ...shielded, id: "dummy", alive: true } as DustyPlayer;
  (simulation as any).creditKill(owner); assert.equal(owner.nukeReady, true); assert.equal(owner.nukeProgress, 10);
  owner.x = 1000; owner.y = 1000; shielded.x = 1100; shielded.y = 1000; shielded.shieldHits = 1; shielded.alive = true; shielded.hp = 3;
  mole.x = 1200; mole.y = 1000; mole.moleMode = true; mole.moleUntil = 9999;
  outside.x = 1900; outside.y = 1000;
  simulation.fartClouds.push({ id: 90, ownerId: shielded.id, x: shielded.x, y: shielded.y, radius: 180, createdAt: 1000, expiresAt: 9000 });
  simulation.applyInput(A, intent(1, { nuke: true }), 2000); simulation.step(DUSTY_FIXED_DT, 2000);
  assert.equal(owner.nukeReady, false); assert.equal(owner.nukeProgress, 0); assert.equal(simulation.nukes.length, 1);
  simulation.applyInput(A, intent(2, { nuke: false }), 3000); simulation.step(DUSTY_FIXED_DT, 3000);
  assert.equal(owner.alive, true); assert.equal(shielded.alive, false); assert.equal(mole.alive, false);
  assert.equal(outside.alive, true);
  assert.equal(owner.nukeProgress, 2); assert.equal(owner.kills, 12); assert.equal(shielded.shieldHits, 0);
  assert.equal(dummy.alive, true);
});

test("death never removes nuke progress or a ready nuke", () => {
  const simulation = fresh(); const victim = add(simulation, A, "Guest-1001"); const killer = add(simulation, B, "Guest-1002");
  victim.nukeProgress = 7; (simulation as any).killPlayer(victim, killer.id, 1000, "projectile"); assert.equal(victim.nukeProgress, 7);
  victim.alive = true; victim.hp = 3; victim.nukeProgress = 10; victim.nukeReady = true;
  (simulation as any).killPlayer(victim, killer.id, 1100, "projectile"); assert.equal(victim.nukeReady, true); assert.equal(victim.nukeProgress, 10);
});

test("threat leader ranking is deterministic and its marker obeys stealth", () => {
  const simulation = fresh(); const viewer = add(simulation, A, "Guest-1001"); const first = add(simulation, B, "Guest-1002"); const second = add(simulation, C, "Guest-1003");
  viewer.killScore = 0; first.killScore = 4; first.weaponTier = 3; second.killScore = 3; second.weaponTier = 6;
  (simulation as any).updateThreatLeader(); assert.equal(simulation.threatLeaderId, first.id);
  second.killScore = 4; (simulation as any).updateThreatLeader(); assert.equal(simulation.threatLeaderId, second.id);
  second.weaponTier = 3; first.kills = second.kills = 2; (simulation as any).updateThreatLeader(); assert.equal(simulation.threatLeaderId, first.id);
  let snapshot = simulation.snapshot(viewer.id, 1000) as any; assert.equal(snapshot.minimapPlayers.some((player: any) => player.id === first.id && player.threat), true);
  first.moleMode = true; first.moleUntil = 9999; snapshot = simulation.snapshot(viewer.id, 1100) as any; assert.equal(snapshot.minimapPlayers.some((player: any) => player.id === first.id), false);
  first.moleMode = false; simulation.fartClouds.push({ id: 1, ownerId: first.id, x: first.x, y: first.y, radius: 180, createdAt: 1000, expiresAt: 5000 });
  snapshot = simulation.snapshot(viewer.id, 1200) as any; assert.equal(snapshot.minimapPlayers.some((player: any) => player.id === first.id), false);
});

test("pickup population is six, includes fart artwork type, and inactive pickups wait eight seconds", () => {
  const simulation = new DustyOrbitSimulation(() => .2); const active = simulation.pickups.filter((pickup) => pickup.active); assert.equal(active.length, 6);
  for (let first = 0; first < active.length; first++) for (let second = first + 1; second < active.length; second++) {
    const distance = Math.hypot(active[first].x - active[second].x, active[first].y - active[second].y);
    assert.ok(distance >= DUSTY_GAMEPLAY.pickupMinimumSpacing, `pickups ${active[first].id}/${active[second].id} were only ${distance.toFixed(1)} apart`);
  }
  assert.ok(POWERUP_TYPES.includes("fart"));
  const pickup = simulation.pickups[0]; pickup.active = false; pickup.respawnAt = 9000;
  simulation.step(DUSTY_FIXED_DT, 8999); assert.equal(pickup.active, false);
  simulation.step(DUSTY_FIXED_DT, 9000); assert.equal(pickup.active, true);
  assert.equal(DUSTY_GAMEPLAY.pickupRespawnMs, 8000);
  assert.equal(DUSTY_GAMEPLAY.pickupMinimumSpacing, 960);
});

test("pickup respawns never bypass the three-quarter-screen spacing rule", () => {
  let value = 0;
  const simulation = new DustyOrbitSimulation(() => (value = (value + .371) % 1));
  for (let cycle = 0; cycle < 50; cycle++) {
    const pickup = simulation.pickups[cycle % simulation.pickups.length];
    pickup.active = false;
    pickup.respawnAt = 1000 + cycle;
    simulation.step(DUSTY_FIXED_DT, 1000 + cycle);
    const active = simulation.pickups.filter((item) => item.active);
    for (let first = 0; first < active.length; first++) for (let second = first + 1; second < active.length; second++) {
      assert.ok(
        Math.hypot(active[first].x - active[second].x, active[first].y - active[second].y) >= DUSTY_GAMEPLAY.pickupMinimumSpacing,
        `cycle ${cycle} placed pickups ${active[first].id}/${active[second].id} too close`,
      );
    }
  }
});
