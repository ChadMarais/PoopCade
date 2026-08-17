import assert from "node:assert/strict";
import test from "node:test";
import { distanceToPolygon } from "../../games/game-03/collision-geometry.js";
import { DUSTY_GAMEPLAY, DUSTY_WEAPONS, generateRandomWeapon } from "../src/dusty-gameplay.ts";
import { DUSTY_HEALING_STATIONS, DUSTY_PLAYER_RADIUS, DUSTY_WEAPON_STATIONS } from "../src/dusty-map.ts";
import { DustyOrbitSimulation, DUSTY_FIXED_DT } from "../src/dusty-simulation.ts";

function disablePickups(simulation: DustyOrbitSimulation): void {
  for (const pickup of simulation.pickups) { pickup.active = false; pickup.respawnAt = 999_999; }
}

function stationApproaches(simulation: DustyOrbitSimulation, polygon: readonly { x: number; y: number }[], count = 1) {
  const minX = Math.floor(Math.min(...polygon.map((point) => point.x)) - DUSTY_PLAYER_RADIUS - 8);
  const maxX = Math.ceil(Math.max(...polygon.map((point) => point.x)) + DUSTY_PLAYER_RADIUS + 8);
  const minY = Math.floor(Math.min(...polygon.map((point) => point.y)) - DUSTY_PLAYER_RADIUS - 8);
  const maxY = Math.ceil(Math.max(...polygon.map((point) => point.y)) + DUSTY_PLAYER_RADIUS + 8);
  const points: Array<{ x: number; y: number }> = [];
  for (let y = minY; y <= maxY && points.length < count; y += 3) for (let x = minX; x <= maxX && points.length < count; x += 3) {
    const point = { x, y };
    if (!simulation.isValidNormalPosition(point)) continue;
    if (distanceToPolygon(point, polygon) - DUSTY_PLAYER_RADIUS > 5.5) continue;
    if (points.every((other) => Math.hypot(point.x - other.x, point.y - other.y) > DUSTY_PLAYER_RADIUS * 2 + 4)) points.push(point);
  }
  assert.equal(points.length, count, "station must have enough player-safe approach positions");
  return points;
}

test("Lunar healing uses the authoritative two-second cadence and only glows while healing", () => {
  assert.equal(DUSTY_HEALING_STATIONS.length, 1);
  const simulation = new DustyOrbitSimulation(() => .5);
  disablePickups(simulation);
  const player = simulation.addPlayer("30000000-0000-4000-8000-000000000001", "Lunar Medic", 1000);
  Object.assign(player, stationApproaches(simulation, DUSTY_HEALING_STATIONS[0].polygon)[0], { hp: 1, protectedUntil: 0 });

  simulation.step(DUSTY_FIXED_DT, 1000);
  assert.equal(player.connectedHealingStationId, DUSTY_HEALING_STATIONS[0].id);
  assert.deepEqual(simulation.snapshot(player.id, 1000).activeHealingStationIds, [DUSTY_HEALING_STATIONS[0].id]);
  simulation.step(DUSTY_FIXED_DT, 2999);
  assert.equal(player.hp, 1);
  simulation.step(DUSTY_FIXED_DT, 3000);
  assert.equal(player.hp, 2);
  simulation.step(DUSTY_FIXED_DT, 5000);
  assert.equal(player.hp, DUSTY_GAMEPLAY.maxHp);
  assert.deepEqual(simulation.snapshot(player.id, 5000).activeHealingStationIds, []);
});

test("Lunar generator reserves one player for five seconds then enforces one global ten-second cooldown", () => {
  assert.equal(DUSTY_WEAPON_STATIONS.length, 1);
  const simulation = new DustyOrbitSimulation(() => .5);
  disablePickups(simulation);
  const [firstPoint, secondPoint] = stationApproaches(simulation, DUSTY_WEAPON_STATIONS[0].polygon, 2);
  const first = simulation.addPlayer("30000000-0000-4000-8000-000000000002", "First", 1000);
  const second = simulation.addPlayer("30000000-0000-4000-8000-000000000003", "Second", 1000);
  Object.assign(first, firstPoint, { protectedUntil: 0 });
  Object.assign(second, secondPoint, { protectedUntil: 0 });

  simulation.step(DUSTY_FIXED_DT, 1000);
  assert.equal(first.connectedWeaponStationId, DUSTY_WEAPON_STATIONS[0].id);
  assert.equal(second.connectedWeaponStationId, null);
  let station = (simulation.snapshot(first.id, 1000).weaponStations as Array<Record<string, unknown>>)[0];
  assert.equal(station.state, "GENERATING");
  assert.equal(station.generationRemaining, 5000);

  simulation.step(DUSTY_FIXED_DT, 5999);
  assert.equal(first.randomWeapon, null);
  simulation.step(DUSTY_FIXED_DT, 6000);
  assert.ok(first.randomWeapon?.generated);
  station = (simulation.snapshot(first.id, 6000).weaponStations as Array<Record<string, unknown>>)[0];
  assert.equal(station.state, "COOLDOWN");
  assert.equal(station.cooldownRemaining, 10000);

  first.x = 400; first.y = 1800;
  simulation.step(DUSTY_FIXED_DT, 15999);
  assert.equal(second.connectedWeaponStationId, null);
  Object.assign(second, secondPoint, { vx: 0, vy: 0 });
  (simulation as any).updateWeaponStationConnection(second, 16000);
  assert.equal(second.connectedWeaponStationId, DUSTY_WEAPON_STATIONS[0].id);
});

test("walking into the Lunar generator stops at its solid footprint and activates without tunnelling", () => {
  const simulation = new DustyOrbitSimulation(() => .5);
  disablePickups(simulation);
  const player = simulation.addPlayer("30000000-0000-4000-8000-000000000005", "Walker", 1000);
  Object.assign(player, { x: 1830, y: 900, protectedUntil: 0 });
  for (let step = 0; step < 90 && !player.connectedWeaponStationId; step++) {
    const now = 1000 + step * 34;
    simulation.applyInput(player.id, { type: "input", seq: step + 1, moveX: 1, moveY: 0, aimX: 1, aimY: 0, fire: false }, now);
    simulation.step(DUSTY_FIXED_DT, now);
  }
  assert.equal(player.connectedWeaponStationId, DUSTY_WEAPON_STATIONS[0].id);
  assert.ok(player.x < Math.min(...DUSTY_WEAPON_STATIONS[0].polygon.map((point) => point.x)), "player remains on the approach side of the solid generator");
  assert.ok(distanceToPolygon(player, DUSTY_WEAPON_STATIONS[0].polygon) >= DUSTY_PLAYER_RADIUS - .01);
});

test("rerolls never replace the original standard fallback and generated kills never upgrade it", () => {
  const simulation = new DustyOrbitSimulation(() => .5);
  disablePickups(simulation);
  const player = simulation.addPlayer("30000000-0000-4000-8000-000000000004", "Shotgunner", 1000);
  player.weaponTier = 5;
  player.randomWeapon = generateRandomWeapon(() => .5);
  (simulation as any).creditKill(player);
  assert.equal(player.weaponTier, 5);
  const firstRoll = player.randomWeapon;
  player.randomWeapon = generateRandomWeapon(() => .7);
  player.randomWeapon = generateRandomWeapon(() => .9);
  assert.notEqual(player.randomWeapon, firstRoll);
  assert.equal(player.weaponTier, 5);

  (simulation as any).killPlayer(player, "world", 2000, "projectile");
  assert.equal(player.randomWeapon, null);
  assert.equal(player.weaponTier, 5, "death restores the pre-generator Shotgun without a normal death downgrade");
  const death = simulation.drainEvents().find((event) => event.type === "death");
  assert.equal(death?.restoredWeaponTier, 5);
  assert.ok(death?.randomWeaponLost);
});

test("generated weapons are frequently awful, sometimes useful, and very rarely legendary", () => {
  const dud = generateRandomWeapon(() => .1);
  const average = generateRandomWeapon(() => .7);
  const legendary = generateRandomWeapon(() => .995);
  assert.deepEqual([dud.rarity, average.rarity, legendary.rarity], ["DUD", "AVERAGE", "LEGENDARY"]);
  assert.ok(dud.cooldownMs > DUSTY_WEAPONS[0].cooldownMs || dud.speed * dud.lifetimeMs < DUSTY_WEAPONS[0].speed * DUSTY_WEAPONS[0].lifetimeMs, "a dud can be worse than the Pea Shooter");
  const legendaryVolley = Math.max(legendary.count, legendary.spreadDegrees.length);
  assert.ok(legendaryVolley * legendary.damage / legendary.cooldownMs > DUSTY_WEAPONS[5].damage / DUSTY_WEAPONS[5].cooldownMs * 8, "legendary output must be unmistakably overpowered");
  assert.equal(legendary.visualTier, 7);
});

test("thousands of deterministic rolls produce broad stat and firing-pattern variety at the authored weights", () => {
  let seed = 0x51f15e;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const weapons = Array.from({ length: 5000 }, () => generateRandomWeapon(random));
  const count = (rarity: string) => weapons.filter((weapon) => weapon.rarity === rarity).length;
  assert.ok(count("DUD") > 2600 && count("DUD") < 2900);
  assert.ok(count("AVERAGE") > 2000 && count("AVERAGE") < 2300);
  assert.ok(count("LEGENDARY") > 65 && count("LEGENDARY") < 140);
  assert.ok(new Set(weapons.map((weapon) => weapon.name)).size >= 45, "the generator needs many arcade identities");
  assert.ok(new Set(weapons.map((weapon) => [weapon.cooldownMs, weapon.speed, weapon.lifetimeMs, weapon.damage, weapon.radius, weapon.count, weapon.spreadDegrees.join(","), weapon.burstSpacingMs].join("|"))).size > 3000, "rolls must vary mechanics, not merely names");
});

test("generated single-shot weapons preserve the exact live muzzle direction", () => {
  const values = [.1, 0, .3, .5, .5, .5]; let index = 0;
  const dud = generateRandomWeapon(() => values[index++] ?? .5);
  assert.match(dud.name, /TRIGGER-LAG BLASTER/);
  assert.deepEqual(dud.spreadDegrees, [0]);
  const simulation = new DustyOrbitSimulation(() => .5);
  disablePickups(simulation);
  const player = simulation.addPlayer("30000000-0000-4000-8000-000000000006", "Aligned", 1000);
  Object.assign(player, { x: 1000, y: 1000, protectedUntil: 0, randomWeapon: dud });
  simulation.applyInput(player.id, { type: "input", seq: 1, moveX: 0, moveY: 0, aimX: .6, aimY: .8, fire: true }, 1000);
  simulation.step(DUSTY_FIXED_DT, 1000);
  const projectile = simulation.projectiles[0];
  const shot = simulation.drainEvents().find((event) => event.type === "shot");
  assert.ok(projectile);
  assert.equal(shot?.weaponRarity, "DUD");
  assert.ok(Math.abs(projectile.vx / dud.speed - .6) < 1e-9);
  assert.ok(Math.abs(projectile.vy / dud.speed - .8) < 1e-9);
});
