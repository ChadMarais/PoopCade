import { moveCircleWithSliding, sweptCircleIntersectsPolygon } from "../../games/game-03/collision-geometry.js";
import { DUSTY_MAP, DUSTY_PLAYER_RADIUS, DUSTY_PLAYER_SPEED, DUSTY_POLYGONS, DUSTY_SPAWNS, type Point } from "./dusty-map.ts";
import type { ClientInput } from "./protocol.ts";

export const DUSTY_TICK_RATE = 30;
export const DUSTY_SNAPSHOT_RATE = 15;
export const DUSTY_FIXED_DT = 1 / DUSTY_TICK_RATE;
export const DUSTY_RESPAWN_MS = 2000;
export const DUSTY_SPAWN_PROTECTION_MS = 2000;
export const DUSTY_STALE_INPUT_MS = 300;
export const DUSTY_STALE_PLAYER_MS = 15000;
export const DUSTY_DISCONNECT_GRACE_MS = 5000;
export const DUSTY_MAX_PLAYERS = 20;
const MAX_PROJECTILES = 300;

export const DUSTY_WEAPON = Object.freeze({
  tier: 1,
  name: "MOON PULSE",
  cooldownMs: 600,
  speed: 680,
  damage: 1,
  radius: 3.5,
  lifetimeMs: 1800,
  muzzleDistance: 36,
});

export type DustyPlayer = {
  id: string; name: string; x: number; y: number; vx: number; vy: number;
  aimX: number; aimY: number; hp: number; kills: number; alive: boolean;
  respawnAt: number; protectedUntil: number; lastInputAt: number; lastMessageAt: number;
  lastInputSeq: number; lastFireAt: number; disconnectedAt: number; color: string;
  lastProcessedInputSeq: number; input: ClientInput; pendingInput: ClientInput | null;
};

export type DustyProjectile = {
  id: number; ownerId: string; x: number; y: number; vx: number; vy: number;
  radius: number; damage: number; spawnedAt: number; expiresAt: number;
};

const COLORS = ["#55efff", "#ff66ca", "#c6ff58", "#9f75ff", "#ffbd5d", "#ff6784"];
const EMPTY_INPUT: ClientInput = { type: "input", seq: 0, moveX: 0, moveY: 0, aimX: 1, aimY: 0, fire: false };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalized(x: number, y: number): { x: number; y: number; length: number } {
  const length = Math.hypot(x, y);
  return length > 0.0001 ? { x: x / length, y: y / length, length } : { x: 0, y: 0, length: 0 };
}

function segmentCircle(start: Point, end: Point, center: Point, radius: number): number | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const fx = start.x - center.x;
  const fy = start.y - center.y;
  const a = dx * dx + dy * dy;
  if (a < 0.00001) return null;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  if (first >= 0 && first <= 1) return first;
  if (second >= 0 && second <= 1) return second;
  return null;
}

function sweptPolygonTime(start: Point, end: Point, radius: number, polygon: Point[]): number | null {
  if (!sweptCircleIntersectsPolygon(start, end, radius, polygon)) return null;
  let low = 0;
  let high = 1;
  for (let pass = 0; pass < 12; pass++) {
    const middle = (low + high) / 2;
    const probe = { x: start.x + (end.x - start.x) * middle, y: start.y + (end.y - start.y) * middle };
    if (sweptCircleIntersectsPolygon(start, probe, radius, polygon)) high = middle;
    else low = middle;
  }
  return high;
}

export class DustyOrbitSimulation {
  readonly players = new Map<string, DustyPlayer>();
  readonly projectiles: DustyProjectile[] = [];
  private events: Array<Record<string, unknown>> = [];
  private projectileId = 0;
  private spawnCursor = 0;
  tick = 0;

  addPlayer(id: string, name: string, now: number): DustyPlayer {
    const existing = this.players.get(id);
    if (existing) {
      existing.name = name;
      existing.disconnectedAt = 0;
      existing.lastMessageAt = now;
      return existing;
    }
    if (this.players.size >= DUSTY_MAX_PLAYERS) throw new Error("arena-full");
    const spawn = this.chooseInitialSpawn();
    const player: DustyPlayer = {
      id, name, x: spawn.x, y: spawn.y, vx: 0, vy: 0, aimX: 1, aimY: 0,
      hp: 3, kills: 0, alive: true, respawnAt: 0, protectedUntil: now + DUSTY_SPAWN_PROTECTION_MS,
      lastInputAt: now, lastMessageAt: now, lastInputSeq: 0, lastFireAt: 0, disconnectedAt: 0,
      lastProcessedInputSeq: 0, color: COLORS[this.players.size % COLORS.length], input: { ...EMPTY_INPUT }, pendingInput: null,
    };
    this.players.set(id, player);
    this.events.push({ type: "player_joined", player: { id, name } });
    return player;
  }

  markDisconnected(id: string, now: number): void {
    const player = this.players.get(id);
    if (!player) return;
    player.disconnectedAt = now;
    player.pendingInput = null;
    player.input = { ...player.input, moveX: 0, moveY: 0, fire: false };
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    for (let index = this.projectiles.length - 1; index >= 0; index--) {
      if (this.projectiles[index].ownerId === id) this.projectiles.splice(index, 1);
    }
    this.events.push({ type: "player_left", player: { id, name: player.name } });
  }

  applyInput(id: string, input: ClientInput, now: number): boolean {
    const player = this.players.get(id);
    if (!player || input.seq <= player.lastInputSeq || input.seq > player.lastInputSeq + 1000) return false;
    const move = normalized(input.moveX, input.moveY);
    const aim = normalized(input.aimX, input.aimY);
    const sanitizedInput: ClientInput = {
      ...input,
      moveX: move.length > 1 ? move.x : input.moveX,
      moveY: move.length > 1 ? move.y : input.moveY,
      aimX: aim.length ? aim.x : player.aimX,
      aimY: aim.length ? aim.y : player.aimY,
    };
    player.pendingInput = sanitizedInput;
    player.lastInputSeq = input.seq;
    player.lastInputAt = now;
    player.lastMessageAt = now;
    player.disconnectedAt = 0;
    return true;
  }

  noteMessage(id: string, now: number): void {
    const player = this.players.get(id);
    if (player) player.lastMessageAt = now;
  }

  step(dt = DUSTY_FIXED_DT, now = Date.now()): void {
    this.tick++;
    for (const player of [...this.players.values()]) {
      if ((player.disconnectedAt && now - player.disconnectedAt >= DUSTY_DISCONNECT_GRACE_MS) || now - player.lastMessageAt >= DUSTY_STALE_PLAYER_MS) {
        this.events.push({ type: "stale", playerId: player.id });
        this.removePlayer(player.id);
        continue;
      }
      if (!player.alive) {
        player.pendingInput = null;
        player.lastProcessedInputSeq = player.lastInputSeq;
        if (now >= player.respawnAt) this.respawnPlayer(player, now);
        continue;
      }
      if (now - player.lastInputAt > DUSTY_STALE_INPUT_MS) {
        player.pendingInput = null;
        player.input = { ...player.input, moveX: 0, moveY: 0, fire: false };
      } else {
        const nextInput = player.pendingInput;
        if (nextInput) {
          player.input = nextInput;
          player.lastProcessedInputSeq = nextInput.seq;
          player.pendingInput = null;
        }
      }
      const aim = normalized(player.input.aimX, player.input.aimY);
      if (aim.length) { player.aimX = aim.x; player.aimY = aim.y; }
      const move = normalized(player.input.moveX, player.input.moveY);
      player.vx = move.x * DUSTY_PLAYER_SPEED;
      player.vy = move.y * DUSTY_PLAYER_SPEED;
      const moved = moveCircleWithSliding(
        { x: player.x, y: player.y },
        { x: player.vx * dt, y: player.vy * dt },
        DUSTY_PLAYER_RADIUS,
        DUSTY_POLYGONS,
      );
      player.x = clamp(moved.x, DUSTY_PLAYER_RADIUS, DUSTY_MAP.width - DUSTY_PLAYER_RADIUS);
      player.y = clamp(moved.y, DUSTY_PLAYER_RADIUS, DUSTY_MAP.height - DUSTY_PLAYER_RADIUS);
      this.processFire(player, now);
    }
    this.updateProjectiles(dt, now);
  }

  private processFire(player: DustyPlayer, now: number): void {
    if (!player.input.fire || now - player.lastFireAt < DUSTY_WEAPON.cooldownMs || this.projectiles.length >= MAX_PROJECTILES) return;
    player.protectedUntil = 0;
    player.lastFireAt = now;
    const direction = normalized(player.aimX, player.aimY);
    const x = player.x + direction.x * DUSTY_WEAPON.muzzleDistance;
    const y = player.y + direction.y * DUSTY_WEAPON.muzzleDistance;
    const projectile: DustyProjectile = {
      id: ++this.projectileId, ownerId: player.id, x, y,
      vx: direction.x * DUSTY_WEAPON.speed, vy: direction.y * DUSTY_WEAPON.speed,
      radius: DUSTY_WEAPON.radius, damage: DUSTY_WEAPON.damage,
      spawnedAt: now, expiresAt: now + DUSTY_WEAPON.lifetimeMs,
    };
    this.projectiles.push(projectile);
    this.events.push({
      type: "shot", playerId: player.id, x, y,
      projectile: {
        id: projectile.id, ownerId: projectile.ownerId,
        x: projectile.x, y: projectile.y, vx: projectile.vx, vy: projectile.vy,
        radius: projectile.radius, spawnedAt: projectile.spawnedAt, expiresAt: projectile.expiresAt,
      },
    });
  }

  private updateProjectiles(dt: number, now: number): void {
    for (let index = this.projectiles.length - 1; index >= 0; index--) {
      const projectile = this.projectiles[index];
      if (now >= projectile.expiresAt) { this.projectiles.splice(index, 1); continue; }
      const start = { x: projectile.x, y: projectile.y };
      const end = { x: projectile.x + projectile.vx * dt, y: projectile.y + projectile.vy * dt };
      let hit: { t: number; kind: "rock" | "player" | "boundary"; id?: string } | null = null;
      if (end.x < 0 || end.y < 0 || end.x > DUSTY_MAP.width || end.y > DUSTY_MAP.height) hit = { t: 1, kind: "boundary" };
      for (const polygon of DUSTY_POLYGONS) {
        const t = sweptPolygonTime(start, end, projectile.radius, polygon);
        if (t !== null && (!hit || t < hit.t)) hit = { t, kind: "rock" };
      }
      for (const player of this.players.values()) {
        if (!player.alive || player.id === projectile.ownerId || player.protectedUntil > now) continue;
        const t = segmentCircle(start, end, player, DUSTY_PLAYER_RADIUS + projectile.radius);
        if (t !== null && (!hit || t < hit.t)) hit = { t, kind: "player", id: player.id };
      }
      if (!hit) { projectile.x = end.x; projectile.y = end.y; continue; }
      const impactX = start.x + (end.x - start.x) * hit.t;
      const impactY = start.y + (end.y - start.y) * hit.t;
      if (hit.kind === "player" && hit.id) this.damagePlayer(hit.id, projectile, now);
      this.events.push({
        type: "impact", projectileId: projectile.id, ownerId: projectile.ownerId,
        x: impactX, y: impactY, target: hit.kind,
      });
      this.projectiles.splice(index, 1);
    }
  }

  private damagePlayer(id: string, projectile: DustyProjectile, now: number): void {
    const player = this.players.get(id);
    if (!player?.alive || player.protectedUntil > now) return;
    player.hp -= projectile.damage;
    this.events.push({ type: "player_hit", playerId: id, ownerId: projectile.ownerId, hp: Math.max(0, player.hp), damage: projectile.damage });
    if (player.hp <= 0) this.killPlayer(player, projectile.ownerId, now);
  }

  private killPlayer(victim: DustyPlayer, killerId: string, now: number): void {
    const killer = this.players.get(killerId);
    victim.alive = false;
    victim.hp = 0;
    victim.vx = victim.vy = 0;
    victim.input = { ...victim.input, moveX: 0, moveY: 0, fire: false };
    victim.pendingInput = null;
    victim.lastProcessedInputSeq = victim.lastInputSeq;
    victim.respawnAt = now + DUSTY_RESPAWN_MS;
    victim.protectedUntil = 0;
    if (killer && killer.id !== victim.id) killer.kills++;
    this.events.push({ type: "kill", killerId, killerName: killer?.name ?? "DUSTY ORBIT", victimId: victim.id, victimName: victim.name, kills: killer?.kills ?? 0 });
    this.events.push({ type: "death", victimId: victim.id, victimName: victim.name, killerId, killerName: killer?.name ?? "DUSTY ORBIT", respawnAt: victim.respawnAt });
  }

  private respawnPlayer(player: DustyPlayer, now: number): void {
    const spawn = this.chooseRespawn(player.id);
    Object.assign(player, { x: spawn.x, y: spawn.y, vx: 0, vy: 0, hp: 3, alive: true, respawnAt: 0, protectedUntil: now + DUSTY_SPAWN_PROTECTION_MS, lastFireAt: 0 });
    this.events.push({ type: "respawn", playerId: player.id, x: player.x, y: player.y, protectedUntil: player.protectedUntil });
  }

  private chooseInitialSpawn(): Point {
    const spawn = DUSTY_SPAWNS[this.spawnCursor % DUSTY_SPAWNS.length];
    this.spawnCursor++;
    return spawn;
  }

  private chooseRespawn(ignoreId: string): Point {
    const living = [...this.players.values()].filter((player) => player.alive && player.id !== ignoreId);
    if (!living.length) return this.chooseInitialSpawn();
    return [...DUSTY_SPAWNS].sort((a, b) => {
      const aDistance = Math.min(...living.map((player) => Math.hypot(a.x - player.x, a.y - player.y)));
      const bDistance = Math.min(...living.map((player) => Math.hypot(b.x - player.x, b.y - player.y)));
      return bDistance - aDistance;
    })[0];
  }

  drainEvents(): Array<Record<string, unknown>> {
    const output = this.events;
    this.events = [];
    return output;
  }

  snapshot(viewerId: string, now = Date.now()): Record<string, unknown> {
    const viewer = this.players.get(viewerId);
    return {
      type: "snapshot", t: now, tick: this.tick, you: { id: viewerId, ack: viewer?.lastProcessedInputSeq ?? 0 },
      players: [...this.players.values()].map((player) => ({
        id: player.id, name: player.name, x: Math.round(player.x * 10) / 10, y: Math.round(player.y * 10) / 10,
        vx: Math.round(player.vx), vy: Math.round(player.vy), aimX: Math.round(player.aimX * 1000) / 1000,
        aimY: Math.round(player.aimY * 1000) / 1000, hp: player.hp, kills: player.kills, weaponTier: 1,
        alive: player.alive, respawnAt: player.respawnAt, protectedUntil: player.protectedUntil, color: player.color,
      })),
      projectiles: this.projectiles.map((projectile) => ({
        id: projectile.id, ownerId: projectile.ownerId, tier: 1,
        x: Math.round(projectile.x * 10) / 10, y: Math.round(projectile.y * 10) / 10,
        vx: Math.round(projectile.vx), vy: Math.round(projectile.vy), radius: projectile.radius,
        spawnedAt: projectile.spawnedAt,
      })),
    };
  }
}
