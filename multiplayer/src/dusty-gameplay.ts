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
  generated?: boolean;
  rarity?: "WEAK" | "COMMON" | "POWERFUL" | "CHAOTIC";
  powerScore?: number;
  visualTier?: number;
};

export type GeneratedWeaponDefinition = WeaponDefinition & {
  generated: true;
  rarity: "WEAK" | "COMMON" | "POWERFUL" | "CHAOTIC";
  powerScore: number;
  visualTier: number;
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

function unit(random: () => number): number {
  const value = Number(random());
  return Number.isFinite(value) ? Math.max(0, Math.min(.999999, value)) : 0;
}

function between(random: () => number, minimum: number, maximum: number): number {
  return minimum + (maximum - minimum) * unit(random);
}

function generatedName(random: () => number, rarity: GeneratedWeaponDefinition["rarity"], pattern: string): string {
  const prefixes = rarity === "CHAOTIC"
    ? ["REALITY SHREDDER", "GALAXY BLENDER", "VOID TANTRUM"]
    : rarity === "POWERFUL"
      ? ["OVERCHARGED", "APOCALYPSE", "STAR-EATER"]
      : rarity === "WEAK"
        ? ["LUCKY", "JUNIOR", "POCKET"]
        : ["TURBO", "FERAL", "DOUBLE-TROUBLE", "UNREASONABLE", "HOT-ROD"];
  return `${prefixes[Math.floor(unit(random) * prefixes.length)]} ${pattern}`;
}

/** Server-only weighted weapon roll. Weak 8%, common 86%, powerful 5%, chaotic 1%. */
export function generateRandomWeapon(random: () => number = Math.random): GeneratedWeaponDefinition {
  const roll = unit(random);
  const rarity: GeneratedWeaponDefinition["rarity"] = roll < .08 ? "WEAK" : roll < .94 ? "COMMON" : roll < .99 ? "POWERFUL" : "CHAOTIC";

  if (rarity === "CHAOTIC") {
    const count = unit(random) < .5 ? 3 : 5;
    const spreadDegrees = count === 3 ? [-6, 0, 6] : [-10, -5, 0, 5, 10];
    const cooldownMs = Math.round(between(random, 190, 270));
    const speed = Math.round(between(random, 1300, 1550));
    const lifetimeMs = Math.round(between(random, 950, 1200));
    const damage = unit(random) < .35 ? 3 : 2;
    return Object.freeze({
      tier: 6, visualTier: 7, generated: true, rarity, powerScore: 10,
      name: generatedName(random, rarity, "SINGULARITY ARRAY"), cooldownMs, speed, lifetimeMs,
      damage, radius: 7, count, spreadDegrees: Object.freeze(spreadDegrees), burstSpacingMs: 0, muzzleDistance: 48,
    });
  }

  if (rarity === "POWERFUL") {
    const base = DUSTY_WEAPONS[5];
    const count = unit(random) < .28 ? 2 : 1;
    const spreadDegrees = count === 2 ? [-3, 3] : [0];
    return Object.freeze({
      ...base, visualTier: 7, generated: true, rarity, powerScore: 8,
      name: generatedName(random, rarity, count > 1 ? "TWIN PLASMA" : "PLASMA CANNON"),
      cooldownMs: Math.round(base.cooldownMs * between(random, .72, .9)),
      speed: Math.round(base.speed * between(random, 1.05, 1.22)),
      lifetimeMs: Math.round(base.lifetimeMs * between(random, 1, 1.14)),
      count, spreadDegrees: Object.freeze(spreadDegrees), muzzleDistance: 48,
    });
  }

  if (rarity === "WEAK") {
    const base = unit(random) < .42 ? DUSTY_WEAPONS[0] : DUSTY_WEAPONS[1];
    return Object.freeze({
      ...base, visualTier: 7, generated: true, rarity, powerScore: base.tier === 1 ? 2 : 3,
      name: generatedName(random, rarity, base.tier === 1 ? "PEA SHOOTER" : "PISTOL"),
      // A generated weak roll is never worse than the stock Pea Shooter.
      cooldownMs: Math.min(1000, Math.round(base.cooldownMs * between(random, .82, .98))),
      speed: Math.max(500, Math.round(base.speed * between(random, 1, 1.1))),
      lifetimeMs: Math.max(500, Math.round(base.lifetimeMs * between(random, 1, 1.1))),
      spreadDegrees: Object.freeze([...base.spreadDegrees]),
    });
  }

  const commonTier = 3 + Math.floor(unit(random) * 3);
  const base = DUSTY_WEAPONS[commonTier - 1];
  const patternRoll = unit(random);
  let count = base.count;
  let spreadDegrees = [...base.spreadDegrees];
  let burstSpacingMs = base.burstSpacingMs;
  let pattern = base.name;
  if (patternRoll < .28) {
    count = 3; spreadDegrees = [0]; burstSpacingMs = Math.round(between(random, 65, 115)); pattern = "BURST HYBRID";
  } else if (patternRoll < .58) {
    count = unit(random) < .78 ? 3 : 5;
    spreadDegrees = count === 3 ? [-8, 0, 8] : [-12, -6, 0, 6, 12];
    burstSpacingMs = 0; pattern = "SCATTER HYBRID";
  }
  return Object.freeze({
    ...base, visualTier: 7, generated: true, rarity, powerScore: 4 + commonTier - 3,
    name: generatedName(random, rarity, pattern),
    cooldownMs: Math.round(base.cooldownMs * between(random, .82, 1.06)),
    speed: Math.round(base.speed * between(random, .94, 1.14)),
    lifetimeMs: Math.round(base.lifetimeMs * between(random, .92, 1.12)),
    count, spreadDegrees: Object.freeze(spreadDegrees), burstSpacingMs,
  });
}
