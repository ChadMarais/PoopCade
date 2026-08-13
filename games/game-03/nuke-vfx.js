export const NUKE_EFFECT_DURATION_MS = 1500;
export const NUKE_FLASH_DURATION_MS = 90;
export const NUKE_SHAKE_DURATION_MS = 360;

function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function smoothstep(value) { const t = clamp01(value); return t * t * (3 - 2 * t); }
export function easeOutCubic(value) { const t = clamp01(value); return 1 - (1 - t) ** 3; }

function phase(elapsedMs, startMs, durationMs) {
  return clamp01((elapsedMs - startMs) / Math.max(1, durationMs));
}

export function nukeTimeline(elapsedMs) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const ignitionProgress = easeOutCubic(phase(elapsed, 0, 105));
  const ignitionAlpha = 1 - smoothstep(phase(elapsed, 55, 190));
  const coreProgress = easeOutCubic(phase(elapsed, 35, 440));
  const coreAlpha = 1 - smoothstep(phase(elapsed, 330, 520));
  const shockwaveProgress = easeOutCubic(phase(elapsed, 100, 650));
  const shockwaveAlpha = 1 - smoothstep(phase(elapsed, 500, 420));
  const secondaryProgress = easeOutCubic(phase(elapsed, 220, 790));
  const secondaryAlpha = (1 - smoothstep(phase(elapsed, 610, 500))) * smoothstep(phase(elapsed, 180, 100));
  const plasmaProgress = easeOutCubic(phase(elapsed, 130, 850));
  const plasmaAlpha = (1 - smoothstep(phase(elapsed, 720, 650))) * smoothstep(phase(elapsed, 70, 180));
  return {
    elapsed,
    amount: clamp01(elapsed / NUKE_EFFECT_DURATION_MS),
    ignitionProgress,
    ignitionAlpha,
    coreProgress,
    coreAlpha,
    shockwaveProgress,
    shockwaveAlpha,
    secondaryProgress,
    secondaryAlpha,
    plasmaProgress,
    plasmaAlpha,
    flashAlpha: 1 - smoothstep(phase(elapsed, 0, NUKE_FLASH_DURATION_MS)),
    shakeAmount: 1 - smoothstep(phase(elapsed, 0, NUKE_SHAKE_DURATION_MS)),
    decayAlpha: 1 - smoothstep(phase(elapsed, 900, 600)),
  };
}

export function nukeWarningTimeline(startedAt, detonateAt, now = Date.now()) {
  const duration = Math.max(1, Number(detonateAt) - Number(startedAt));
  const elapsed = Math.max(0, Number(now) - Number(startedAt));
  const amount = clamp01(elapsed / duration);
  return {
    amount,
    remainingMs: Math.max(0, Number(detonateAt) - Number(now)),
    finalCharge: smoothstep((amount - .72) / .28),
  };
}

function seededUnit(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function colorForParticle(type, variation) {
  if (type === "white-streak") return variation > .55 ? "#fff6e5" : "#ffffff";
  if (type === "violet-fragment") return variation > .5 ? "#c66cff" : "#8d68ff";
  if (type === "magenta-fragment") return variation > .5 ? "#ff59e6" : "#e44dff";
  return variation > .5 ? "#78f7ff" : "#38cfff";
}

export function createNukeBurst(seed, radius, particleCount = 64, shardCount = 12) {
  const safeSeed = Number(seed) || 1;
  const safeRadius = Math.max(1, Number(radius) || 1);
  const particleTypes = ["cyan-spark", "violet-fragment", "white-streak", "cyan-spark", "magenta-fragment"];
  const particles = Array.from({ length: Math.max(0, particleCount) }, (_, index) => {
    const unit = seededUnit(safeSeed * 17 + index * 11.73);
    const angle = Math.PI * 2 * (index / Math.max(1, particleCount) + (seededUnit(safeSeed + index * 3.1) - .5) * .075);
    const type = particleTypes[index % particleTypes.length];
    return {
      type,
      angle,
      distance: (.34 + unit * .64) * safeRadius,
      drift: (seededUnit(safeSeed * 7 + index * 5.9) - .5) * .34,
      size: type === "white-streak" ? 1.2 + unit * 1.7 : 2 + unit * 4.2,
      stretch: type === "white-streak" ? 6 + unit * 7 : type === "cyan-spark" ? 2.2 + unit * 3 : 1 + unit * 1.2,
      delay: seededUnit(safeSeed * 13 + index * 9.7) * 125,
      life: 470 + seededUnit(safeSeed * 19 + index * 4.3) * 430,
      color: colorForParticle(type, seededUnit(safeSeed * 23 + index)),
      spin: (seededUnit(safeSeed * 29 + index * 2.7) - .5) * 4.5,
    };
  });
  const shardColors = ["#ffffff", "#67efff", "#a884ff", "#ef6dff"];
  const shards = Array.from({ length: Math.max(0, shardCount) }, (_, index) => {
    const unit = seededUnit(safeSeed * 37 + index * 8.17);
    return {
      angle: Math.PI * 2 * (index / Math.max(1, shardCount) + (unit - .5) * .045),
      distance: (.42 + unit * .42) * safeRadius,
      length: 34 + seededUnit(safeSeed * 41 + index * 4.9) * 74,
      width: 1.2 + seededUnit(safeSeed * 43 + index * 3.3) * 2.4,
      delay: seededUnit(safeSeed * 47 + index) * 80,
      life: 250 + seededUnit(safeSeed * 53 + index * 6.1) * 190,
      color: shardColors[index % shardColors.length],
    };
  });
  const lobes = Array.from({ length: 9 }, (_, index) => ({
    angle: Math.PI * 2 * index / 9 + seededUnit(safeSeed * 59 + index) * .42,
    orbit: .11 + seededUnit(safeSeed * 61 + index * 2.1) * .27,
    radius: .17 + seededUnit(safeSeed * 67 + index * 5.7) * .17,
    squash: .62 + seededUnit(safeSeed * 71 + index * 4.7) * .35,
    colorIndex: index % 3,
  }));
  return { particles, shards, lobes };
}
