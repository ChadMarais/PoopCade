import { distanceToPolygon, moveCircleWithSliding, pointInPolygon, sweptCircleIntersectsPolygon } from "../../games/game-03/collision-geometry.js";
import { weaponPose, weaponVisualForTier } from "../../games/game-03/weapon-visuals.js";
import { FART_CLOUD_GROW_MS, fartCloudGrowth } from "../../games/game-03/effect-timing.js";
import {
  DUSTY_MAP,
  DUSTY_PLAYER_HIT_RADIUS,
  DUSTY_PLAYER_RADIUS,
  DUSTY_POLYGONS,
  DUSTY_PROJECTILE_POLYGONS,
  DUSTY_SATELLITES,
  DUSTY_SATELLITE_CONNECT_TOLERANCE,
  DUSTY_SATELLITE_DISCONNECT_TOLERANCE,
  DUSTY_SPAWNS,
  type Point,
} from "./dusty-map.ts";
import { DUSTY_GAMEPLAY, DUSTY_WEAPONS, POWERUP_TYPES, weaponForTier, type PowerupType, type WeaponDefinition } from "./dusty-gameplay.ts";
import type { ClientInput } from "./protocol.ts";
import { DEFAULT_CHARACTER_SKIN_ID, characterSkinById, validCharacterSkinId } from "../../games/game-03/character-skins.js";

export const DUSTY_TICK_RATE = 30;
export const DUSTY_SNAPSHOT_RATE = 15;
export const DUSTY_FIXED_DT = 1 / DUSTY_TICK_RATE;
export const DUSTY_RESPAWN_MS = 2000;
export const DUSTY_SPAWN_PROTECTION_MS = 2000;
export const DUSTY_STALE_INPUT_MS = 300;
export const DUSTY_STALE_PLAYER_MS = 15000;
export const DUSTY_DISCONNECT_GRACE_MS = 5000;
export const DUSTY_MAX_PLAYERS = 15;
export const DUSTY_MAX_HIT_REWIND_MS = 250;
export const DUSTY_PLAYER_COLLISION_COOLDOWN_MS = 750;

const COLLISION_KILL_CALLOUTS = Object.freeze([
  "DEMOLITION DERBY · INSURANCE DENIED",
  "BUMPER CARS · MAXIMUM POOR JUDGEMENT",
  "ROAD RAGE · NOW IN SPACE",
  "BOTH PILOTS FAILED THE DRIVING TEST",
]);

// Backwards-compatible exports for the arena welcome packet and older tests.
export const DUSTY_WEAPON = DUSTY_WEAPONS[0];

export type DustyPlayer = {
  id: string; name: string; skinId: string; joinedAt: number; joinOrder: number; x: number; y: number; vx: number; vy: number;
  aimX: number; aimY: number; hp: number; kills: number; deaths: number; killScore: number; highScore: number;
  weaponTier: number; nukeProgress: number; nukeReady: boolean; shieldHits: number;
  spyUntil: number; speedUntil: number; moleMode: boolean; moleUntil: number; moleForceAt: number;
  connectedSatelliteId: string | null;
  emergeBlockedUntil: number; alive: boolean; respawnAt: number; protectedUntil: number;
  lastInputAt: number; lastMessageAt: number; lastInputSeq: number; lastFireAt: number;
  lastFireInput: boolean; suppressFireUntilRelease: boolean; lastNukeInput: boolean;
  burstRemaining: number; burstIndex: number; nextBurstAt: number;
  disconnectedAt: number; color: string; lastProcessedInputSeq: number;
  input: ClientInput; pendingInput: ClientInput | null;
};

export type DustyProjectile = {
  id: number; ownerId: string; tier: number; x: number; y: number; vx: number; vy: number;
  radius: number; damage: number; spawnedAt: number; expiresAt: number; inputSeq?: number; rewindMs?: number;
};

type DustyPositionSample = { at: number; x: number; y: number };

export type DustyPickup = {
  id: number; type: PowerupType; x: number; y: number; active: boolean; respawnAt: number;
};

export type DustyFartCloud = {
  id: number; ownerId: string; x: number; y: number; radius: number; growMs: number; createdAt: number; expiresAt: number;
};

export type DustyNuke = {
  id: number; ownerId: string; x: number; y: number; radius: number; startedAt: number; detonateAt: number;
};

const COLORS = ["#55efff", "#ff66ca", "#c6ff58", "#9f75ff", "#ffbd5d", "#ff6784"];
const EMPTY_INPUT: ClientInput = { type: "input", seq: 0, moveX: 0, moveY: 0, aimX: 1, aimY: 0, fire: false, nuke: false };

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function round(value: number, precision = 10): number { return Math.round(value * precision) / precision; }
function normalized(x: number, y: number): { x: number; y: number; length: number } {
  const length = Math.hypot(x, y);
  return length > 0.0001 ? { x: x / length, y: y / length, length } : { x: 0, y: 0, length: 0 };
}
export function moleBurrowOrigin(player: Pick<DustyPlayer, "x" | "y" | "vx" | "vy">, leadDistance = DUSTY_PLAYER_RADIUS + 10): Point {
  const movement = normalized(player.vx, player.vy);
  return movement.length
    ? { x: player.x + movement.x * leadDistance, y: player.y + movement.y * leadDistance }
    : { x: player.x, y: player.y };
}
function segmentCircle(start: Point, end: Point, center: Point, radius: number): number | null {
  const dx = end.x - start.x, dy = end.y - start.y, fx = start.x - center.x, fy = start.y - center.y;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - radius * radius;
  // A projectile already overlapping the target at the start of a tick is an
  // immediate hit. Waiting for the exit root let slow/short-lived rounds live
  // inside a player and could make them emerge from the far side.
  if (c <= 0) return 0;
  if (a < 0.00001) return null;
  const b = 2 * (fx * dx + fy * dy);
  const discriminant = b * b - 4 * a * c;
  // Treat a numerically-near-zero discriminant as a real tangent hit. This
  // matters for the shoulder-offset muzzle line, which can graze a target at
  // exactly player radius + projectile radius.
  if (discriminant < -0.000001) return null;
  const root = Math.sqrt(Math.max(0, discriminant)), first = (-b - root) / (2 * a), second = (-b + root) / (2 * a);
  if (first >= 0 && first <= 1) return first;
  return second >= 0 && second <= 1 ? second : null;
}
function movingCircleTime(projectileStart: Point, projectileEnd: Point, targetStart: Point, targetEnd: Point, radius: number): number | null {
  // Transform into the target's frame of reference. The target becomes a
  // stationary circle while the projectile follows the relative segment, so
  // crossing paths are detected even when neither end-of-tick position
  // overlaps the other object.
  return segmentCircle(
    { x: projectileStart.x - targetStart.x, y: projectileStart.y - targetStart.y },
    { x: projectileEnd.x - targetEnd.x, y: projectileEnd.y - targetEnd.y },
    { x: 0, y: 0 },
    radius,
  );
}
function sweptPolygonTime(start: Point, end: Point, radius: number, polygon: Point[]): number | null {
  if (!sweptCircleIntersectsPolygon(start, end, radius, polygon)) return null;
  let low = 0, high = 1;
  for (let pass = 0; pass < 12; pass++) {
    const middle = (low + high) / 2;
    const probe = { x: start.x + (end.x - start.x) * middle, y: start.y + (end.y - start.y) * middle };
    if (sweptCircleIntersectsPolygon(start, probe, radius, polygon)) high = middle; else low = middle;
  }
  return high;
}

export class DustyOrbitSimulation {
  readonly players = new Map<string, DustyPlayer>();
  readonly projectiles: DustyProjectile[] = [];
  readonly pickups: DustyPickup[] = [];
  readonly fartClouds: DustyFartCloud[] = [];
  readonly nukes: DustyNuke[] = [];
  private events: Array<Record<string, unknown>> = [];
  private projectileId = 0;
  private shotId = 0;
  private pickupId = 0;
  private cloudId = 0;
  private nukeId = 0;
  private spawnCursor = 0;
  private joinCursor = 0;
  private readonly positionHistory = new Map<string, DustyPositionSample[]>();
  private readonly playerCollisionAt = new Map<string, number>();
  private readonly random: () => number;
  private readonly validWorldPoints: Point[];
  threatLeaderId: string | null = null;
  tick = 0;

  constructor(random: () => number = Math.random) {
    this.random = random;
    this.validWorldPoints = this.buildValidWorldPoints();
    this.maintainPickups(0);
  }

  addPlayer(id: string, name: string, now: number, options: { skinId?: string; joinedAt?: number } = {}): DustyPlayer {
    const existing = this.players.get(id);
    if (existing) {
      existing.name = name;
      if (options.skinId) existing.skinId = validCharacterSkinId(options.skinId);
      existing.disconnectedAt = 0; existing.lastMessageAt = now; return existing;
    }
    if (this.players.size >= DUSTY_MAX_PLAYERS) throw new Error("arena-full");
    const spawn = this.chooseInitialSpawn();
    const player: DustyPlayer = {
      id, name, skinId: validCharacterSkinId(options.skinId ?? DEFAULT_CHARACTER_SKIN_ID),
      joinedAt: Number.isFinite(options.joinedAt) ? Math.min(now, Number(options.joinedAt)) : now,
      joinOrder: ++this.joinCursor, x: spawn.x, y: spawn.y, vx: 0, vy: 0, aimX: 1, aimY: 0,
      hp: DUSTY_GAMEPLAY.maxHp, kills: 0, deaths: 0, killScore: 0, highScore: 0, weaponTier: 1, nukeProgress: 0,
      nukeReady: false, shieldHits: 0, spyUntil: 0, speedUntil: 0, moleMode: false, moleUntil: 0,
      connectedSatelliteId: null,
      moleForceAt: 0, emergeBlockedUntil: 0, alive: true, respawnAt: 0,
      protectedUntil: now + DUSTY_SPAWN_PROTECTION_MS, lastInputAt: now, lastMessageAt: now,
      lastInputSeq: 0, lastFireAt: Number.NEGATIVE_INFINITY, lastFireInput: false,
      suppressFireUntilRelease: false, lastNukeInput: false, burstRemaining: 0, burstIndex: 0,
      nextBurstAt: 0, disconnectedAt: 0,
      lastProcessedInputSeq: 0, color: COLORS[this.players.size % COLORS.length], input: { ...EMPTY_INPUT }, pendingInput: null,
    };
    this.players.set(id, player);
    this.resetPositionHistory(player, now);
    this.updateThreatLeader();
    this.events.push({ type: "player_joined", player: { id, name, skinId: player.skinId, joinedAt: player.joinedAt } });
    return player;
  }

  markDisconnected(id: string, now: number): void {
    const player = this.players.get(id);
    if (!player) return;
    player.disconnectedAt = now; player.pendingInput = null;
    player.connectedSatelliteId = null;
    player.input = { ...player.input, moveX: 0, moveY: 0, fire: false, nuke: false };
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    this.positionHistory.delete(id);
    for (const key of this.playerCollisionAt.keys()) if (key.split("|").includes(id)) this.playerCollisionAt.delete(key);
    for (let index = this.projectiles.length - 1; index >= 0; index--) if (this.projectiles[index].ownerId === id) this.projectiles.splice(index, 1);
    for (let index = this.nukes.length - 1; index >= 0; index--) if (this.nukes[index].ownerId === id) this.nukes.splice(index, 1);
    this.updateThreatLeader();
    this.events.push({ type: "player_left", player: { id, name: player.name } });
  }

  applyInput(id: string, input: ClientInput, now: number): boolean {
    const player = this.players.get(id);
    if (!player || input.seq <= player.lastInputSeq || input.seq > player.lastInputSeq + 1000) return false;
    const move = normalized(input.moveX, input.moveY), aim = normalized(input.aimX, input.aimY);
    player.pendingInput = {
      ...input, moveX: move.length > 1 ? move.x : input.moveX, moveY: move.length > 1 ? move.y : input.moveY,
      aimX: aim.length ? aim.x : player.aimX, aimY: aim.length ? aim.y : player.aimY, nuke: input.nuke === true,
    };
    player.lastInputSeq = input.seq; player.lastInputAt = now; player.lastMessageAt = now; player.disconnectedAt = 0;
    return true;
  }

  noteMessage(id: string, now: number): void { const player = this.players.get(id); if (player) player.lastMessageAt = now; }

  prepareConnection(id: string, now: number): void {
    const player = this.players.get(id);
    if (!player) return;
    player.pendingInput = null;
    player.input = { ...EMPTY_INPUT, seq: player.lastInputSeq, aimX: player.aimX, aimY: player.aimY };
    player.lastProcessedInputSeq = player.lastInputSeq;
    player.lastInputAt = now;
    player.lastMessageAt = now;
    player.lastFireInput = false;
    player.lastNukeInput = false;
    player.suppressFireUntilRelease = false;
    player.burstRemaining = 0;
    player.vx = 0;
    player.vy = 0;
    player.disconnectedAt = 0;
  }

  debugGrantPowerup(id: string, type: PowerupType, now: number): boolean {
    const player = this.players.get(id);
    if (!player?.alive || player.moleMode) return false;
    const applied = this.applyPowerup(player, type, now);
    if (applied) this.events.push({ type: "powerup_collected", playerId: player.id, pickupId: "debug", powerup: type });
    return applied;
  }

  debugArmNuke(id: string): boolean {
    const player = this.players.get(id);
    if (!player?.alive) return false;
    player.nukeProgress = DUSTY_GAMEPLAY.nukeRequirement; player.nukeReady = true;
    return true;
  }

  /** Tick order: input/effect expiry, movement, pickup collection, actions/bursts,
   * player crashes, nukes, projectile damage, cloud expiry, threat selection, snapshot. */
  step(dt = DUSTY_FIXED_DT, now = Date.now()): void {
    this.tick++;
    this.maintainPickups(now);
    const movementStarts = new Map<string, Point>();
    for (const player of [...this.players.values()]) {
      if ((player.disconnectedAt && now - player.disconnectedAt >= DUSTY_DISCONNECT_GRACE_MS) || now - player.lastMessageAt >= DUSTY_STALE_PLAYER_MS) {
        this.events.push({
          type: "stale",
          playerId: player.id,
          endedAt: now,
          player: {
            id: player.id,
            killScore: Math.max(player.highScore, player.killScore),
            kills: player.kills,
            deaths: player.deaths,
            joinedAt: player.joinedAt,
          },
        });
        this.removePlayer(player.id);
        continue;
      }
      if (!player.alive) {
        player.connectedSatelliteId = null;
        player.pendingInput = null; player.lastProcessedInputSeq = player.lastInputSeq;
        if (now >= player.respawnAt) this.respawnPlayer(player, now);
        continue;
      }
      this.consumePendingInput(player, now);
      this.expirePlayerEffects(player, now);
      const aim = normalized(player.input.aimX, player.input.aimY);
      if (aim.length) { player.aimX = aim.x; player.aimY = aim.y; }
      const move = normalized(player.input.moveX, player.input.moveY);
      const speed = DUSTY_GAMEPLAY.baseMovementSpeed * (player.speedUntil > now ? DUSTY_GAMEPLAY.speedMultiplier : 1);
      player.vx = move.x * speed; player.vy = move.y * speed;
      movementStarts.set(player.id, { x: player.x, y: player.y });
      const displacement = { x: player.vx * dt, y: player.vy * dt };
      const moved = player.moleMode ? { x: player.x + displacement.x, y: player.y + displacement.y } :
        moveCircleWithSliding(player, displacement, DUSTY_PLAYER_RADIUS, DUSTY_POLYGONS);
      player.x = clamp(moved.x, DUSTY_PLAYER_RADIUS, DUSTY_MAP.width - DUSTY_PLAYER_RADIUS);
      player.y = clamp(moved.y, DUSTY_PLAYER_RADIUS, DUSTY_MAP.height - DUSTY_PLAYER_RADIUS);
      this.collectPickups(player, now);
      this.processActions(player, now);
      this.updateSatelliteConnection(player);
      this.recordPosition(player, now);
    }
    this.resolvePlayerCollisions(movementStarts, now);
    this.updateNukes(now);
    this.updateProjectiles(dt, now);
    for (let index = this.fartClouds.length - 1; index >= 0; index--) if (now >= this.fartClouds[index].expiresAt) this.fartClouds.splice(index, 1);
    this.updateThreatLeader();
  }

  private resolvePlayerCollisions(starts: Map<string, Point>, now: number): void {
    const players = [...this.players.values()]
      .filter((player) => player.alive && !player.moleMode && starts.has(player.id))
      .sort((a, b) => a.joinOrder - b.joinOrder || a.id.localeCompare(b.id));
    const collisionDistance = DUSTY_PLAYER_RADIUS * 2;
    for (let first = 0; first < players.length; first++) {
      for (let second = first + 1; second < players.length; second++) {
        const a = players[first], b = players[second];
        if (!a.alive || !b.alive) continue;
        const startA = starts.get(a.id)!, startB = starts.get(b.id)!;
        const startDistance = Math.hypot(startB.x - startA.x, startB.y - startA.y);
        const distance = Math.hypot(b.x - a.x, b.y - a.y);
        if (distance >= collisionDistance || distance >= startDistance - .001) continue;

        // Rewind both pilots to their last server-safe positions. This blocks
        // character overlap without introducing a push that could put either
        // player inside nearby static collision geometry.
        a.x = startA.x; a.y = startA.y; a.vx = 0; a.vy = 0;
        b.x = startB.x; b.y = startB.y; b.vx = 0; b.vy = 0;
        this.resetPositionHistory(a, now); this.resetPositionHistory(b, now);

        const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        const previousImpact = this.playerCollisionAt.get(pairKey) ?? Number.NEGATIVE_INFINITY;
        if (now - previousImpact < DUSTY_PLAYER_COLLISION_COOLDOWN_MS) continue;
        this.playerCollisionAt.set(pairKey, now);
        if (a.protectedUntil > now || b.protectedUntil > now) continue;

        a.hp--; b.hp--;
        this.events.push({ type: "player_hit", cause: "collision", playerId: a.id, ownerId: b.id, hp: Math.max(0, a.hp), damage: 1 });
        this.events.push({ type: "player_hit", cause: "collision", playerId: b.id, ownerId: a.id, hp: Math.max(0, b.hp), damage: 1 });
        const killedIds = [a.hp <= 0 ? a.id : null, b.hp <= 0 ? b.id : null].filter((id): id is string => Boolean(id));
        if (a.hp <= 0) this.killPlayer(a, b.id, now, "collision");
        if (b.hp <= 0) this.killPlayer(b, a.id, now, "collision");
        if (killedIds.length) {
          const calloutIndex = (a.joinOrder + b.joinOrder + this.tick) % COLLISION_KILL_CALLOUTS.length;
          this.events.push({
            type: "collision_kill",
            playerIds: [a.id, b.id],
            playerNames: [a.name, b.name],
            killedIds,
            callout: COLLISION_KILL_CALLOUTS[calloutIndex],
          });
        }
      }
    }
  }

  private resetPositionHistory(player: DustyPlayer, now: number): void {
    this.positionHistory.set(player.id, [{ at: now, x: player.x, y: player.y }]);
  }

  private recordPosition(player: DustyPlayer, now: number): void {
    const samples = this.positionHistory.get(player.id);
    const last = samples?.at(-1);
    // Never rewind through a teleport, respawn, or other discontinuity.
    if (!samples || !last || now < last.at || Math.hypot(player.x - last.x, player.y - last.y) > 120) {
      this.resetPositionHistory(player, now);
      return;
    }
    const sample = { at: now, x: player.x, y: player.y };
    if (last.at === now) samples[samples.length - 1] = sample;
    else samples.push(sample);
    const oldestRequiredAt = now - DUSTY_MAX_HIT_REWIND_MS - 100;
    while (samples.length > 2 && samples[1].at < oldestRequiredAt) samples.shift();
  }

  private positionAt(player: DustyPlayer, at: number): Point {
    const samples = this.positionHistory.get(player.id);
    if (!samples?.length) return player;
    if (at <= samples[0].at) return samples[0];
    for (let index = 1; index < samples.length; index++) {
      const after = samples[index];
      if (at > after.at) continue;
      const before = samples[index - 1];
      const amount = clamp((at - before.at) / Math.max(1, after.at - before.at), 0, 1);
      return { x: before.x + (after.x - before.x) * amount, y: before.y + (after.y - before.y) * amount };
    }
    return samples.at(-1) ?? player;
  }

  private consumePendingInput(player: DustyPlayer, now: number): void {
    if (now - player.lastInputAt > DUSTY_STALE_INPUT_MS) {
      player.pendingInput = null; player.input = { ...player.input, moveX: 0, moveY: 0, fire: false, nuke: false };
    } else if (player.pendingInput) {
      player.input = player.pendingInput; player.lastProcessedInputSeq = player.pendingInput.seq; player.pendingInput = null;
    }
  }

  private expirePlayerEffects(player: DustyPlayer, now: number): void {
    if (player.spyUntil <= now) player.spyUntil = 0;
    if (player.speedUntil <= now) player.speedUntil = 0;
    if (!player.moleMode || now < player.moleUntil) return;
    if (this.isValidNormalPosition(player)) { this.emerge(player, now, "timeout"); return; }
    if (!player.moleForceAt) player.moleForceAt = now + DUSTY_GAMEPLAY.moleForcedEmergenceGraceMs;
    if (now >= player.moleForceAt) {
      const safe = this.nearestValidPoint(player);
      player.x = safe.x; player.y = safe.y;
      this.emerge(player, now, "forced");
    }
  }

  private processActions(player: DustyPlayer, now: number): void {
    const fire = player.input.fire;
    if (player.moleMode) {
      if (fire && !player.lastFireInput) {
        if (this.isValidNormalPosition(player)) {
          // The emergence press is also the ambush shot. Process the weapon in
          // this exact tick and leave held fire active for its normal cadence.
          this.emerge(player, now, "manual");
          this.processWeapon(player, now);
        }
        else { player.emergeBlockedUntil = now + 700; this.events.push({ type: "mole_blocked", playerId: player.id }); }
      }
    } else {
      if (!fire) player.suppressFireUntilRelease = false;
      if (!player.suppressFireUntilRelease) this.processWeapon(player, now);
    }
    const nukePressed = player.input.nuke === true;
    if (nukePressed && !player.lastNukeInput) this.activateNuke(player, now);
    player.lastFireInput = fire; player.lastNukeInput = nukePressed;
  }

  private processWeapon(player: DustyPlayer, now: number): void {
    const weapon = weaponForTier(player.weaponTier);
    // Fire direction is sampled from the exact input being processed on this
    // simulation tick. Never reuse the facing from an earlier round.
    const liveAim = normalized(player.input.aimX, player.input.aimY);
    const aimX = liveAim.length ? liveAim.x : player.aimX;
    const aimY = liveAim.length ? liveAim.y : player.aimY;
    while (player.burstRemaining > 0 && now >= player.nextBurstAt && this.projectiles.length < DUSTY_GAMEPLAY.maxProjectiles) {
      this.spawnProjectile(player, weapon, aimX, aimY, now, ++this.shotId);
      player.burstRemaining--; player.burstIndex++; player.nextBurstAt += weapon.burstSpacingMs;
    }
    if (!player.input.fire || player.burstRemaining > 0 || now - player.lastFireAt < weapon.cooldownMs || this.projectiles.length >= DUSTY_GAMEPLAY.maxProjectiles) return;
    player.protectedUntil = 0; player.lastFireAt = now;
    if (weapon.tier === 3) {
      player.burstIndex = 0;
      player.burstRemaining = weapon.count; player.nextBurstAt = now;
      this.processWeapon(player, now);
      return;
    }
    if (weapon.tier === 5) {
      const shotId = ++this.shotId;
      for (const spreadDegrees of weapon.spreadDegrees) this.spawnProjectile(player, weapon, aimX, aimY, now, shotId, spreadDegrees);
      return;
    }
    this.spawnProjectile(player, weapon, aimX, aimY, now, ++this.shotId);
  }

  private spawnProjectile(player: DustyPlayer, weapon: WeaponDefinition, aimX: number, aimY: number, now: number, shotId: number, spreadDegrees = 0): void {
    if (this.projectiles.length >= DUSTY_GAMEPLAY.maxProjectiles) return;
    const liveAim = normalized(aimX, aimY);
    if (!liveAim.length) return;
    const spreadRadians = spreadDegrees * Math.PI / 180;
    const spreadCos = Math.cos(spreadRadians), spreadSin = Math.sin(spreadRadians);
    const direction = {
      x: liveAim.x * spreadCos - liveAim.y * spreadSin,
      y: liveAim.x * spreadSin + liveAim.y * spreadCos,
    };
    const muzzle = weaponPose({ ...player, aimX: liveAim.x, aimY: liveAim.y }, weaponVisualForTier(weapon.tier), { weaponMount: characterSkinById(player.skinId)?.weaponMount }).muzzleWorld;
    const projectileSpeed = weapon.speed * (player.speedUntil > now ? DUSTY_GAMEPLAY.speedMultiplier : 1);
    const x = muzzle.x, y = muzzle.y;
    const projectile: DustyProjectile = {
      id: ++this.projectileId, ownerId: player.id, tier: weapon.tier, x, y, inputSeq: player.input.seq,
      vx: direction.x * projectileSpeed, vy: direction.y * projectileSpeed, radius: weapon.radius,
      damage: weapon.damage, spawnedAt: now,
      rewindMs: Number.isFinite(player.input.viewAt)
        ? clamp(now - Number(player.input.viewAt), 0, DUSTY_MAX_HIT_REWIND_MS)
        : 0,
      // Turbo changes speed, not the gun's maximum range. Shorten lifetime by
      // the same multiplier so speed * lifetime remains weapon-authored.
      expiresAt: now + weapon.lifetimeMs * weapon.speed / projectileSpeed,
    };
    this.projectiles.push(projectile);
    // A shot event carries the exact barrel direction separately from pellet
    // spread. The client uses this immutable launch pose instead of attaching
    // a delayed confirmation to whichever way the gun points on arrival.
    this.events.push({ type: "shot", shotId, playerId: player.id, x, y, aimX: liveAim.x, aimY: liveAim.y, projectile: { ...projectile } });
  }

  private updateProjectiles(dt: number, now: number): void {
    for (let index = this.projectiles.length - 1; index >= 0; index--) {
      const projectile = this.projectiles[index];
      if (now >= projectile.expiresAt) { this.projectiles.splice(index, 1); continue; }
      const start = { x: projectile.x, y: projectile.y };
      const end = { x: projectile.x + projectile.vx * dt, y: projectile.y + projectile.vy * dt };
      let hit: { t: number; kind: "rock" | "player" | "boundary"; id?: string } | null = null;
      if (end.x < 0 || end.y < 0 || end.x > DUSTY_MAP.width || end.y > DUSTY_MAP.height) hit = { t: 1, kind: "boundary" };
      for (const polygon of DUSTY_PROJECTILE_POLYGONS) {
        const t = sweptPolygonTime(start, end, projectile.radius, polygon);
        if (t !== null && (!hit || t < hit.t)) hit = { t, kind: "rock" };
      }
      for (const player of this.players.values()) {
        // Spawn protection prevents damage, not physical contact. Protected
        // players still absorb the round so it cannot visibly pass through
        // their body; damagePlayer() preserves the immunity below.
        if (!player.alive || player.moleMode || player.id === projectile.ownerId) continue;
        const rewindMs = projectile.rewindMs || 0;
        const targetEnd = this.positionAt(player, now - rewindMs);
        const targetStart = this.positionAt(player, now - rewindMs - dt * 1000);
        const t = movingCircleTime(start, end, targetStart, targetEnd, DUSTY_PLAYER_HIT_RADIUS + projectile.radius);
        if (t !== null && (!hit || t < hit.t)) hit = { t, kind: "player", id: player.id };
      }
      if (!hit) { projectile.x = end.x; projectile.y = end.y; continue; }
      const impactX = start.x + (end.x - start.x) * hit.t, impactY = start.y + (end.y - start.y) * hit.t;
      if (hit.kind === "player" && hit.id) this.damagePlayer(hit.id, projectile, now);
      this.events.push({ type: "impact", projectileId: projectile.id, ownerId: projectile.ownerId, x: impactX, y: impactY, target: hit.kind });
      this.projectiles.splice(index, 1);
    }
  }

  private damagePlayer(id: string, projectile: DustyProjectile, now: number): void {
    const player = this.players.get(id);
    if (!player?.alive || player.moleMode || player.protectedUntil > now) return;
    if (player.shieldHits > 0) {
      player.shieldHits = 0;
      this.events.push({ type: "shield_hit", playerId: id, ownerId: projectile.ownerId, x: player.x, y: player.y });
      return;
    }
    player.hp -= projectile.damage;
    this.events.push({ type: "player_hit", playerId: id, ownerId: projectile.ownerId, hp: Math.max(0, player.hp), damage: projectile.damage });
    if (player.hp <= 0) this.killPlayer(player, projectile.ownerId, now, "projectile");
  }

  private killPlayer(victim: DustyPlayer, killerId: string, now: number, cause: "projectile" | "nuke" | "collision"): void {
    if (!victim.alive) return;
    const killer = this.players.get(killerId);
    const deathX = victim.x, deathY = victim.y;
    victim.alive = false; victim.hp = 0; victim.vx = victim.vy = 0; victim.deaths++;
    victim.highScore = Math.max(victim.highScore, victim.killScore);
    victim.killScore = Math.max(0, victim.killScore - 1);
    victim.weaponTier = Math.max(DUSTY_GAMEPLAY.minWeaponTier, victim.weaponTier - 1);
    victim.spyUntil = 0; victim.speedUntil = 0; victim.shieldHits = 0; victim.moleMode = false; victim.connectedSatelliteId = null;
    victim.moleUntil = 0; victim.moleForceAt = 0; victim.burstRemaining = 0; victim.suppressFireUntilRelease = false;
    victim.input = { ...victim.input, moveX: 0, moveY: 0, fire: false, nuke: false };
    victim.pendingInput = null; victim.lastProcessedInputSeq = victim.lastInputSeq;
    victim.respawnAt = now + DUSTY_RESPAWN_MS; victim.protectedUntil = 0;
    if (killer && killer.id !== victim.id) this.creditKill(killer);
    this.events.push({ type: "kill", cause, killerId, killerName: killer?.name ?? "DUSTY ORBIT", victimId: victim.id, victimName: victim.name, kills: killer?.kills ?? 0 });
    this.events.push({ type: "death", cause, victimId: victim.id, victimName: victim.name, killerId, killerName: killer?.name ?? "DUSTY ORBIT", x: deathX, y: deathY, respawnAt: victim.respawnAt });
  }

  private creditKill(killer: DustyPlayer): void {
    killer.kills++; killer.killScore++;
    killer.highScore = Math.max(killer.highScore, killer.killScore);
    killer.weaponTier = Math.min(DUSTY_GAMEPLAY.maxWeaponTier, killer.weaponTier + 1);
    if (!killer.nukeReady) {
      killer.nukeProgress = Math.min(DUSTY_GAMEPLAY.nukeRequirement, killer.nukeProgress + 1);
      if (killer.nukeProgress >= DUSTY_GAMEPLAY.nukeRequirement) killer.nukeReady = true;
    }
  }

  private activateNuke(player: DustyPlayer, now: number): void {
    if (!player.alive || !player.nukeReady) return;
    // Consume/reset first; kills from detonation charge the next nuke.
    player.nukeReady = false; player.nukeProgress = 0;
    const nuke: DustyNuke = { id: ++this.nukeId, ownerId: player.id, x: player.x, y: player.y, radius: DUSTY_GAMEPLAY.nukeRadius, startedAt: now, detonateAt: now + DUSTY_GAMEPLAY.nukeWarningMs };
    this.nukes.push(nuke);
    this.events.push({ type: "nuke_warning", ...nuke });
  }

  private updateNukes(now: number): void {
    for (let index = this.nukes.length - 1; index >= 0; index--) {
      const nuke = this.nukes[index];
      if (now < nuke.detonateAt) continue;
      const victims = [...this.players.values()].filter((player) => player.alive && !player.moleMode && player.id !== nuke.ownerId && Math.hypot(player.x - nuke.x, player.y - nuke.y) <= nuke.radius);
      victims.sort((a, b) => a.joinOrder - b.joinOrder || a.id.localeCompare(b.id));
      for (const victim of victims) this.killPlayer(victim, nuke.ownerId, now, "nuke");
      this.events.push({ type: "nuke_detonated", id: nuke.id, ownerId: nuke.ownerId, x: nuke.x, y: nuke.y, radius: nuke.radius, victims: victims.map((player) => player.id) });
      this.nukes.splice(index, 1);
    }
  }

  private collectPickups(player: DustyPlayer, now: number): void {
    if (!player.alive || player.moleMode) return;
    const distance = DUSTY_PLAYER_RADIUS + DUSTY_GAMEPLAY.pickupRadius;
    for (const pickup of this.pickups) {
      if (!pickup.active || Math.hypot(player.x - pickup.x, player.y - pickup.y) > distance) continue;
      if (!this.applyPowerup(player, pickup.type, now)) continue;
      pickup.active = false; pickup.respawnAt = now + DUSTY_GAMEPLAY.pickupRespawnMs;
      this.events.push({ type: "powerup_collected", playerId: player.id, pickupId: pickup.id, powerup: pickup.type });
    }
  }

  private applyPowerup(player: DustyPlayer, type: PowerupType, now: number): boolean {
    switch (type) {
      case "spy": player.spyUntil = now + DUSTY_GAMEPLAY.spyDurationMs; return true;
      case "speed": player.speedUntil = now + DUSTY_GAMEPLAY.speedDurationMs; return true;
      case "health": if (player.hp >= DUSTY_GAMEPLAY.maxHp) return false; player.hp++; return true;
      case "shield": if (player.shieldHits > 0) return false; player.shieldHits = 1; return true;
      case "teleport": {
        const destination = this.chooseTeleport(player.id);
        player.x = destination.x; player.y = destination.y; player.vx = player.vy = 0;
        this.resetPositionHistory(player, now);
        this.events.push({ type: "teleport", playerId: player.id, x: player.x, y: player.y }); return true;
      }
      case "mole":
        player.moleMode = true; player.moleUntil = now + DUSTY_GAMEPLAY.moleMaxDurationMs; player.moleForceAt = 0;
        player.burstRemaining = 0; player.lastFireInput = player.input.fire;
        this.resetPositionHistory(player, now);
        this.events.push({ type: "mole_burrowed", playerId: player.id, ...moleBurrowOrigin(player), vx: player.vx, vy: player.vy, at: now });
        return true;
      case "fart": {
        const cloud: DustyFartCloud = { id: ++this.cloudId, ownerId: player.id, x: player.x, y: player.y, radius: DUSTY_GAMEPLAY.fartCloudRadius, growMs: FART_CLOUD_GROW_MS, createdAt: now, expiresAt: now + DUSTY_GAMEPLAY.fartCloudDurationMs };
        this.fartClouds.push(cloud); this.events.push({ type: "fart_cloud", ...cloud }); return true;
      }
    }
  }

  private emerge(player: DustyPlayer, now: number, reason: string): void {
    player.moleMode = false; player.moleUntil = 0; player.moleForceAt = 0;
    player.suppressFireUntilRelease = false;
    this.resetPositionHistory(player, now);
    this.events.push({ type: "mole_emerged", playerId: player.id, x: player.x, y: player.y, reason, at: now });
  }

  private updateSatelliteConnection(player: DustyPlayer): void {
    if (!player.alive || player.moleMode) {
      player.connectedSatelliteId = null;
      return;
    }
    const connected = DUSTY_SATELLITES.find((satellite) => satellite.id === player.connectedSatelliteId);
    if (connected) {
      const edgeGap = Math.max(0, distanceToPolygon(player, connected.polygon) - DUSTY_PLAYER_RADIUS);
      if (edgeGap <= DUSTY_SATELLITE_DISCONNECT_TOLERANCE) return;
    }
    let nearest: (typeof DUSTY_SATELLITES)[number] | null = null;
    let nearestGap = Number.POSITIVE_INFINITY;
    for (const satellite of DUSTY_SATELLITES) {
      const edgeGap = Math.max(0, distanceToPolygon(player, satellite.polygon) - DUSTY_PLAYER_RADIUS);
      if (edgeGap < nearestGap) { nearest = satellite; nearestGap = edgeGap; }
    }
    player.connectedSatelliteId = nearest && nearestGap <= DUSTY_SATELLITE_CONNECT_TOLERANCE ? nearest.id : null;
  }

  private maintainPickups(now: number): void {
    while (this.pickups.length < DUSTY_GAMEPLAY.pickupActiveCount) this.pickups.push({ id: ++this.pickupId, type: "health", x: 0, y: 0, active: false, respawnAt: 0 });
    for (const pickup of this.pickups) {
      if (pickup.active || now < pickup.respawnAt) continue;
      const point = this.choosePickupPoint(pickup.id);
      // The spacing guarantee is hard: if the arena is temporarily too full
      // to find a legal point, leave this pickup dormant and retry next tick.
      if (!point) continue;
      pickup.type = POWERUP_TYPES[Math.floor(this.random() * POWERUP_TYPES.length) % POWERUP_TYPES.length];
      pickup.x = point.x; pickup.y = point.y; pickup.active = true; pickup.respawnAt = 0;
    }
  }

  private buildValidWorldPoints(): Point[] {
    const points: Point[] = [];
    for (let y = 140; y <= DUSTY_MAP.height - 140; y += 180) for (let x = 140; x <= DUSTY_MAP.width - 140; x += 220) {
      const point = { x, y };
      if (this.isValidNormalPosition(point)) points.push(point);
    }
    return points;
  }

  isValidNormalPosition(point: Point): boolean {
    if (point.x < DUSTY_PLAYER_RADIUS || point.y < DUSTY_PLAYER_RADIUS || point.x > DUSTY_MAP.width - DUSTY_PLAYER_RADIUS || point.y > DUSTY_MAP.height - DUSTY_PLAYER_RADIUS) return false;
    return DUSTY_POLYGONS.every((polygon) => !pointInPolygon(point, polygon) && distanceToPolygon(point, polygon) >= DUSTY_PLAYER_RADIUS);
  }

  private choosePickupPoint(ignorePickupId: number): Point | null {
    const start = Math.floor(this.random() * this.validWorldPoints.length);
    let best: Point | null = null;
    let bestPickupDistance = Number.NEGATIVE_INFINITY;
    for (let offset = 0; offset < this.validWorldPoints.length; offset++) {
      const point = this.validWorldPoints[(start + offset) % this.validWorldPoints.length];
      const clearPlayers = [...this.players.values()].every((player) => !player.alive || Math.hypot(point.x - player.x, point.y - player.y) >= DUSTY_GAMEPLAY.pickupPlayerClearance);
      if (!clearPlayers) continue;
      let nearestPickup = Number.POSITIVE_INFINITY;
      for (const pickup of this.pickups) if (pickup.active && pickup.id !== ignorePickupId) {
        nearestPickup = Math.min(nearestPickup, Math.hypot(point.x - pickup.x, point.y - pickup.y));
      }
      if (nearestPickup >= DUSTY_GAMEPLAY.pickupMinimumSpacing && nearestPickup > bestPickupDistance) {
        best = point;
        bestPickupDistance = nearestPickup;
      }
    }
    return best;
  }

  private chooseTeleport(playerId: string): Point {
    const candidates = this.validWorldPoints.filter((point) => [...this.players.values()].every((other) => !other.alive || other.id === playerId || Math.hypot(point.x - other.x, point.y - other.y) >= DUSTY_GAMEPLAY.teleportPlayerClearance));
    const source = candidates.length ? candidates : this.validWorldPoints;
    return source[Math.floor(this.random() * source.length) % source.length] ?? DUSTY_SPAWNS[0];
  }

  private nearestValidPoint(point: Point): Point {
    let best = this.validWorldPoints[0] ?? DUSTY_SPAWNS[0], distance = Number.POSITIVE_INFINITY;
    for (const candidate of this.validWorldPoints) {
      const next = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      if (next < distance) { best = candidate; distance = next; }
    }
    return best;
  }

  private respawnPlayer(player: DustyPlayer, now: number): void {
    const spawn = this.chooseRespawn(player.id);
    Object.assign(player, { x: spawn.x, y: spawn.y, vx: 0, vy: 0, hp: DUSTY_GAMEPLAY.maxHp, alive: true, respawnAt: 0, protectedUntil: now + DUSTY_SPAWN_PROTECTION_MS, lastFireAt: Number.NEGATIVE_INFINITY, lastFireInput: false, lastNukeInput: false, connectedSatelliteId: null });
    this.resetPositionHistory(player, now);
    this.events.push({ type: "respawn", playerId: player.id, x: player.x, y: player.y, protectedUntil: player.protectedUntil });
  }

  private chooseInitialSpawn(): Point { const spawn = DUSTY_SPAWNS[this.spawnCursor % DUSTY_SPAWNS.length]; this.spawnCursor++; return spawn; }
  private chooseRespawn(ignoreId: string): Point {
    const living = [...this.players.values()].filter((player) => player.alive && player.id !== ignoreId);
    if (!living.length) return this.chooseInitialSpawn();
    let best = DUSTY_SPAWNS[0], bestDistance = -1;
    for (const spawn of DUSTY_SPAWNS) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const player of living) nearest = Math.min(nearest, Math.hypot(spawn.x - player.x, spawn.y - player.y));
      if (nearest > bestDistance) { best = spawn; bestDistance = nearest; }
    }
    return best;
  }

  private isConcealed(player: DustyPlayer, now: number): boolean {
    if (!player.alive) return false;
    for (const cloud of this.fartClouds) {
      const activeRadius = cloud.radius * fartCloudGrowth(cloud.createdAt, now, cloud.growMs);
      if (cloud.expiresAt > now && Math.hypot(player.x - cloud.x, player.y - cloud.y) <= activeRadius) return true;
    }
    return false;
  }

  private radarSource(player: DustyPlayer, now: number): "NONE" | "SPY" | "SATELLITE" | "SPY + SATELLITE" {
    const spy = player.spyUntil > now;
    const satellite = DUSTY_SATELLITES.some((item) => item.id === player.connectedSatelliteId);
    if (spy && satellite) return "SPY + SATELLITE";
    if (spy) return "SPY";
    if (satellite) return "SATELLITE";
    return "NONE";
  }

  private updateThreatLeader(): void {
    let leader: DustyPlayer | null = null;
    for (const player of this.players.values()) {
      if (!leader || player.killScore > leader.killScore ||
          (player.killScore === leader.killScore && player.weaponTier > leader.weaponTier) ||
          (player.killScore === leader.killScore && player.weaponTier === leader.weaponTier && player.kills > leader.kills) ||
          (player.killScore === leader.killScore && player.weaponTier === leader.weaponTier && player.kills === leader.kills && (player.joinOrder < leader.joinOrder || (player.joinOrder === leader.joinOrder && player.id < leader.id)))) leader = player;
    }
    this.threatLeaderId = leader?.id ?? null;
  }

  drainEvents(): Array<Record<string, unknown>> { const output = this.events; this.events = []; return output; }

  snapshot(viewerId: string, now = Date.now()): Record<string, unknown> {
    const viewer = this.players.get(viewerId);
    const serializePlayer = (player: DustyPlayer) => ({
      id: player.id, name: player.name, x: round(player.x), y: round(player.y), vx: Math.round(player.vx), vy: Math.round(player.vy),
      aimX: round(player.aimX, 1000), aimY: round(player.aimY, 1000), hp: player.hp, kills: player.kills,
      deaths: player.deaths, killScore: Math.max(0, player.killScore), highScore: Math.max(0, player.highScore, player.killScore), skinId: player.skinId, joinedAt: player.joinedAt,
      weaponTier: player.weaponTier, nukeProgress: player.nukeProgress,
      nukeReady: player.nukeReady, shieldHits: player.shieldHits, spyRemaining: Math.max(0, player.spyUntil - now),
      speedRemaining: Math.max(0, player.speedUntil - now), moleMode: player.moleMode,
      moleRemaining: player.moleMode ? Math.max(0, player.moleUntil - now) : 0,
      emergeBlocked: player.emergeBlockedUntil > now, concealed: this.isConcealed(player, now), alive: player.alive,
      satelliteConnected: DUSTY_SATELLITES.some((item) => item.id === player.connectedSatelliteId),
      connectedSatelliteId: player.connectedSatelliteId,
      respawnAt: player.respawnAt, protectedUntil: player.protectedUntil, color: player.color,
    });
    const visiblePlayers = [...this.players.values()].filter((player) => player.id === viewerId || (!player.moleMode && !this.isConcealed(player, now)));
    const minimapPlayers: Array<Record<string, unknown>> = [];
    if (viewer) for (const player of visiblePlayers) {
      if (!player.alive || player.id === viewerId) continue;
      const threat = player.id === this.threatLeaderId;
      if (threat || this.radarSource(viewer, now) !== "NONE") minimapPlayers.push({ id: player.id, x: round(player.x), y: round(player.y), color: player.color, threat });
    }
    return {
      type: "snapshot", t: now, tick: this.tick, you: {
        id: viewerId,
        ack: viewer?.lastProcessedInputSeq ?? 0,
        radarSource: viewer ? this.radarSource(viewer, now) : "NONE",
        satelliteDistance: viewer ? round(Math.min(...DUSTY_SATELLITES.map((satellite) => Math.max(0, distanceToPolygon(viewer, satellite.polygon) - DUSTY_PLAYER_RADIUS)))) : null,
        nearestSatelliteId: viewer ? DUSTY_SATELLITES.reduce((nearest, satellite) => {
          const gap = Math.max(0, distanceToPolygon(viewer, satellite.polygon) - DUSTY_PLAYER_RADIUS);
          return gap < nearest.gap ? { id: satellite.id, gap } : nearest;
        }, { id: null as string | null, gap: Number.POSITIVE_INFINITY }).id : null,
      },
      players: visiblePlayers.map(serializePlayer),
      projectiles: this.projectiles.map((projectile) => ({ id: projectile.id, ownerId: projectile.ownerId, tier: projectile.tier, x: round(projectile.x), y: round(projectile.y), vx: Math.round(projectile.vx), vy: Math.round(projectile.vy), radius: projectile.radius, spawnedAt: projectile.spawnedAt, expiresAt: projectile.expiresAt, inputSeq: projectile.inputSeq })),
      pickups: this.pickups.filter((pickup) => pickup.active).map(({ id, type, x, y, active }) => ({ id, type, x, y, active })),
      fartClouds: this.fartClouds.map((cloud) => ({ ...cloud })),
      nukes: this.nukes.map((nuke) => ({ ...nuke })),
      threatLeaderId: this.threatLeaderId,
      activeSatelliteIds: DUSTY_SATELLITES.filter((satellite) => [...this.players.values()].some((player) => player.alive && player.connectedSatelliteId === satellite.id)).map((satellite) => satellite.id),
      minimapPlayers,
    };
  }

  lobbyState(now = Date.now()): Record<string, unknown> {
    const players = [...this.players.values()]
      .sort((a, b) => Math.max(0, b.killScore) - Math.max(0, a.killScore) || b.kills - a.kills || a.joinOrder - b.joinOrder || a.id.localeCompare(b.id))
      .map((player) => ({
        id: player.id,
        name: player.name,
        skinId: player.skinId,
        killScore: Math.max(0, player.killScore),
        kills: player.kills,
        joinedAt: player.joinedAt,
      }));
    return {
      type: "lobby_state",
      arenaId: DUSTY_MAP.id,
      serverTime: now,
      activePlayers: players.length,
      maxPlayers: DUSTY_MAX_PLAYERS,
      full: players.length >= DUSTY_MAX_PLAYERS,
      players,
    };
  }
}
