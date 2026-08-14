import { DUSTY_PLAYER_SPEED } from "./dusty-map.ts";

export type PowerupType = "spy" | "speed" | "health" | "shield" | "teleport" | "mole" | "fart";

export type WeaponDefinition = {
  tier: number;
  name: string;
  cooldownMs: number;
  speed: number;
  lifetimeMs: number;
  damage: number;
  radius: number;
  count: number;
  spreadDegrees: readonly number[];
  burstSpacingMs: number;
  muzzleDistance: number;
};

export const DUSTY_WEAPONS: readonly WeaponDefinition[] = Object.freeze([
  Object.freeze({ tier: 1, name: "PEA SHOOTER", cooldownMs: 1000, speed: 500, lifetimeMs: 500, damage: 1, radius: 3, count: 1, spreadDegrees: [0], burstSpacingMs: 0, muzzleDistance: 36 }),
  Object.freeze({ tier: 2, name: "PISTOL", cooldownMs: 700, speed: 600, lifetimeMs: 750, damage: 1, radius: 3.2, count: 1, spreadDegrees: [0], burstSpacingMs: 0, muzzleDistance: 36 }),
  Object.freeze({ tier: 3, name: "BURST", cooldownMs: 800, speed: 650, lifetimeMs: 800, damage: 1, radius: 3.2, count: 3, spreadDegrees: [0, 0, 0], burstSpacingMs: 90, muzzleDistance: 36 }),
  Object.freeze({ tier: 4, name: "SMG", cooldownMs: 220, speed: 700, lifetimeMs: 900, damage: 1, radius: 3, count: 1, spreadDegrees: [0], burstSpacingMs: 0, muzzleDistance: 36 }),
  Object.freeze({ tier: 5, name: "SHOTGUN", cooldownMs: 850, speed: 700, lifetimeMs: 550, damage: 1, radius: 3, count: 3, spreadDegrees: [-8, 0, 8], burstSpacingMs: 0, muzzleDistance: 36 }),
  Object.freeze({ tier: 6, name: "PLASMA CANNON", cooldownMs: 450, speed: 1200, lifetimeMs: 1000, damage: 2, radius: 6, count: 1, spreadDegrees: [0], burstSpacingMs: 0, muzzleDistance: 42 }),
]);

export const POWERUP_TYPES: readonly PowerupType[] = Object.freeze(["spy", "speed", "health", "shield", "teleport", "mole", "fart"]);

export const DUSTY_GAMEPLAY = Object.freeze({
  maxHp: 3,
  baseMovementSpeed: DUSTY_PLAYER_SPEED,
  speedMultiplier: 2,
  spyDurationMs: 10_000,
  speedDurationMs: 10_000,
  moleMaxDurationMs: 10_000,
  moleForcedEmergenceGraceMs: 2_000,
  fartCloudDurationMs: 5_000,
  fartCloudRadius: 360,
  pickupActiveCount: 6,
  // A 4.3s interval is thirty percent more frequent than the previous 5.6s
  // cadence (5.6 / 1.3), without weakening the spacing guarantees.
  pickupRespawnMs: 4_300,
  pickupRadius: 18,
  // Three quarters of the 1280px reference gameplay viewport. This is a world
  // distance so every client sees the same authoritative pickup distribution.
  pickupMinimumSpacing: 960,
  pickupPlayerClearance: 80,
  teleportPlayerClearance: 120,
  nukeRequirement: 10,
  nukeRadius: 700,
  nukeWarningMs: 1_000,
  maxStoredNukes: 1,
  minWeaponTier: 1,
  maxWeaponTier: 6,
  maxProjectiles: 300,
});

export function weaponForTier(tier: number): WeaponDefinition {
  return DUSTY_WEAPONS[Math.max(0, Math.min(DUSTY_WEAPONS.length - 1, Math.trunc(tier) - 1))];
}
