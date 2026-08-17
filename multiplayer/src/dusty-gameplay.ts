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
  rarity?: "DUD" | "AVERAGE" | "LEGENDARY";
  powerScore?: number;
  visualTier?: number;
};

export type GeneratedWeaponDefinition = WeaponDefinition & {
  generated: true;
  rarity: "DUD" | "AVERAGE" | "LEGENDARY";
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
  const prefixes = rarity === "LEGENDARY"
    ? ["REALITY-SHREDDING", "GALAXY-EATING", "FORBIDDEN", "OMEGA"]
    : rarity === "DUD"
      ? ["BARGAIN-BIN", "DAMP", "WARRANTY-VOID", "SUSPICIOUS", "HALF-CHARGED"]
      : ["FERAL", "TURBO", "UNLICENSED", "DOUBLE-TROUBLE", "HOT-ROD"];
  return `${prefixes[Math.floor(unit(random) * prefixes.length)]} ${pattern}`;
}

function generatedWeapon(rarity: GeneratedWeaponDefinition["rarity"], powerScore: number, name: string, definition: Omit<WeaponDefinition, "tier" | "name"> & { tier?: number }): GeneratedWeaponDefinition {
  return Object.freeze({
    ...definition,
    tier: definition.tier ?? (rarity === "LEGENDARY" ? 6 : rarity === "AVERAGE" ? 4 : 1),
    name,
    visualTier: 7,
    generated: true,
    rarity,
    powerScore,
    spreadDegrees: Object.freeze([...definition.spreadDegrees]),
  });
}

/** Server-only weighted roll: duds 55%, useful oddballs 43%, legendary weapons 2%. */
export function generateRandomWeapon(random: () => number = Math.random): GeneratedWeaponDefinition {
  const roll = unit(random);
  const rarity: GeneratedWeaponDefinition["rarity"] = roll < .55 ? "DUD" : roll < .98 ? "AVERAGE" : "LEGENDARY";
  const archetype = unit(random);

  if (rarity === "DUD") {
    if (archetype < .2) return generatedWeapon(rarity, .2, generatedName(random, rarity, "BACKWARDS BLASTER"), {
      cooldownMs: Math.round(between(random, 1300, 2200)), speed: Math.round(between(random, 340, 500)), lifetimeMs: Math.round(between(random, 450, 750)),
      damage: 1, radius: 2.5, count: 1, spreadDegrees: [180], burstSpacingMs: 0, muzzleDistance: 48,
    });
    if (archetype < .4) return generatedWeapon(rarity, .7, generatedName(random, rarity, "SNEEZE CANNON"), {
      cooldownMs: Math.round(between(random, 1800, 2700)), speed: Math.round(between(random, 260, 390)), lifetimeMs: Math.round(between(random, 180, 300)),
      damage: 1, radius: 2.2, count: 5, spreadDegrees: [-38, -17, 3, 22, 41], burstSpacingMs: 0, muzzleDistance: 48,
    });
    if (archetype < .6) return generatedWeapon(rarity, .8, generatedName(random, rarity, "BUDGET BURST"), {
      cooldownMs: Math.round(between(random, 2100, 3100)), speed: Math.round(between(random, 300, 470)), lifetimeMs: Math.round(between(random, 360, 520)),
      damage: 1, radius: 2.5, count: 3, spreadDegrees: [-19, 13, -7], burstSpacingMs: Math.round(between(random, 320, 480)), muzzleDistance: 48,
    });
    if (archetype < .8) return generatedWeapon(rarity, .5, generatedName(random, rarity, "WET-NOODLE RAILGUN"), {
      cooldownMs: Math.round(between(random, 1600, 2500)), speed: Math.round(between(random, 1300, 1800)), lifetimeMs: Math.round(between(random, 70, 145)),
      damage: 1, radius: 1.4, count: 1, spreadDegrees: [0], burstSpacingMs: 0, muzzleDistance: 48,
    });
    const crookedAngle = between(random, 20, 44) * (unit(random) < .5 ? -1 : 1);
    return generatedWeapon(rarity, 1, generatedName(random, rarity, "CROOKED PEA FLINGER"), {
      cooldownMs: Math.round(between(random, 1050, 1900)), speed: Math.round(between(random, 350, 520)), lifetimeMs: Math.round(between(random, 380, 620)),
      damage: 1, radius: 3, count: 1, spreadDegrees: [crookedAngle], burstSpacingMs: 0, muzzleDistance: 48,
    });
  }

  if (rarity === "AVERAGE") {
    if (archetype < 1 / 6) return generatedWeapon(rarity, 4.8, generatedName(random, rarity, "CHAOS FAN"), {
      cooldownMs: Math.round(between(random, 760, 1100)), speed: Math.round(between(random, 580, 780)), lifetimeMs: Math.round(between(random, 520, 760)),
      damage: 1, radius: 3, count: 5, spreadDegrees: [-27, -9, 2, 15, 34], burstSpacingMs: 0, muzzleDistance: 48,
    });
    if (archetype < 2 / 6) return generatedWeapon(rarity, 5.2, generatedName(random, rarity, "STUTTER BURST"), {
      cooldownMs: Math.round(between(random, 680, 980)), speed: Math.round(between(random, 620, 820)), lifetimeMs: Math.round(between(random, 650, 900)),
      damage: 1, radius: 3, count: 5, spreadDegrees: [-11, 8, -5, 14, 0], burstSpacingMs: Math.round(between(random, 65, 125)), muzzleDistance: 48,
    });
    if (archetype < 3 / 6) return generatedWeapon(rarity, 4.5, generatedName(random, rarity, "COMET HOSE"), {
      cooldownMs: Math.round(between(random, 150, 290)), speed: Math.round(between(random, 400, 680)), lifetimeMs: Math.round(between(random, 850, 1250)),
      damage: 1, radius: between(random, 3.2, 4.8), count: 1, spreadDegrees: [between(random, -4, 4)], burstSpacingMs: 0, muzzleDistance: 48,
    });
    if (archetype < 4 / 6) return generatedWeapon(rarity, 5.5, generatedName(random, rarity, "BIG SLOW ORB"), {
      cooldownMs: Math.round(between(random, 720, 1050)), speed: Math.round(between(random, 240, 380)), lifetimeMs: Math.round(between(random, 1700, 2400)),
      damage: 2, radius: between(random, 8, 11), count: 1, spreadDegrees: [0], burstSpacingMs: 0, muzzleDistance: 48,
    });
    if (archetype < 5 / 6) return generatedWeapon(rarity, 5.8, generatedName(random, rarity, "NEEDLE VOLLEY"), {
      cooldownMs: Math.round(between(random, 580, 820)), speed: Math.round(between(random, 980, 1300)), lifetimeMs: Math.round(between(random, 700, 980)),
      damage: 1, radius: 2, count: 3, spreadDegrees: [-2.5, 0, 2.5], burstSpacingMs: 0, muzzleDistance: 48,
    });
    return generatedWeapon(rarity, 5, generatedName(random, rarity, "SIDEWINDER"), {
      cooldownMs: Math.round(between(random, 800, 1150)), speed: Math.round(between(random, 650, 900)), lifetimeMs: Math.round(between(random, 650, 950)),
      damage: 1, radius: 3.5, count: 5, spreadDegrees: [18, -18, 9, -9, 0], burstSpacingMs: Math.round(between(random, 55, 100)), muzzleDistance: 48,
    });
  }

  if (archetype < .25) return generatedWeapon(rarity, 16, generatedName(random, rarity, "UNIVERSE DELETER"), {
    cooldownMs: Math.round(between(random, 105, 155)), speed: Math.round(between(random, 1750, 2200)), lifetimeMs: Math.round(between(random, 1200, 1550)),
    damage: 5, radius: between(random, 10, 14), count: 1, spreadDegrees: [0], burstSpacingMs: 0, muzzleDistance: 52,
  });
  if (archetype < .5) return generatedWeapon(rarity, 15, generatedName(random, rarity, "SINGULARITY SPRINKLER"), {
    cooldownMs: Math.round(between(random, 180, 280)), speed: Math.round(between(random, 1400, 1800)), lifetimeMs: Math.round(between(random, 1050, 1400)),
    damage: 3, radius: 7, count: 9, spreadDegrees: [-32, -24, -16, -8, 0, 8, 16, 24, 32], burstSpacingMs: 0, muzzleDistance: 52,
  });
  if (archetype < .75) return generatedWeapon(rarity, 18, generatedName(random, rarity, "DOOM ACCORDION"), {
    cooldownMs: Math.round(between(random, 240, 360)), speed: Math.round(between(random, 1350, 1750)), lifetimeMs: Math.round(between(random, 1050, 1450)),
    damage: 2, radius: 6, count: 12, spreadDegrees: [-20, 20, -15, 15, -10, 10, -5, 5, -2, 2, 0, 0], burstSpacingMs: Math.round(between(random, 22, 38)), muzzleDistance: 52,
  });
  return generatedWeapon(rarity, 17, generatedName(random, rarity, "TRIPLE APOCALYPSE"), {
    cooldownMs: Math.round(between(random, 120, 190)), speed: Math.round(between(random, 1550, 2000)), lifetimeMs: Math.round(between(random, 1150, 1500)),
    damage: 4, radius: 9, count: 3, spreadDegrees: [-3, 0, 3], burstSpacingMs: 0, muzzleDistance: 52,
  });
}
