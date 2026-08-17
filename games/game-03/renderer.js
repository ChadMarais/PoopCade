import { weaponPose, weaponVisualForTier } from "./weapon-visuals.js?v=20260817-1";
import { fartCloudGrowth } from "./effect-timing.js?v=20260813";
import { sweptCircleIntersectsPolygon } from "./collision-geometry.js?v=20260817-5";
import {
  NUKE_EFFECT_DURATION_MS,
  createNukeBurst,
  easeOutCubic,
  nukeTimeline,
  nukeWarningTimeline,
} from "./nuke-vfx.js?v=20260813";

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
const MAX_RENDER_PIXELS = 2_500_000;
const MIN_RENDER_SCALE = .65;
const MAX_RENDER_SCALE = 1;
const STATIC_CHUNK_SIZE = 512;
const STATIC_CHUNK_SCALE = .75;
const MAX_STATIC_CHUNKS = 48;
const EFFECT_QUALITY_LEVELS = [.4, .7, 1];
export function nextEffectsQuality(current, frameTimeMs, elapsedMs) {
  const index = Math.max(0, EFFECT_QUALITY_LEVELS.indexOf(current));
  if (frameTimeMs > 17.5 && elapsedMs > 650) return EFFECT_QUALITY_LEVELS[Math.max(0, index - 1)];
  if (frameTimeMs < 14.5 && elapsedMs > 4500) return EFFECT_QUALITY_LEVELS[Math.min(EFFECT_QUALITY_LEVELS.length - 1, index + 1)];
  return current;
}
export function renderScaleForViewport(width, height, nativeScale = 1, qualityScale = 1) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const nativeDpr = Math.min(MAX_RENDER_SCALE, Math.max(MIN_RENDER_SCALE, Number(nativeScale) || 1));
  const baseScale = Math.min(nativeDpr, Math.sqrt(MAX_RENDER_PIXELS / (safeWidth * safeHeight)));
  return Math.max(MIN_RENDER_SCALE, baseScale * clamp(Number(qualityScale) || 1, .7, 1));
}
function drawNineSliceBoundary(ctx, overlay, x, y, width, height, inset) {
  const image = overlay.image;
  const source = overlay.sourceInset;
  if (!image || !source) return;
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const centerSourceWidth = sourceWidth - source.left - source.right;
  const centerSourceHeight = sourceHeight - source.top - source.bottom;
  const centerWidth = Math.max(0, width - inset.left - inset.right);
  const centerHeight = Math.max(0, height - inset.top - inset.bottom);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const horizontalEdge = (sourceY, sourceBandHeight, destinationY, destinationBandHeight) => {
    const scale = destinationBandHeight / sourceBandHeight;
    let drawn = 0;
    while (drawn < centerWidth - .01) {
      const sourceDrawWidth = Math.min(centerSourceWidth, (centerWidth - drawn) / scale);
      const destinationDrawWidth = sourceDrawWidth * scale;
      ctx.drawImage(image, source.left, sourceY, sourceDrawWidth, sourceBandHeight, x + inset.left + drawn, destinationY, destinationDrawWidth, destinationBandHeight);
      drawn += destinationDrawWidth;
    }
  };
  const verticalEdge = (sourceX, sourceBandWidth, destinationX, destinationBandWidth) => {
    const scale = destinationBandWidth / sourceBandWidth;
    let drawn = 0;
    while (drawn < centerHeight - .01) {
      const sourceDrawHeight = Math.min(centerSourceHeight, (centerHeight - drawn) / scale);
      const destinationDrawHeight = sourceDrawHeight * scale;
      ctx.drawImage(image, sourceX, source.top, sourceBandWidth, sourceDrawHeight, destinationX, y + inset.top + drawn, destinationBandWidth, destinationDrawHeight);
      drawn += destinationDrawHeight;
    }
  };
  horizontalEdge(0, source.top, y, inset.top);
  horizontalEdge(sourceHeight - source.bottom, source.bottom, y + height - inset.bottom, inset.bottom);
  verticalEdge(0, source.left, x, inset.left);
  verticalEdge(sourceWidth - source.right, source.right, x + width - inset.right, inset.right);
  const corners = [
    [0, 0, source.left, source.top, x, y, inset.left, inset.top],
    [sourceWidth - source.right, 0, source.right, source.top, x + width - inset.right, y, inset.right, inset.top],
    [0, sourceHeight - source.bottom, source.left, source.bottom, x, y + height - inset.bottom, inset.left, inset.bottom],
    [sourceWidth - source.right, sourceHeight - source.bottom, source.right, source.bottom, x + width - inset.right, y + height - inset.bottom, inset.right, inset.bottom],
  ];
  for (const corner of corners) ctx.drawImage(image, ...corner);
  ctx.restore();
}
function drawPolygonBoundary(ctx, overlay, points, offsetX = 0, offsetY = 0, scaleX = 1, scaleY = 1, viewportWidth = Infinity, viewportHeight = Infinity) {
  const image = overlay.image;
  if (!image || !Array.isArray(points) || points.length < 3) return;
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const destinationHeight = Math.max(1, (Number(overlay.thickness) || 300) * (scaleX + scaleY) / 2);
  const sourceScale = destinationHeight / sourceHeight;
  const anchorY = (Number(overlay.sourceAnchorY) || sourceHeight * .6) * sourceScale;
  const overlap = Math.max(0, (Number(overlay.overlap) || 0) * (scaleX + scaleY) / 2);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const startX = offsetX + start.x * scaleX;
    const startY = offsetY + start.y * scaleY;
    const dx = (end.x - start.x) * scaleX;
    const dy = (end.y - start.y) * scaleY;
    const length = Math.hypot(dx, dy);
    if (length < 1) continue;
    const margin = destinationHeight + overlap;
    if (Math.max(startX, startX + dx) < -margin || Math.min(startX, startX + dx) > viewportWidth + margin
      || Math.max(startY, startY + dy) < -margin || Math.min(startY, startY + dy) > viewportHeight + margin) continue;

    const drawWidth = length + overlap * 2;
    const requiredSourceWidth = Math.min(sourceWidth, drawWidth / sourceScale);
    const availableOffset = Math.max(0, sourceWidth - requiredSourceWidth);
    const sourceX = availableOffset * seededUnit(index * 47.13 + 9);
    ctx.save();
    ctx.translate(startX, startY);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.drawImage(
      image,
      sourceX, 0, requiredSourceWidth, sourceHeight,
      -overlap, -anchorY, drawWidth, destinationHeight,
    );
    ctx.restore();
  }
  ctx.restore();
}
function tracePolygon(ctx, points, offsetX = 0, offsetY = 0, scaleX = 1, scaleY = 1) {
  if (!Array.isArray(points) || points.length < 3) return false;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = offsetX + point.x * scaleX;
    const y = offsetY + point.y * scaleY;
    if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath();
  return true;
}
function mix(a, b, amount) { return a + (b - a) * amount; }
function smoothstep(amount) { const t = clamp(amount, 0, 1); return t * t * (3 - 2 * t); }
export function snapshotRenderTime(snapshot, fallback = Date.now()) {
  return Number.isFinite(snapshot?.t) ? snapshot.t : fallback;
}
function seededUnit(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function terrainVariationForCell(variations, column, row) {
  if (!variations?.length) return null;
  const seed = column * 719.17 + row * 313.61 + 41;
  const variation = variations[Math.floor(seededUnit(seed + 5) * variations.length) % variations.length];
  if (seededUnit(seed) >= (Number(variation.chance) || 0)) return null;
  return {
    ...variation,
    flipX: seededUnit(seed + 11) >= .5,
    flipY: seededUnit(seed + 17) >= .5,
  };
}

function drawTerrainVariationCell(ctx, variation, x, y, width, height) {
  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.scale(variation.flipX ? -1 : 1, variation.flipY ? -1 : 1);
  ctx.globalAlpha *= clamp(Number(variation.opacity) || 1, 0, 1);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(variation.image, 0, 0, width, height, -width / 2, -height / 2, width, height);
  ctx.restore();
}

const POWERUP_DISPLAY_NAMES = Object.freeze({
  spy: "SPY VISION",
  speed: "TURBO BOOST",
  health: "HEALTH",
  shield: "SHIELD",
  teleport: "TELEPORT",
  mole: "MOLE MODE",
  fart: "FART CLOUD",
});

function radialParticles(seed, count, colors, speedMin, speedMax) {
  return Array.from({ length: count }, (_, index) => {
    const unit = seededUnit(seed * 31 + index * 7.17);
    const angle = Math.PI * 2 * (index / count + seededUnit(seed + index) * .08);
    const speed = mix(speedMin, speedMax, unit);
    return {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - speed * .22,
      size: mix(2.5, 7, seededUnit(seed * 3 + index * 11)),
      color: colors[index % colors.length],
      spin: mix(-5, 5, seededUnit(seed * 5 + index * 13)),
    };
  });
}

function buildFartCloudSprites() {
  return Array.from({ length: 4 }, (_, variant) => {
    const surface = document.createElement("canvas");
    surface.width = 256;
    surface.height = 256;
    const ctx = surface.getContext("2d");
    if (!ctx) return null;
    const center = 128;
    const base = ctx.createRadialGradient(center, center, 8, center, center, 124);
    base.addColorStop(0, "rgba(189,219,50,.94)");
    base.addColorStop(.36, "rgba(126,160,38,.9)");
    base.addColorStop(.7, "rgba(75,104,36,.72)");
    base.addColorStop(1, "rgba(45,68,34,0)");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    for (let index = 0; index < 10; index++) {
      const seed = variant * 101 + index * 5.31;
      const angle = index * Math.PI * .2 + seededUnit(seed) * .7;
      const orbit = mix(18, 62, seededUnit(seed + 3));
      const radius = mix(31, 53, seededUnit(seed + 7));
      const x = center + Math.cos(angle) * orbit;
      const y = center + Math.sin(angle) * orbit * .58;
      const puff = ctx.createRadialGradient(x, y, 0, x, y, radius);
      puff.addColorStop(0, index % 3 === 0 ? "rgba(215,236,61,.7)" : "rgba(111,145,39,.72)");
      puff.addColorStop(.56, index % 2 ? "rgba(77,107,36,.62)" : "rgba(126,151,40,.58)");
      puff.addColorStop(1, "rgba(42,61,31,0)");
      ctx.fillStyle = puff;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    return surface;
  }).filter(Boolean);
}

function buildEnergyGlowSprite() {
  const surface = document.createElement("canvas");
  surface.width = 256;
  surface.height = 256;
  const ctx = surface.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(.12, "rgba(105,245,255,.92)");
  gradient.addColorStop(.48, "rgba(111,58,255,.62)");
  gradient.addColorStop(.76, "rgba(232,49,255,.28)");
  gradient.addColorStop(1, "rgba(70,28,170,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  return surface;
}

export class DustyOrbitMultiplayerRenderer {
  constructor(canvas, assets, debug = false, debugFocus = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.assets = assets;
    this.pickupLabelWidths = new Map();
    this.debug = debug;
    this.debugFocus = debugFocus;
    this.camera = { x: 0, y: 0 };
    this.viewport = { width: 1, height: 1, dpr: 1 };
    this.playerScreen = { x: 0, y: 0 };
    this.effects = [];
    this.localProjectiles = new Map();
    this.pendingLocalShotConfirmations = [];
    this.localInputPoses = new Map();
    this.predictedShotGroups = new Map();
    this.preparedLocalInputs = new Map();
    this.nextPredictedProjectileId = -1;
    this.nextFireIntentId = 0;
    this.localFirePrediction = null;
    this.lastLocalLaunch = null;
    this.hitUntil = new Map();
    this.spawnAnimations = new Map();
    this.moleTransitions = new Map();
    this.weaponRecoil = new Map();
    this.weaponTierByPlayer = new Map();
    this.weaponTierPulseUntil = new Map();
    this.weaponPoses = new Map();
    this.weaponHiddenByMole = new Set();
    this.weaponHiddenUntil = new Map();
    this.renderedPlayers = new Map();
    this.environmentLayers = assets.environment
      .filter((item) => item.renderLayer !== "terrain")
      .map((item) => ({ type: "environment", depth: item.depthY, value: item }));
    this.localPlayerId = null;
    this.minimapSurfaces = new Map();
    this.nukeWarnings = new Map();
    this.detonatedNukeIds = new Map();
    this.reducedMotionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") || null;
    this.reducedMotion = this.reducedMotionQuery?.matches === true;
    this.reducedMotionQuery?.addEventListener?.("change", (event) => { this.reducedMotion = event.matches; });
    this.collisionEditor = null;
    this.uplink = { active: false, phase: null, changedAt: 0 };
    this.renderQuality = 1;
    this.effectsQuality = 1;
    this.frameTimeEma = 1000 / 60;
    this.lastQualityChange = 0;
    this.lastEffectsQualityChange = 0;
    this.effectPasses = { underlay: [], foreground: [] };
    this.staticWorldChunks = new Map();
    this.staticChunkUse = 0;
    this.fartCloudSprites = buildFartCloudSprites();
    this.energyGlowSprite = buildEnergyGlowSprite();
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    const dpr = renderScaleForViewport(width, height, devicePixelRatio || 1, this.renderQuality);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.viewport = { width, height, dpr };
  }

  updateAdaptiveQuality(delta, now = performance.now()) {
    if (!Number.isFinite(delta) || delta <= 0 || delta > .1 || globalThis.document?.hidden) return;
    const frameMs = delta * 1000;
    this.frameTimeEma += (frameMs - this.frameTimeEma) * .04;
    const elapsed = now - this.lastQualityChange;
    const effectsElapsed = now - this.lastEffectsQualityChange;
    const nextEffects = nextEffectsQuality(this.effectsQuality, this.frameTimeEma, effectsElapsed);
    if (nextEffects !== this.effectsQuality) {
      this.effectsQuality = nextEffects;
      this.lastEffectsQualityChange = now;
    }
    let nextQuality = this.renderQuality;
    if (this.frameTimeEma > 20 && elapsed > 1400) nextQuality = Math.max(.7, this.renderQuality - .1);
    else if (this.frameTimeEma < 15.5 && elapsed > 5000) nextQuality = Math.min(1, this.renderQuality + .05);
    if (nextQuality === this.renderQuality) return;
    this.renderQuality = nextQuality;
    this.lastQualityChange = now;
    this.resize();
  }

  dynamicShadowBlur(value) {
    if (this.effectsQuality <= .4) return 0;
    return this.effectsQuality < 1 ? value * .5 : value;
  }

  dynamicComposite(operation = "screen") {
    return this.effectsQuality <= .4 ? "source-over" : operation;
  }

  effectParticleStep() {
    return this.effectsQuality <= .4 ? 3 : this.effectsQuality < 1 ? 2 : 1;
  }

  isWorldCircleVisible(x, y, radius = 0, margin = 24) {
    const screenX = x - this.camera.x;
    const screenY = y - this.camera.y;
    const extent = Math.max(0, radius) + margin;
    return screenX + extent >= 0 && screenX - extent <= this.viewport.width
      && screenY + extent >= 0 && screenY - extent <= this.viewport.height;
  }

  isWorldSegmentVisible(startX, startY, endX, endY, margin = 24) {
    const left = this.camera.x - margin;
    const top = this.camera.y - margin;
    const right = this.camera.x + this.viewport.width + margin;
    const bottom = this.camera.y + this.viewport.height + margin;
    return Math.max(startX, endX) >= left && Math.min(startX, endX) <= right
      && Math.max(startY, endY) >= top && Math.min(startY, endY) <= bottom;
  }

  isEffectVisible(effect) {
    if (effect.type === "blocked") return true;
    if (!Number.isFinite(effect.x) || !Number.isFinite(effect.y)) return false;
    const radius = effect.type === "nuke-blast" ? effect.radius
      : effect.type === "death" || effect.type === "respawn" ? 150
        : effect.type === "dirt" ? 110 : effect.type === "weapon-muzzle" || effect.type === "muzzle" ? 70 : 60;
    return this.isWorldCircleVisible(effect.x, effect.y, radius);
  }

  prepareEffectFrame(now) {
    const active = [];
    const underlay = [];
    const foreground = [];
    for (const effect of this.effects) {
      if (now - effect.born >= effect.life) continue;
      active.push(effect);
      if (effect.type === "nuke-blast") underlay.push(effect);
      if (effect.type !== "weapon-muzzle" && effect.type !== "muzzle") foreground.push(effect);
    }
    this.effects = active;
    this.effectPasses = { underlay, foreground };
  }

  buildStaticWorldChunk(column, row) {
    const worldX = column * STATIC_CHUNK_SIZE;
    const worldY = row * STATIC_CHUNK_SIZE;
    const width = Math.min(STATIC_CHUNK_SIZE, this.assets.world.width - worldX);
    const height = Math.min(STATIC_CHUNK_SIZE, this.assets.world.height - worldY);
    if (width <= 0 || height <= 0) return null;
    const surface = document.createElement("canvas");
    surface.width = Math.ceil(width * STATIC_CHUNK_SCALE);
    surface.height = Math.ceil(height * STATIC_CHUNK_SCALE);
    const surfaceContext = surface.getContext("2d", { alpha: false });
    if (!surfaceContext) return null;

    const originalContext = this.ctx;
    const originalCamera = this.camera;
    const originalViewport = this.viewport;
    try {
      this.ctx = surfaceContext;
      this.camera = { x: worldX, y: worldY };
      this.viewport = { width, height, dpr: 1 };
      surfaceContext.setTransform(STATIC_CHUNK_SCALE, 0, 0, STATIC_CHUNK_SCALE, 0, 0);
      this.drawTerrain();
      this.drawBoundaryOverlay();
      this.drawTerrainFeatures();
      return { surface, worldX, worldY, width, height, used: ++this.staticChunkUse };
    } catch {
      return null;
    } finally {
      this.ctx = originalContext;
      this.camera = originalCamera;
      this.viewport = originalViewport;
    }
  }

  getStaticWorldChunk(column, row) {
    const key = `${column},${row}`;
    let chunk = this.staticWorldChunks.get(key);
    if (!chunk) {
      chunk = this.buildStaticWorldChunk(column, row);
      if (!chunk) return null;
      this.staticWorldChunks.set(key, chunk);
      if (this.staticWorldChunks.size > MAX_STATIC_CHUNKS) {
        let oldestKey = null;
        let oldestUse = Infinity;
        for (const [candidateKey, candidate] of this.staticWorldChunks) {
          if (candidateKey !== key && candidate.used < oldestUse) {
            oldestKey = candidateKey;
            oldestUse = candidate.used;
          }
        }
        if (oldestKey) this.staticWorldChunks.delete(oldestKey);
      }
    }
    chunk.used = ++this.staticChunkUse;
    return chunk;
  }

  invalidateStaticScene() {
    this.staticWorldChunks.clear();
    this.environmentLayers = this.assets.environment
      .filter((item) => item.renderLayer !== "terrain")
      .map((item) => ({ type: "environment", depth: item.depthY, value: item }));
  }

  prewarmStaticWorldAt(focus) {
    if (!Number.isFinite(focus?.x) || !Number.isFinite(focus?.y)) return;
    const cameraX = clamp(focus.x - this.viewport.width / 2, 0, Math.max(0, this.assets.world.width - this.viewport.width));
    const cameraY = clamp(focus.y - this.viewport.height / 2, 0, Math.max(0, this.assets.world.height - this.viewport.height));
    const firstColumn = Math.max(0, Math.floor(cameraX / STATIC_CHUNK_SIZE));
    const lastColumn = Math.min(Math.ceil(this.assets.world.width / STATIC_CHUNK_SIZE) - 1, Math.floor((cameraX + this.viewport.width) / STATIC_CHUNK_SIZE));
    const firstRow = Math.max(0, Math.floor(cameraY / STATIC_CHUNK_SIZE));
    const lastRow = Math.min(Math.ceil(this.assets.world.height / STATIC_CHUNK_SIZE) - 1, Math.floor((cameraY + this.viewport.height) / STATIC_CHUNK_SIZE));
    for (let row = firstRow; row <= lastRow; row += 1) for (let column = firstColumn; column <= lastColumn; column += 1) {
      this.getStaticWorldChunk(column, row);
    }
  }

  drawStaticWorld() {
    const firstColumn = Math.max(0, Math.floor(this.camera.x / STATIC_CHUNK_SIZE));
    const lastColumn = Math.min(Math.ceil(this.assets.world.width / STATIC_CHUNK_SIZE) - 1, Math.floor((this.camera.x + this.viewport.width) / STATIC_CHUNK_SIZE));
    const firstRow = Math.max(0, Math.floor(this.camera.y / STATIC_CHUNK_SIZE));
    const lastRow = Math.min(Math.ceil(this.assets.world.height / STATIC_CHUNK_SIZE) - 1, Math.floor((this.camera.y + this.viewport.height) / STATIC_CHUNK_SIZE));
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const chunk = this.getStaticWorldChunk(column, row);
        if (!chunk) continue;
        this.ctx.drawImage(chunk.surface, 0, 0, chunk.surface.width, chunk.surface.height,
          chunk.worldX - this.camera.x, chunk.worldY - this.camera.y, chunk.width, chunk.height);
      }
    }
  }

  impact(event) {
    if (Number.isSafeInteger(event.projectileId)) {
      this.localProjectiles.delete(event.projectileId);
      // A close-range or fast projectile can be spawned and resolved by the
      // server between two animation frames. In that ordering the shot event
      // is queued for the next visible muzzle pose, then the impact arrives
      // before the queue is flushed. Remove both forms of the projectile so a
      // confirmed impact can never be resurrected as a client-only ghost.
      this.pendingLocalShotConfirmations = this.pendingLocalShotConfirmations.filter(
        (confirmation) => confirmation?.projectile?.id !== event.projectileId,
      );
    }
    this.effects.push({ x: event.x, y: event.y, born: performance.now(), life: 280 });
  }

  clearLocalShotHistory(lastFireIntentId = 0) {
    this.localProjectiles.clear();
    this.pendingLocalShotConfirmations.length = 0;
    this.localInputPoses.clear();
    this.predictedShotGroups.clear();
    this.preparedLocalInputs.clear();
    this.nextPredictedProjectileId = -1;
    this.nextFireIntentId = Number.isSafeInteger(lastFireIntentId) ? Math.max(0, lastFireIntentId) : 0;
    this.localFirePrediction = null;
    this.lastLocalLaunch = null;
  }

  captureLocalInputPose(input, now = performance.now()) {
    if (!Number.isSafeInteger(input?.seq)) return null;
    const pose = this.weaponPoses.get(this.localPlayerId);
    if (!pose?.muzzleWorld || !pose?.forward) return null;
    const captured = {
      ...pose,
      muzzleWorld: { ...pose.muzzleWorld },
      pivotWorld: pose.pivotWorld ? { ...pose.pivotWorld } : undefined,
      forward: { ...pose.forward },
      perpendicular: pose.perpendicular ? { ...pose.perpendicular } : undefined,
      inputSeq: input.seq,
      capturedAt: now,
    };
    this.localInputPoses.set(input.seq, captured);
    while (this.localInputPoses.size > 180) this.localInputPoses.delete(this.localInputPoses.keys().next().value);
    return captured;
  }

  resetLocalFirePrediction(lastFireIntentId = this.nextFireIntentId, dropUnconfirmed = true) {
    if (dropUnconfirmed) {
      for (const group of this.predictedShotGroups.values()) for (const predicted of group.projectiles) {
        if (!predicted.confirmed) this.localProjectiles.delete(predicted.tempId);
      }
      this.predictedShotGroups.clear();
    }
    this.preparedLocalInputs?.clear();
    this.nextFireIntentId = Math.max(this.nextFireIntentId, Number.isSafeInteger(lastFireIntentId) ? lastFireIntentId : 0);
    this.localFirePrediction = null;
  }

  localWeaponPredictionKey(weapon, weaponState) {
    const spreads = Array.isArray(weapon?.spreadDegrees) ? weapon.spreadDegrees.join(",") : "0";
    return [weaponState?.loadoutId ?? "legacy", weaponState?.fireStateId ?? "legacy-fire", weapon?.tier, weapon?.visualTier, weapon?.name,
      weapon?.cooldownMs, weapon?.speed, weapon?.lifetimeMs, weapon?.count, weapon?.burstSpacingMs, spreads].join(":");
  }

  configureLocalFirePrediction(weapon, weaponState, serverNow) {
    const key = this.localWeaponPredictionKey(weapon, weaponState);
    const acknowledgedIntent = Number.isSafeInteger(weaponState?.lastFireIntentId) ? weaponState.lastFireIntentId : 0;
    this.nextFireIntentId = Math.max(this.nextFireIntentId, acknowledgedIntent);
    if (this.localFirePrediction?.key === key) {
      // Server ticks can accept a locally predicted trigger a fraction later
      // than the render frame that displayed it. Move the mirrored gates only
      // forward when snapshots reveal that delay; never rewind and duplicate
      // an intent that the client has already emitted.
      if (Number.isFinite(weaponState?.nextTriggerAt)) {
        this.localFirePrediction.nextTriggerAt = Math.max(this.localFirePrediction.nextTriggerAt, weaponState.nextTriggerAt);
      }
      if (this.localFirePrediction.burstRemaining > 0 && Number.isFinite(weaponState?.nextBurstAt)) {
        this.localFirePrediction.nextBurstAt = Math.max(this.localFirePrediction.nextBurstAt, weaponState.nextBurstAt);
      }
      return this.localFirePrediction;
    }
    this.resetLocalFirePrediction(acknowledgedIntent, true);
    this.localFirePrediction = {
      key,
      loadoutId: Number.isSafeInteger(weaponState?.loadoutId) ? weaponState.loadoutId : 1,
      fireStateId: Number.isSafeInteger(weaponState?.fireStateId) ? weaponState.fireStateId : 1,
      nextTriggerAt: Number.isFinite(weaponState?.nextTriggerAt) ? Math.max(serverNow, weaponState.nextTriggerAt) : serverNow,
      burstRemaining: Math.max(0, Math.round(Number(weaponState?.burstRemaining) || 0)),
      nextBurstAt: Number.isFinite(weaponState?.nextBurstAt) ? weaponState.nextBurstAt : serverNow,
    };
    return this.localFirePrediction;
  }

  pruneLocalShotPredictions(now = performance.now()) {
    for (const [intentId, group] of this.predictedShotGroups) {
      const allConfirmed = group.projectiles.every((projectile) => projectile.confirmed);
      if ((allConfirmed && now - group.createdAt > 750) || now - group.createdAt > 1800) {
        for (const predicted of group.projectiles) if (!predicted.confirmed) this.localProjectiles.delete(predicted.tempId);
        this.predictedShotGroups.delete(intentId);
      }
    }
  }

  prepareLocalInput(input, player, weapon, options = {}) {
    const localNow = Number.isFinite(options.localNow) ? options.localNow : performance.now();
    const serverNow = Number.isFinite(options.serverNow) ? options.serverNow : Date.now();
    const pose = this.captureLocalInputPose(input, localNow);
    this.pruneLocalShotPredictions(localNow);
    if (!player?.alive || !weapon || !Number.isFinite(weapon.cooldownMs) || !Number.isFinite(weapon.speed)) return [];
    const state = this.configureLocalFirePrediction(weapon, options.weaponState, serverNow);
    const intents = [];
    const predictions = [];
    const before = {
      nextFireIntentId: this.nextFireIntentId,
      nextTriggerAt: state.nextTriggerAt,
      burstRemaining: state.burstRemaining,
      nextBurstAt: state.nextBurstAt,
    };
    const finish = () => {
      if (intents.length) this.preparedLocalInputs.set(input.seq, {
        key: state.key,
        before,
        afterFireIntentId: this.nextFireIntentId,
        predictions,
      });
      return intents;
    };
    const count = clamp(Math.round(Number(weapon.count) || 1), 1, 24);
    const burstSpacingMs = Math.max(0, Number(weapon.burstSpacingMs) || 0);
    const cooldownMs = Math.max(50, Number(weapon.cooldownMs) || 50);
    const spreadDegrees = Array.isArray(weapon.spreadDegrees) && weapon.spreadDegrees.length ? weapon.spreadDegrees : [0];
    const speedMultiplier = Number.isFinite(options.speedMultiplier) ? Math.max(.1, options.speedMultiplier) : 1;
    const createIntent = (spreads) => {
      if (intents.length >= 4) return false;
      const rawLength = Math.hypot(input.aimX || 0, input.aimY || 0);
      const aim = rawLength > .001 ? { x: input.aimX / rawLength, y: input.aimY / rawLength } : pose?.forward;
      if (!aim) return false;
      const intent = {
        id: ++this.nextFireIntentId, loadoutId: state.loadoutId, fireStateId: state.fireStateId,
        aimX: aim.x, aimY: aim.y,
      };
      intents.push(intent);
      if (pose) predictions.push({ intent, inputSeq: input.seq, pose, weapon, spreads, speedMultiplier, localNow });
      return true;
    };

    if (state.burstRemaining > 0 && state.nextBurstAt < serverNow - 250) state.nextBurstAt = serverNow;
    while (state.burstRemaining > 0 && serverNow >= state.nextBurstAt && intents.length < 4) {
      if (!createIntent([0])) break;
      state.burstRemaining--;
      state.nextBurstAt += burstSpacingMs;
    }
    if (state.burstRemaining > 0 || !input.fire || intents.length >= 4) return finish();
    if (state.nextTriggerAt < serverNow - 250) state.nextTriggerAt = serverNow;
    if (serverNow < state.nextTriggerAt) return finish();

    state.nextTriggerAt = serverNow + cooldownMs;
    if (burstSpacingMs > 0 && count > 1) {
      state.burstRemaining = count;
      state.nextBurstAt = serverNow;
      while (state.burstRemaining > 0 && serverNow >= state.nextBurstAt && intents.length < 4) {
        if (!createIntent([0])) break;
        state.burstRemaining--;
        state.nextBurstAt += burstSpacingMs;
      }
    } else createIntent(spreadDegrees);
    return finish();
  }

  commitLocalInput(inputSeq) {
    const prepared = this.preparedLocalInputs?.get(inputSeq);
    if (!prepared) return 0;
    this.preparedLocalInputs.delete(inputSeq);
    for (const prediction of prepared.predictions) this.predictLocalShot(prediction);
    return prepared.predictions.length;
  }

  rollbackLocalInput(inputSeq) {
    const prepared = this.preparedLocalInputs?.get(inputSeq);
    if (!prepared) return;
    this.preparedLocalInputs.delete(inputSeq);
    const state = this.localFirePrediction;
    if (state?.key === prepared.key && this.nextFireIntentId === prepared.afterFireIntentId) {
      state.nextTriggerAt = prepared.before.nextTriggerAt;
      state.burstRemaining = prepared.before.burstRemaining;
      state.nextBurstAt = prepared.before.nextBurstAt;
      this.nextFireIntentId = prepared.before.nextFireIntentId;
    }
    this.localInputPoses?.delete(inputSeq);
  }

  rejectLocalFireIntent(intentId) {
    if (!Number.isSafeInteger(intentId)) return;
    const group = this.predictedShotGroups?.get(intentId);
    if (!group) return;
    for (const predicted of group.projectiles) if (!predicted.confirmed) this.localProjectiles.delete(predicted.tempId);
    this.predictedShotGroups.delete(intentId);
  }

  predictLocalShot({ intent, inputSeq, pose, weapon, spreads, speedMultiplier, localNow }) {
    const visualTier = Number.isFinite(weapon.visualTier) ? weapon.visualTier : Number.isFinite(weapon.tier) ? weapon.tier : 1;
    const speed = Math.max(1, Number(weapon.speed) || 1) * speedMultiplier;
    const life = clamp((Math.max(100, Number(weapon.lifetimeMs) || 100) / speedMultiplier), 100, 3000);
    const radius = Math.max(.5, Number(weapon.radius) || 3);
    const group = {
      intentId: intent.id,
      inputSeq,
      createdAt: localNow,
      pose: { ...pose, muzzleWorld: { ...pose.muzzleWorld }, forward: { ...pose.forward } },
      projectiles: [],
    };
    for (let pelletIndex = 0; pelletIndex < spreads.length; pelletIndex++) {
      const radians = (Number(spreads[pelletIndex]) || 0) * Math.PI / 180;
      const cosine = Math.cos(radians), sine = Math.sin(radians);
      const direction = {
        x: intent.aimX * cosine - intent.aimY * sine,
        y: intent.aimX * sine + intent.aimY * cosine,
      };
      const tempId = this.nextPredictedProjectileId--;
      this.localProjectiles.set(tempId, {
        id: tempId, ownerId: this.localPlayerId, tier: visualTier,
        vx: direction.x * speed, vy: direction.y * speed, radius,
        startX: pose.muzzleWorld.x, startY: pose.muzzleWorld.y,
        previousX: pose.muzzleWorld.x, previousY: pose.muzzleWorld.y,
        born: localNow, life, firstFrame: true,
        fireIntentId: intent.id, inputSeq, pelletIndex, pelletCount: spreads.length,
        predicted: true,
      });
      group.projectiles.push({ tempId, pelletIndex, direction, confirmed: false });
    }
    this.predictedShotGroups.set(intent.id, group);
    const visual = weaponVisualForTier(visualTier);
    this.weaponRecoil.set(this.localPlayerId, { born: localNow, life: visual.recoilMs, distance: visual.recoilDistance });
    this.effects.push({
      type: "weapon-muzzle", tier: visualTier, x: pose.muzzleWorld.x, y: pose.muzzleWorld.y,
      angle: Math.atan2(intent.aimY, intent.aimX), size: visual.flashSize, born: localNow,
      life: visualTier === 6 ? 175 : visualTier === 1 ? 85 : 115,
    });
    this.emitWeaponAudioCue({ playerId: this.localPlayerId, fireIntentId: intent.id, weaponRarity: weapon.rarity, projectile: { tier: visualTier } }, pose.muzzleWorld);
    const first = group.projectiles[0];
    if (first) this.lastLocalLaunch = {
      projectileId: first.tempId,
      fireIntentId: intent.id,
      muzzleWorld: { ...pose.muzzleWorld },
      direction: { x: intent.aimX, y: intent.aimY },
      firstRenderError: null,
      predicted: true,
    };
  }

  reconcilePredictedShot(event) {
    const projectile = event?.projectile;
    const intentId = Number.isSafeInteger(event?.fireIntentId) ? event.fireIntentId : projectile?.fireIntentId;
    if (!Number.isSafeInteger(intentId)) return false;
    const group = this.predictedShotGroups?.get(intentId);
    if (!group) return false;
    const pelletIndex = Number.isSafeInteger(event?.pelletIndex) ? event.pelletIndex
      : Number.isSafeInteger(projectile?.pelletIndex) ? projectile.pelletIndex : 0;
    const predicted = group.projectiles.find((item) => item.pelletIndex === pelletIndex);
    if (!predicted) return false;
    if (predicted.confirmed) return true;
    predicted.confirmed = true;
    const visualProjectile = this.localProjectiles.get(predicted.tempId);
    if (!visualProjectile) return true;
    this.localProjectiles.delete(predicted.tempId);
    const life = clamp((projectile.expiresAt || 0) - (projectile.spawnedAt || 0), 100, 3000);
    const reconciled = {
      ...visualProjectile,
      ...projectile,
      startX: visualProjectile.startX,
      startY: visualProjectile.startY,
      previousX: visualProjectile.previousX,
      previousY: visualProjectile.previousY,
      born: visualProjectile.born,
      firstFrame: visualProjectile.firstFrame,
      life,
      predicted: false,
    };
    this.localProjectiles.set(projectile.id, reconciled);
    if (this.lastLocalLaunch?.projectileId === predicted.tempId) this.lastLocalLaunch.projectileId = projectile.id;
    return true;
  }

  confirmShot(event, local = false) {
    const projectile = event?.projectile;
    if (!projectile || !Number.isSafeInteger(projectile.id) ||
        !Number.isFinite(projectile.vx) || !Number.isFinite(projectile.vy)) return;
    const speed = Math.hypot(projectile.vx, projectile.vy);
    if (speed < .001) return;
    if (local) {
      // Intent-based shots already left the exact visible muzzle before the
      // network round trip. Confirmation adopts that projectile in place.
      if (this.reconcilePredictedShot(event)) return;
      // Legacy/unmatched events may be delayed, but must still use the pose
      // captured for their own input sequence. Never splice an old direction
      // onto whichever way the gun happens to point on receipt.
      const historicalPose = this.localInputPoses?.get(projectile.inputSeq);
      this.materializeShot(event, true, historicalPose || null);
      return;
    }
    this.materializeShot(event, false, null);
  }

  shotGroupKey(event) {
    if (Number.isSafeInteger(event?.fireIntentId)) return `intent:${event.fireIntentId}`;
    if (Number.isSafeInteger(event?.shotId)) return `shot:${event.shotId}`;
    const projectile = event?.projectile || {};
    return `legacy:${event?.playerId}:${projectile.inputSeq}:${projectile.spawnedAt}`;
  }

  pendingLocalLaunchGroup() {
    if (!this.pendingLocalShotConfirmations.length) return [];
    const groupKey = this.shotGroupKey(this.pendingLocalShotConfirmations[0]);
    let count = 1;
    while (count < this.pendingLocalShotConfirmations.length &&
           this.shotGroupKey(this.pendingLocalShotConfirmations[count]) === groupKey) count++;
    return this.pendingLocalShotConfirmations.slice(0, count);
  }

  materializeShot(event, local, shotPose) {
    const projectile = event.projectile;
    const speed = Math.hypot(projectile.vx, projectile.vy);
    const authoritativeDirection = { x: projectile.vx / speed, y: projectile.vy / speed };
    // A confirmation can arrive after the player has already turned toward a
    // new target. Never rotate the historical projectile onto the gun's newer
    // pose: its immutable server velocity is the collision path that can
    // produce an impact, and the rendered shot must tell the same story.
    const directionX = authoritativeDirection.x;
    const directionY = authoritativeDirection.y;
    const life = clamp((projectile.expiresAt || 0) - (projectile.spawnedAt || 0), 100, 3000);
    // Never fast-forward a newly confirmed local projectile. Backdating by
    // network transit time made its first visible frame appear downrange
    // instead of at the barrel. Its visual lifetime starts at the muzzle now.
    const born = performance.now();
    const visual = weaponVisualForTier(projectile.tier);
    if (shotPose) {
      this.weaponRecoil.set(event.playerId, { born, life: visual.recoilMs, distance: visual.recoilDistance });
    }
    const visualOrigin = shotPose?.muzzleWorld ?? projectile;
    this.effects.push({
      type: "weapon-muzzle", tier: projectile.tier, x: visualOrigin.x, y: visualOrigin.y,
      angle: Math.atan2(directionY, directionX), size: visual.flashSize, born,
      life: projectile.tier === 6 ? 175 : projectile.tier === 1 ? 85 : 115,
    });
    this.emitWeaponAudioCue(event, visualOrigin);
    if (!local) return;
    this.localProjectiles.set(projectile.id, {
      ...projectile,
      vx: directionX * speed,
      vy: directionY * speed,
      startX: visualOrigin.x,
      startY: visualOrigin.y,
      previousX: visualOrigin.x,
      previousY: visualOrigin.y,
      born,
      life,
      firstFrame: true,
    });
    this.lastLocalLaunch = {
      projectileId: projectile.id,
      muzzleWorld: { x: visualOrigin.x, y: visualOrigin.y },
      direction: { x: directionX, y: directionY },
      firstRenderError: null,
    };
  }

  emitWeaponAudioCue(event, muzzle) {
    if (typeof globalThis.CustomEvent !== "function") return;
    this.canvas?.dispatchEvent?.(new CustomEvent("dusty-orbit:weapon-fired", {
      detail: {
        playerId: event.playerId,
        groupKey: this.shotGroupKey(event),
        shotId: event.shotId,
        tier: event.projectile?.tier,
        rarity: event.weaponRarity,
        x: muzzle.x,
        y: muzzle.y,
      },
    }));
  }

  flushLocalShotConfirmations() {
    if (!this.pendingLocalShotConfirmations.length) return;
    const confirmations = this.pendingLocalShotConfirmations.splice(0);
    for (const event of confirmations) {
      const historicalPose = this.localInputPoses?.get(event?.projectile?.inputSeq);
      this.materializeShot(event, true, historicalPose || null);
    }
  }

  playerHit(id) { this.hitUntil.set(id, performance.now() + 180); }
  shieldHit(event) { this.effects.push({ type: "shield", x: event.x, y: event.y, born: performance.now(), life: 380 }); }
  teleport(event) { this.effects.push({ type: "teleport", x: event.x, y: event.y, born: performance.now(), life: 480 }); }
  moleBurrowed(event) {
    const born = performance.now();
    this.weaponHiddenByMole.add(event.playerId);
    this.weaponPoses.delete(event.playerId);
    this.moleTransitions.set(event.playerId, { kind: "burrow", born, life: 760 });
    const rendered = this.renderedPlayers.get(event.playerId);
    const movementLength = Math.hypot(event.vx || 0, event.vy || 0);
    const lead = movementLength > .001 ? { x: event.vx / movementLength * 27, y: event.vy / movementLength * 27 } : { x: 0, y: 0 };
    const origin = rendered ? { x: rendered.x + lead.x, y: rendered.y + lead.y } : { x: event.x, y: event.y };
    this.effects.push({ type: "dirt", direction: "burrow", x: origin.x, y: origin.y, born, life: 820, particles: radialParticles(origin.x + origin.y, 18, ["#ddb46f", "#9c694d", "#6c3f43", "#f2d394"], 45, 135) });
  }
  moleEmerged(event) {
    const born = performance.now();
    this.weaponHiddenByMole.delete(event.playerId);
    this.moleTransitions.set(event.playerId, { kind: "emerge", born, life: 760 });
    this.effects.push({ type: "dirt", direction: "emerge", x: event.x, y: event.y, born, life: 900, particles: radialParticles(event.x * 2 + event.y, 22, ["#f0cd83", "#bd815a", "#774b45", "#ffe2a1"], 65, 175) });
  }
  death(event) {
    const born = performance.now();
    this.weaponHiddenByMole.delete(event.victimId);
    this.weaponHiddenUntil.delete(event.victimId);
    this.weaponPoses.delete(event.victimId);
    const scale = event.cause === "nuke" ? 1.3 : 1;
    this.effects.push({ type: "death", x: event.x, y: event.y, born, life: 900, scale, particles: radialParticles(event.x + event.y * 3, 26, ["#ffffff", "#79f5ff", "#d889ff", "#ff7b62", "#ffd76c"], 90 * scale, 270 * scale) });
  }
  respawn(event) {
    const born = performance.now();
    this.weaponHiddenByMole.delete(event.playerId);
    this.weaponHiddenUntil.delete(event.playerId);
    this.spawnAnimations.set(event.playerId, { born, life: 950 });
    this.effects.push({ type: "respawn", x: event.x, y: event.y, born, life: 1100, particles: radialParticles(event.x * 5 + event.y, 20, ["#ffffff", "#8af8ff", "#a9ff70", "#c18cff"], 35, 105) });
  }
  blocked() { this.effects.push({ type: "blocked", born: performance.now(), life: 700 }); }
  fartCloud(event, localOwner = false) {
    if (localOwner || !event?.ownerId) return;
    const duration = Math.max(0, Number(event.expiresAt) - Date.now());
    this.weaponHiddenUntil.set(event.ownerId, performance.now() + duration);
    this.weaponPoses.delete(event.ownerId);
    this.weaponRecoil.delete(event.ownerId);
  }
  nukeWarning(event) {
    if (!Number.isFinite(event?.x) || !Number.isFinite(event?.y) || !Number.isFinite(event?.radius)) return;
    this.nukeWarnings.set(event.id, { ...event });
    this.emitNukeAudioCue("warning-start", event);
  }

  nukeDetonated(event) {
    if (!Number.isFinite(event?.x) || !Number.isFinite(event?.y) || !Number.isFinite(event?.radius)) return;
    if (this.effects.some((effect) => effect.type === "nuke-blast" && effect.id === event.id)) return;
    const born = performance.now();
    const compact = this.viewport.width < 700 || globalThis.document?.documentElement?.classList.contains("mobile-preview");
    const particleCount = this.reducedMotion ? 16 : compact ? 20 : 32;
    const shardCount = this.reducedMotion ? 3 : compact ? 4 : 6;
    const seed = (Number(event.id) || 1) * 101 + event.x * .17 + event.y * .29;
    const burst = createNukeBurst(seed, event.radius, particleCount, shardCount);
    this.nukeWarnings.delete(event.id);
    this.detonatedNukeIds.set(event.id, born + NUKE_EFFECT_DURATION_MS + 250);
    this.effects.push({
      type: "nuke-blast", id: event.id, ownerId: event.ownerId, x: event.x, y: event.y,
      radius: event.radius, born, life: NUKE_EFFECT_DURATION_MS, seed, shockwaveCuePlayed: false, ...burst,
    });
    for (const victimId of event.victims || []) {
      const victim = this.renderedPlayers.get(victimId);
      if (victim) this.effects.push({ type: "nuke-hit", x: victim.x, y: victim.y, born, life: 240 });
    }
    this.emitNukeAudioCue("ignition", event);
    this.emitNukeAudioCue("detonation", event);
  }

  emitNukeAudioCue(cue, event) {
    if (typeof globalThis.CustomEvent !== "function") return;
    this.canvas.dispatchEvent?.(new CustomEvent("dusty-orbit:nuke-audio-cue", {
      detail: { cue, id: event.id, x: event.x, y: event.y, radius: event.radius },
    }));
  }

  updateUplink(active, alive) {
    if (!alive) {
      this.uplink = { active: false, phase: null, changedAt: performance.now() };
      return;
    }
    if (active === this.uplink.active) return;
    this.uplink = { active, phase: active ? "linked" : "lost", changedAt: performance.now() };
  }

  render(snapshot, localId, predicted, delta, inputVisual, onLocalPoseReady = null) {
    const now = performance.now();
    this.updateAdaptiveQuality(delta, now);
    const { ctx } = this;
    const { width, height, dpr } = this.viewport;
    this.localPlayerId = localId;
    this.weaponPoses.clear();
    this.collisionEditor?.update(delta);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const local = snapshot?.players?.find((player) => player.id === localId);
    this.updateUplink(Boolean(local?.satelliteConnected), Boolean(local?.alive));
    const focus = this.debug && this.debugFocus ? this.debugFocus : predicted || local || { x: this.assets.world.width / 2, y: this.assets.world.height / 2 };
    const targetX = clamp(focus.x - width / 2, 0, Math.max(0, this.assets.world.width - width));
    const targetY = clamp(focus.y - height / 2, 0, Math.max(0, this.assets.world.height - height));
    const blend = 1 - Math.exp(-delta * 10);
    this.camera.x += (targetX - this.camera.x) * blend;
    this.camera.y += (targetY - this.camera.y) * blend;
    const shake = this.getNukeScreenShake(now);
    this.playerScreen = { x: focus.x - this.camera.x + shake.x, y: focus.y - this.camera.y + shake.y };
    this.prepareEffectFrame(now);

    ctx.fillStyle = "#371447";
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(shake.x, shake.y);
    this.drawStaticWorld();
    this.drawNukes(snapshot?.nukes || [], Date.now());
    this.drawEffects("underlay", now);

    const players = (snapshot?.players || []).map((player) => {
      if (player.id !== localId) return player;
      const aimX = inputVisual?.aimX ?? player.aimX;
      const aimY = inputVisual?.aimY ?? player.aimY;
      return predicted
        ? { ...player, x: predicted.x, y: predicted.y, aimX, aimY }
        : { ...player, aimX, aimY };
    });
    this.renderedPlayers.clear();
    for (const player of players) this.renderedPlayers.set(player.id, { x: player.x, y: player.y, vx: player.vx || 0, vy: player.vy || 0 });
    const visiblePlayers = players.filter((player) => player.id === localId || this.isWorldCircleVisible(player.x, player.y, 105));
    const visiblePickups = (snapshot?.pickups || []).filter((pickup) => this.isWorldCircleVisible(pickup.x, pickup.y, 75));
    const visibleEnvironment = this.environmentLayers.filter((layer) => this.isWorldCircleVisible(
      layer.value.x,
      layer.value.y,
      Math.hypot(layer.value.width, layer.value.height) / 2,
    ));
    const activeSatelliteIds = new Set(snapshot?.activeSatelliteIds || []);
    const activeHealingStationIds = new Set(snapshot?.activeHealingStationIds || []);
    const weaponStations = new Map((snapshot?.weaponStations || []).map((station) => [station.id, station]));
    const layers = [
      ...visibleEnvironment,
      ...visiblePickups.map((pickup) => ({ type: "pickup", depth: pickup.y, value: pickup })),
      ...visiblePlayers.map((player) => ({ type: "player", depth: player.y, value: player })),
    ].sort((a, b) => a.depth - b.depth);
    for (const layer of layers) {
      if (layer.type === "environment") {
        const weaponStation = weaponStations.get(layer.value.id)
          || (layer.value.kind === "weapon-station" ? { id: layer.value.id, state: "READY", userId: null, generationRemaining: 0, cooldownRemaining: 0 } : null);
        this.drawEnvironmentObject(layer.value, {
        active: activeSatelliteIds.has(layer.value.id),
        connected: local?.connectedSatelliteId === layer.value.id,
      }, {
        active: activeHealingStationIds.has(layer.value.id),
        connected: local?.connectedHealingStationId === layer.value.id,
        inProgress: local?.connectedHealingStationId === layer.value.id && local?.healingInProgress === true,
        remaining: Number(local?.healingRemaining) || 0,
      }, weaponStation ? {
        ...weaponStation,
        connected: local?.connectedWeaponStationId === layer.value.id,
        localPlayerId: local?.id,
      } : null);
      }
      else if (layer.type === "pickup") this.drawPickup(layer.value);
      else this.drawPlayer(layer.value, layer.value.id === localId);
    }
    // Labels are a world-space readability layer so nearby players and rocks
    // cannot cover the name while deciding whether to collect a power-up.
    for (const pickup of visiblePickups) this.drawPickupLabel(pickup);
    // Prediction and transmission run at this exact point: drawPlayer() has
    // produced the visible muzzle, while muzzle light and projectiles have not
    // been painted yet. A locally predicted round therefore appears at that
    // nozzle in the same animation frame as its immutable fire intent.
    if (typeof onLocalPoseReady === "function") onLocalPoseReady(this.weaponPoses.get(localId) || null);
    // drawPlayer() above has just produced the exact visible gun pose for this
    // frame. Only now may a local projectile acquire its start coordinate.
    this.flushLocalShotConfirmations();
    // Muzzle light belongs behind the projectile. Drawing it afterward hid the
    // bullet's exact-at-nozzle first frame and made the next frame look like a
    // detached launch.
    this.drawEffects("muzzle");
    this.drawProjectiles(snapshot?.projectiles || []);
    this.drawLocalProjectiles();
    // Smoke must sit in front of combatants to function as visual cover.
    // Cloud timestamps come from the arena. Using the PC wall clock here can
    // make every cloud permanently transparent when that clock is ahead or
    // behind the server, so animate against the authoritative snapshot time.
    this.drawFartClouds(snapshot?.fartClouds || [], snapshotRenderTime(snapshot));
    this.drawEffects("foreground");
    if (this.debug) {
      this.drawWeaponDebug();
      this.drawCollision(players);
    }
    ctx.restore();
    this.drawMinimap(snapshot, players.find((player) => player.id === localId));
    this.drawNukeScreenEffects(now);
  }

  drawTerrain() {
    const { ctx, camera, assets } = this;
    if (assets.playableArea) {
      this.drawSpaceBackdrop();
      ctx.save();
      if (tracePolygon(ctx, assets.playableArea, -camera.x, -camera.y)) ctx.clip();
      this.drawGroundTexture();
      ctx.restore();
      if (!assets.boundaryOverlay) this.drawArenaRim();
      return;
    }
    this.drawGroundTexture();
  }

  drawGroundTexture() {
    const { ctx, camera, viewport, assets } = this;
    if (assets.terrainMode === "tile") {
      const tileWidth = assets.terrain.naturalWidth;
      const tileHeight = assets.terrain.naturalHeight;
      const startX = Math.floor(camera.x / tileWidth) * tileWidth;
      const startY = Math.floor(camera.y / tileHeight) * tileHeight;
      const endX = Math.min(assets.world.width, camera.x + viewport.width);
      const endY = Math.min(assets.world.height, camera.y + viewport.height);
      for (let worldY = startY; worldY < endY; worldY += tileHeight) {
        for (let worldX = startX; worldX < endX; worldX += tileWidth) {
          const drawWidth = Math.min(tileWidth, assets.world.width - worldX);
          const drawHeight = Math.min(tileHeight, assets.world.height - worldY);
          ctx.drawImage(assets.terrain, 0, 0, drawWidth, drawHeight, worldX - camera.x, worldY - camera.y, drawWidth, drawHeight);
          const column = Math.floor(worldX / tileWidth);
          const row = Math.floor(worldY / tileHeight);
          const variation = terrainVariationForCell(assets.terrainVariations, column, row);
          if (variation) drawTerrainVariationCell(ctx, variation, worldX - camera.x, worldY - camera.y, drawWidth, drawHeight);
        }
      }
      return;
    }
    const sx = clamp(camera.x, 0, Math.max(0, assets.terrain.naturalWidth - viewport.width));
    const sy = clamp(camera.y, 0, Math.max(0, assets.terrain.naturalHeight - viewport.height));
    const sw = Math.min(viewport.width, assets.terrain.naturalWidth - sx);
    const sh = Math.min(viewport.height, assets.terrain.naturalHeight - sy);
    ctx.drawImage(assets.terrain, sx, sy, sw, sh, sx - camera.x, sy - camera.y, sw, sh);
  }

  drawSpaceBackdrop() {
    const { ctx, camera, viewport } = this;
    ctx.fillStyle = "#020105";
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    const nebulae = [
      { x: 520, y: 390, radius: 620, color: "rgba(126,18,8,.16)" },
      { x: 3240, y: 520, radius: 760, color: "rgba(166,27,10,.13)" },
      { x: 3180, y: 2140, radius: 670, color: "rgba(88,9,20,.17)" },
      { x: 860, y: 2100, radius: 720, color: "rgba(133,20,8,.12)" },
    ];
    for (const nebula of nebulae) {
      const x = nebula.x - camera.x;
      const y = nebula.y - camera.y;
      if (x + nebula.radius < 0 || y + nebula.radius < 0 || x - nebula.radius > viewport.width || y - nebula.radius > viewport.height) continue;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, nebula.radius);
      gradient.addColorStop(0, nebula.color);
      gradient.addColorStop(.5, nebula.color.replace(/\.[0-9]+\)$/, ".06)"));
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(Math.max(0, x - nebula.radius), Math.max(0, y - nebula.radius), nebula.radius * 2, nebula.radius * 2);
    }

    const cell = 92;
    const startColumn = Math.floor(camera.x / cell) - 1;
    const endColumn = Math.ceil((camera.x + viewport.width) / cell) + 1;
    const startRow = Math.floor(camera.y / cell) - 1;
    const endRow = Math.ceil((camera.y + viewport.height) / cell) + 1;
    for (let row = startRow; row <= endRow; row += 1) {
      for (let column = startColumn; column <= endColumn; column += 1) {
        const seed = column * 719.17 + row * 313.61;
        if (seededUnit(seed) < .36) continue;
        const x = column * cell + seededUnit(seed + 3) * cell - camera.x;
        const y = row * cell + seededUnit(seed + 7) * cell - camera.y;
        const radius = .45 + seededUnit(seed + 11) * 1.25;
        ctx.globalAlpha = .28 + seededUnit(seed + 17) * .62;
        ctx.fillStyle = seededUnit(seed + 19) > .84 ? "#ff8b54" : "#fff4df";
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawArenaRim() {
    const { ctx, camera, viewport, assets } = this;
    const points = assets.playableArea;
    if (!points) return;
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const stroke = (width, color, shadowColor = "transparent", shadowBlur = 0) => {
      if (!tracePolygon(ctx, points)) return;
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = shadowBlur;
      ctx.stroke();
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(-400, -400, assets.world.width + 800, assets.world.height + 800);
    points.forEach((point, index) => {
      if (index) ctx.lineTo(point.x, point.y); else ctx.moveTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.clip("evenodd");
    stroke(132, "#050306", "rgba(255,41,4,.35)", 22);
    stroke(92, "#ec3207", "rgba(255,71,6,.64)", 15);
    ctx.restore();
    stroke(58, "#121013");
    ctx.shadowBlur = 0;

    for (let segment = 0; segment < points.length; segment += 1) {
      const start = points[segment];
      const end = points[(segment + 1) % points.length];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy) || 1;
      const normalX = -dy / length;
      const normalY = dx / length;
      let travelled = 8 + seededUnit(segment * 31 + 2) * 26;
      let rockIndex = 0;
      while (travelled < length) {
        const seed = segment * 101 + rockIndex * 17.37;
        const amount = travelled / length;
        const offset = (seededUnit(seed + 4) - .5) * 26;
        const x = mix(start.x, end.x, amount) + normalX * offset;
        const y = mix(start.y, end.y, amount) + normalY * offset;
        if (x > camera.x - 60 && x < camera.x + viewport.width + 60 && y > camera.y - 60 && y < camera.y + viewport.height + 60) {
          const radiusX = 14 + seededUnit(seed + 8) * 19;
          const radiusY = 10 + seededUnit(seed + 12) * 12;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.atan2(dy, dx) + (seededUnit(seed + 16) - .5) * .8);
          ctx.fillStyle = seededUnit(seed + 20) > .5 ? "#171619" : "#242022";
          ctx.strokeStyle = "rgba(103,86,82,.42)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          const corners = 7;
          for (let corner = 0; corner < corners; corner += 1) {
            const angle = Math.PI * 2 * corner / corners;
            const roughness = .78 + seededUnit(seed + corner * 5.3) * .34;
            const rockX = Math.cos(angle) * radiusX * roughness;
            const rockY = Math.sin(angle) * radiusY * roughness;
            if (corner) ctx.lineTo(rockX, rockY); else ctx.moveTo(rockX, rockY);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.strokeStyle = "rgba(255,93,26,.2)";
          ctx.beginPath();
          ctx.moveTo(-radiusX * .34, radiusY * .08);
          ctx.lineTo(radiusX * .05, -radiusY * .22);
          ctx.lineTo(radiusX * .34, radiusY * .03);
          ctx.stroke();
          ctx.restore();
        }
        travelled += 38 + seededUnit(seed + 24) * 28;
        rockIndex += 1;
      }
    }
    ctx.restore();
  }

  drawTerrainFeatures() {
    for (const item of this.assets.environment) {
      if (item.renderLayer === "terrain") this.drawEnvironmentObject(item, false);
    }
  }

  drawBoundaryOverlay() {
    const overlay = this.assets.boundaryOverlay;
    if (!overlay) return;
    const { ctx, camera, assets } = this;
    if (overlay.mode === "polygon-strip" && assets.playableArea) {
      drawPolygonBoundary(ctx, overlay, assets.playableArea, -camera.x, -camera.y, 1, 1, this.viewport.width, this.viewport.height);
      return;
    }
    drawNineSliceBoundary(ctx, overlay, -camera.x, -camera.y, assets.world.width, assets.world.height, overlay.inset);
  }

  drawEnvironmentObject(item, satelliteState = null, healingState = null, weaponState = null) {
    const x = item.x - this.camera.x;
    const y = item.y - this.camera.y;
    const cullRadius = Math.hypot(item.width, item.height) / 2;
    if (x + cullRadius < -20 || x - cullRadius > this.viewport.width + 20 || y + cullRadius < -20 || y - cullRadius > this.viewport.height + 20) return;
    this.ctx.save();
    this.ctx.translate(x, y);
    const rotation = (Number(item.rotation) || 0) * Math.PI / 180;
    if (rotation) this.ctx.rotate(rotation);
    if (item.definition.render?.flipX === true) this.ctx.scale(-1, 1);
    this.ctx.drawImage(item.image, -item.width / 2, -item.height / 2, item.width, item.height);
    if (this.effectsQuality > .4 && item.kind === "satellite" && satelliteState?.active) this.drawSatelliteActivePulse(item);
    if (this.effectsQuality > .4 && item.kind === "healing-station" && healingState?.active) this.drawHealingStationActivePulse(item);
    if (this.effectsQuality > .4 && item.kind === "weapon-station" && weaponState && weaponState.state !== "READY") this.drawWeaponStationPulse(item, weaponState);
    this.ctx.restore();
    if (item.kind === "satellite" && satelliteState) this.drawSatelliteStationLabel(item, satelliteState);
    if (item.kind === "healing-station" && healingState) this.drawHealingStationLabel(item, healingState);
    if (item.kind === "weapon-station" && weaponState) this.drawWeaponStationLabel(item, weaponState);
  }

  drawSatelliteActivePulse(item) {
    const pulse = .5 + .5 * Math.sin(performance.now() / 180);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = this.dynamicComposite("screen");
    ctx.globalAlpha = .25 + pulse * .3;
    ctx.strokeStyle = "#5ff7ff";
    ctx.shadowColor = "#42eaff";
    ctx.shadowBlur = this.dynamicShadowBlur(12);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(item.width * .035, -item.height * .18, item.width * (.08 + pulse * .018), item.height * (.025 + pulse * .008), -.15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawSatelliteStationLabel(item, state) {
    const ctx = this.ctx;
    const x = item.x - this.camera.x;
    const y = item.y - this.camera.y - Math.min(item.height * .55, 200);
    const connected = state?.connected === true;
    const active = state?.active === true;
    const status = connected ? "UPLINK CONNECTED" : active ? "UPLINK ACTIVE" : "MOVE CLOSE TO CONNECT";
    const width = 184;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = connected ? "rgba(5,29,42,.92)" : "rgba(7,18,27,.82)";
    ctx.strokeStyle = connected ? "rgba(95,247,255,.95)" : "rgba(95,247,255,.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-width / 2, -18, width, 38, 8);
    ctx.fill(); ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#8ffaff";
    ctx.font = "1000 10px ui-monospace,monospace";
    ctx.fillText("SATELLITE STATION", 0, -7);
    ctx.fillStyle = connected ? "#effeff" : "rgba(218,252,255,.8)";
    ctx.font = "900 8px ui-monospace,monospace";
    ctx.fillText(status, 0, 8);
    ctx.restore();
  }

  drawHealingStationActivePulse(item) {
    const pulse = .5 + .5 * Math.sin(performance.now() / 170);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = this.dynamicComposite("screen");
    ctx.globalAlpha = .3 + pulse * .42;
    const glow = ctx.createRadialGradient(0, item.height * .08, 0, 0, item.height * .08, item.width * .4);
    glow.addColorStop(0, "rgba(150,255,174,.58)");
    glow.addColorStop(.52, "rgba(77,255,121,.2)");
    glow.addColorStop(1, "rgba(77,255,121,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(0, item.height * .08, item.width * (.39 + pulse * .035), item.height * (.25 + pulse * .025), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#7dff87";
    ctx.shadowColor = "#4dff79";
    ctx.shadowBlur = this.dynamicShadowBlur(18);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, item.height * .08, item.width * (.32 + pulse * .025), item.height * (.19 + pulse * .018), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawHealingStationLabel(item, state) {
    const ctx = this.ctx;
    const x = item.x - this.camera.x;
    const y = item.y - this.camera.y - item.height * .55;
    const connected = state?.connected === true;
    const inProgress = state?.inProgress === true;
    const status = inProgress
      ? `HEALING IN PROGRESS · +1 HP IN ${(Math.max(0, state.remaining) / 1000).toFixed(1)}s`
      : connected ? "CONNECTED · HEALTH FULL" : "MOVE CLOSE TO CONNECT";
    const width = inProgress ? 252 : 184;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = connected ? "rgba(7,38,20,.9)" : "rgba(8,18,15,.8)";
    ctx.strokeStyle = connected ? "rgba(125,255,135,.9)" : "rgba(125,255,135,.48)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-width / 2, -18, width, 38, 8);
    ctx.fill(); ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#aaffae";
    ctx.font = "1000 10px ui-monospace,monospace";
    ctx.fillText("HEALING STATION", 0, -7);
    ctx.fillStyle = connected ? "#effff0" : "rgba(220,255,224,.78)";
    ctx.font = "900 8px ui-monospace,monospace";
    ctx.fillText(status, 0, 8);
    ctx.restore();
  }

  drawWeaponStationPulse(item, state) {
    const pulse = .5 + .5 * Math.sin(performance.now() / (state.state === "GENERATING" ? 105 : 260));
    const color = state.state === "GENERATING" ? "#52f5ff" : "#ffba55";
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = this.dynamicComposite("screen");
    ctx.globalAlpha = .25 + pulse * .42;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = this.dynamicShadowBlur(state.state === "GENERATING" ? 26 : 13);
    ctx.lineWidth = state.state === "GENERATING" ? 4 : 2;
    ctx.beginPath();
    ctx.ellipse(0, item.height * .08, item.width * (.34 + pulse * .035), item.height * (.2 + pulse * .025), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawWeaponStationLabel(item, state) {
    const ctx = this.ctx;
    const x = item.x - this.camera.x;
    const y = item.y - this.camera.y - item.height * .55;
    const status = state?.state || "READY";
    const localGenerating = status === "GENERATING" && state?.userId === state?.localPlayerId;
    const seconds = Math.max(0, Number(status === "COOLDOWN" ? state?.cooldownRemaining : state?.generationRemaining) || 0) / 1000;
    const message = status === "COOLDOWN"
      ? `COOLING DOWN · ${seconds.toFixed(1)}s`
      : status === "GENERATING"
        ? `${localGenerating ? "CREATING YOUR WEAPON" : "IN USE"} · ${seconds.toFixed(1)}s`
        : "MOVE CLOSE TO GENERATE";
    const accent = status === "COOLDOWN" ? "#ffc06a" : "#75f8ff";
    const width = status === "READY" ? 218 : 250;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = status === "COOLDOWN" ? "rgba(42,24,7,.92)" : "rgba(5,27,39,.92)";
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-width / 2, -22, width, 46, 8);
    ctx.fill(); ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = accent;
    ctx.font = "1000 10px ui-monospace,monospace";
    ctx.fillText("RANDOM WEAPON GENERATOR", 0, -10);
    ctx.fillStyle = "#f2ffff";
    ctx.font = "900 8px ui-monospace,monospace";
    ctx.fillText(message, 0, 5);
    if (status !== "READY") {
      const total = status === "COOLDOWN" ? 10000 : 5000;
      const progress = status === "COOLDOWN" ? 1 - Math.min(1, seconds * 1000 / total) : 1 - Math.min(1, seconds * 1000 / total);
      ctx.fillStyle = "rgba(255,255,255,.14)";
      ctx.fillRect(-width / 2 + 10, 15, width - 20, 3);
      ctx.fillStyle = accent;
      ctx.fillRect(-width / 2 + 10, 15, (width - 20) * progress, 3);
    }
    ctx.restore();
  }

  drawPlayer(player, local) {
    if (!player.alive) return;
    const now = performance.now();
    const character = this.assets.characters?.get(player.skinId) || this.assets.character;
    const { definition, body, shadow } = character;
    const x = player.x - this.camera.x;
    const y = player.y - this.camera.y;
    const moving = Math.hypot(player.vx || 0, player.vy || 0) > 10;
    const hover = definition.hover;
    const bob = Math.sin(now / 1000 * Math.PI * 2 * (moving ? hover.movingRateHz : hover.idleRateHz)) * (moving ? hover.movingAmplitude : hover.idleAmplitude) - (moving ? hover.movementOffset : 0);
    const shadowBounds = definition.shadowSourceBounds;
    const shadowSize = definition.shadowDrawSize;
    const shadowOffset = definition.shadowOffset;
    const ctx = this.ctx;
    const tier = player.randomWeapon ? (player.randomWeapon.visualTier || 7) : Number.isFinite(player.weaponTier) ? player.weaponTier : 1;
    const equipmentKey = player.randomWeapon ? `random:${player.randomWeapon.name}` : `standard:${tier}`;
    const previousTier = this.weaponTierByPlayer.get(player.id);
    if (previousTier === undefined) this.weaponTierByPlayer.set(player.id, equipmentKey);
    else if (previousTier !== equipmentKey) {
      this.weaponTierByPlayer.set(player.id, equipmentKey);
      this.weaponTierPulseUntil.set(player.id, now + 320);
    }
    let spawnAlpha = 1, spawnScale = 1, spawnLift = 0;
    const spawn = this.spawnAnimations.get(player.id);
    if (spawn) {
      const amount = clamp((now - spawn.born) / spawn.life, 0, 1);
      if (amount >= 1) this.spawnAnimations.delete(player.id);
      else {
        const eased = 1 - Math.pow(1 - amount, 3);
        spawnAlpha = clamp(amount * 2.4, 0, 1);
        spawnScale = .18 + eased * .82 + Math.sin(amount * Math.PI) * .1;
        spawnLift = (1 - eased) * 24;
      }
    }
    let moleAlpha = player.moleMode && local ? .38 : 1;
    let moleOffset = player.moleMode && local ? 11 : 0;
    const moleTransition = this.moleTransitions.get(player.id);
    if (moleTransition) {
      const amount = clamp((now - moleTransition.born) / moleTransition.life, 0, 1);
      if (amount >= 1) this.moleTransitions.delete(player.id);
      else if (moleTransition.kind === "burrow") {
        const eased = smoothstep(amount);
        moleAlpha = mix(1, .3, eased);
        moleOffset = mix(0, 18, eased);
      } else {
        const eased = smoothstep(amount);
        moleAlpha = mix(.35, 1, eased);
        moleOffset = mix(17, 0, eased);
      }
    }
    if (player.moleMode && local) {
      ctx.save();
      const ruffle = Math.sin(now / 115);
      ctx.globalAlpha = .82;
      ctx.fillStyle = "rgba(84,43,56,.72)";
      ctx.beginPath(); ctx.ellipse(x, y + 10, 30 + ruffle * 3, 10 + ruffle * 1.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(236,191,112,.88)"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(x, y + 9, 25 + ruffle * 4, 7.5, 0, 0, Math.PI * 2); ctx.stroke();
      for (let index = 0; index < 5; index++) {
        const angle = now / 420 + index * Math.PI * .4;
        ctx.fillStyle = index % 2 ? "#bb7a56" : "#e2b56e";
        ctx.beginPath(); ctx.arc(x + Math.cos(angle) * 25, y + 7 + Math.sin(angle) * 7, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    const protectedAlpha = player.protectedUntil > Date.now() ? 0.64 + Math.sin(now / 70) * 0.2 : 1;
    const unitAlpha = spawnAlpha * protectedAlpha;
    let modulePose = null;
    const hiddenUntil = this.weaponHiddenUntil.get(player.id) || 0;
    if (hiddenUntil && hiddenUntil <= now) this.weaponHiddenUntil.delete(player.id);
    const weaponHidden = player.moleMode || this.weaponHiddenByMole.has(player.id) || (!local && hiddenUntil > now);
    if (!weaponHidden) {
      const visual = weaponVisualForTier(tier);
      const recoilState = this.weaponRecoil.get(player.id);
      let recoil = 0;
      if (recoilState) {
        const amount = clamp((now - recoilState.born) / recoilState.life, 0, 1);
        if (amount >= 1) this.weaponRecoil.delete(player.id);
        else recoil = recoilState.distance * (1 - smoothstep(amount));
      }
      modulePose = {
        ...weaponPose(player, visual, { scale: spawnScale, verticalOffset: bob + spawnLift, recoil, weaponMount: character.skin?.weaponMount }),
        playerId: player.id,
        tier,
        alpha: unitAlpha,
      };
      this.weaponPoses.set(player.id, modulePose);
    }

    ctx.save();
    ctx.globalAlpha = moleAlpha * unitAlpha;
    ctx.drawImage(shadow, shadowBounds.x, shadowBounds.y, shadowBounds.width, shadowBounds.height,
      x + shadowOffset.x - shadowSize.width * definition.shadowPivot.x,
      y + shadowOffset.y - shadowSize.height * definition.shadowPivot.y,
      shadowSize.width, shadowSize.height);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = moleAlpha * unitAlpha;
    ctx.translate(x, y + bob + spawnLift + moleOffset);
    ctx.scale(spawnScale, spawnScale);
    const angle = Math.atan2(player.aimY || 0, player.aimX || 1) - definition.sourceForwardAngleDegrees * Math.PI / 180;
    ctx.rotate(angle);
    const draw = definition.drawSize;
    ctx.drawImage(body, -draw.width * definition.bodyPivot.normalized.x, -draw.height * definition.bodyPivot.normalized.y, draw.width, draw.height);
    if (this.hitUntil.get(player.id) > now) {
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Shoulder modules are foreground equipment: rotating the player must
    // never push the weapon beneath the body and turn it into an under-arm gun.
    if (modulePose) this.drawWeaponModule(modulePose, now);

    if (player.shieldHits) {
      ctx.save(); ctx.strokeStyle = "rgba(120,241,255,.86)"; ctx.lineWidth = 2; ctx.shadowColor = "#72efff"; ctx.shadowBlur = this.dynamicShadowBlur(10);
      ctx.beginPath(); ctx.arc(x, y - 8, 31 + Math.sin(now / 160) * 2, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = "rgba(17,6,28,.9)";
    ctx.fillRect(x - 38, y - 66, 76, 15);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "800 9px system-ui";
    const label = this.debug && !local ? `${player.name} · HP${player.hp} · T${player.weaponTier} · S${player.killScore}` : player.name;
    ctx.fillText(label, x, y - 55);
    this.drawHealthBar(x, y - 48, player.hp, local ? "#a6ff65" : (player.color || "#ff6cca"));
    if (local) this.drawUplinkLabel(x, y, now);
    ctx.restore();
  }

  drawUplinkLabel(x, y, now) {
    if (!this.uplink.active && this.uplink.phase !== "lost") return;
    const elapsed = now - this.uplink.changedAt;
    let text = "UPLINK ACTIVE";
    let alpha = .92;
    let lift = 0;
    if (this.uplink.phase === "linked" && elapsed < 1150) {
      text = "UPLINK CONNECTED";
      alpha = clamp(elapsed / 130, 0, 1);
      lift = 5 * (1 - smoothstep(elapsed / 500));
    } else if (this.uplink.phase === "lost") {
      if (elapsed >= 720) { this.uplink.phase = null; return; }
      text = "UPLINK LOST";
      alpha = 1 - smoothstep(elapsed / 720);
      lift = -4 * smoothstep(elapsed / 720);
    }
    const ctx = this.ctx;
    const fontSize = Math.round(clamp(this.viewport.width / 110, 8, 10));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `900 ${fontSize}px ui-monospace,monospace`;
    ctx.textAlign = "center";
    const width = ctx.measureText(text).width + 12;
    const labelY = y - 84 + lift;
    ctx.fillStyle = "rgba(5,24,34,.82)";
    ctx.fillRect(x - width / 2, labelY - fontSize - 5, width, fontSize + 9);
    ctx.strokeStyle = "rgba(87,244,255,.65)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - width / 2 + .5, labelY - fontSize - 4.5, width - 1, fontSize + 8);
    ctx.shadowColor = "#50efff";
    ctx.shadowBlur = this.uplink.active ? 8 : 3;
    ctx.fillStyle = this.uplink.active ? "#9afaff" : "#79cbd2";
    ctx.fillText(text, x, labelY);
    ctx.restore();
  }

  drawWeaponModule(pose, now) {
    const { visual } = pose;
    const x = pose.pivotWorld.x - this.camera.x;
    const y = pose.pivotWorld.y - this.camera.y;
    if (x < -80 || y < -80 || x > this.viewport.width + 80 || y > this.viewport.height + 80) return;
    const pulseUntil = this.weaponTierPulseUntil.get(pose.playerId) || 0;
    if (pulseUntil > now) {
      const remaining = clamp((pulseUntil - now) / 320, 0, 1);
      const expansion = 1 - remaining;
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = pose.alpha * remaining * .75;
      ctx.strokeStyle = visual.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 10 + expansion * 18, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    } else if (pulseUntil) this.weaponTierPulseUntil.delete(pose.playerId);

    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = pose.alpha;
    ctx.translate(x, y);
    ctx.rotate(pose.angle);
    if (visual.flipX) ctx.scale(-1, 1);
    const art = visual.kind === "sprite" ? this.assets.weapons?.[visual.asset] : null;
    if (art) {
      const source = art.sourceBounds;
      ctx.drawImage(
        art.image, source.x, source.y, source.width, source.height,
        -pose.drawWidth * visual.pivot.x, -pose.drawHeight * visual.pivot.y,
        pose.drawWidth, pose.drawHeight,
      );
    } else this.drawProceduralWeapon(pose);
    ctx.restore();
  }

  drawProceduralWeapon(pose) {
    const { visual, drawWidth: width, drawHeight: height } = pose;
    const ctx = this.ctx;
    const left = -width * visual.pivot.x;
    const top = -height * visual.pivot.y;
    ctx.shadowColor = visual.accent;
    ctx.shadowBlur = 6;
    ctx.fillStyle = "#2a2033";
    ctx.strokeStyle = visual.accent;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(left + width * .37, 0, width * .32, height * .47, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#4b2a66";
    ctx.fillRect(left + width * .34, top + height * .24, width * .54, height * .52);
    ctx.strokeRect(left + width * .34, top + height * .24, width * .54, height * .52);
    ctx.fillStyle = visual.accent;
    ctx.fillRect(left + width * .86, top + height * .17, width * .1, height * .66);
    ctx.shadowBlur = 0;
    const barrelCount = Math.max(1, visual.barrels || 1);
    for (let index = 0; index < barrelCount; index++) {
      const offset = (index - (barrelCount - 1) / 2) * Math.min(4, height * .2);
      ctx.strokeStyle = index % 2 ? "#ff9d48" : "#98fbff";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(left + width * .48, offset);
      ctx.lineTo(left + width * .88, offset);
      ctx.stroke();
    }
    ctx.fillStyle = "#dffeff";
    ctx.beginPath(); ctx.arc(left + width * .28, 0, Math.max(2, height * .12), 0, Math.PI * 2); ctx.fill();
  }

  drawHealthBar(centerX, topY, hp, color) {
    const ctx = this.ctx;
    const segments = 3;
    const segmentWidth = 17;
    const segmentHeight = 6;
    const gap = 2;
    const totalWidth = segments * segmentWidth + (segments - 1) * gap;
    const left = centerX - totalWidth / 2;
    ctx.save();
    ctx.fillStyle = "rgba(10,3,18,.92)";
    ctx.fillRect(left - 3, topY - 3, totalWidth + 6, segmentHeight + 6);
    for (let index = 0; index < segments; index++) {
      const x = left + index * (segmentWidth + gap);
      ctx.fillStyle = index < hp ? color : "rgba(255,255,255,.14)";
      ctx.fillRect(x, topY, segmentWidth, segmentHeight);
      ctx.strokeStyle = index < hp ? "rgba(255,255,255,.5)" : "rgba(255,255,255,.16)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + .5, topY + .5, segmentWidth - 1, segmentHeight - 1);
    }
    ctx.restore();
  }

  drawProjectiles(projectiles) {
    const ctx = this.ctx;
    for (const projectile of projectiles) {
      const x = projectile.x - this.camera.x;
      const y = projectile.y - this.camera.y;
      const trailX = Number.isFinite(projectile.trailStartX) ? projectile.trailStartX : projectile.x;
      const trailY = Number.isFinite(projectile.trailStartY) ? projectile.trailStartY : projectile.y;
      if (!this.isWorldSegmentVisible(trailX, trailY, projectile.x, projectile.y, 65)) continue;
      const plasma = projectile.tier === 6;
      const colors = ["#d8ff8a", "#fff0a4", "#98f8ff", "#ffb1f0", "#ffc977", "#c89cff"];
      ctx.save();
      if (plasma) {
        const angle = Math.atan2(projectile.vy || 0, projectile.vx || 1);
        const pulse = .92 + Math.sin(performance.now() / 42 + projectile.id) * .08;
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.globalCompositeOperation = this.dynamicComposite("screen");
        ctx.lineCap = "round";
        if (this.effectsQuality <= .4) {
          ctx.strokeStyle = "#9ef8ff";
          ctx.lineWidth = 5 * pulse;
          ctx.beginPath(); ctx.moveTo(-38, 0); ctx.lineTo(13, 0); ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.beginPath(); ctx.arc(13, 0, 3.5 * pulse, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          continue;
        }
        ctx.shadowColor = "#9a4dff";
        ctx.shadowBlur = this.dynamicShadowBlur(28);
        ctx.strokeStyle = "rgba(113,50,255,.48)";
        ctx.lineWidth = 15 * pulse;
        ctx.beginPath(); ctx.moveTo(-48, 0); ctx.lineTo(11, 0); ctx.stroke();
        const beam = ctx.createLinearGradient(-50, 0, 13, 0);
        beam.addColorStop(0, "rgba(62,26,170,0)");
        beam.addColorStop(.24, "rgba(137,74,255,.76)");
        beam.addColorStop(.76, "rgba(108,240,255,.98)");
        beam.addColorStop(1, "#ffffff");
        ctx.shadowBlur = this.dynamicShadowBlur(18);
        ctx.strokeStyle = beam;
        ctx.lineWidth = 7 * pulse;
        ctx.beginPath(); ctx.moveTo(-52, 0); ctx.lineTo(12, 0); ctx.stroke();
        ctx.shadowColor = "#dfffff";
        ctx.shadowBlur = this.dynamicShadowBlur(10);
        ctx.strokeStyle = "rgba(247,255,255,.96)";
        ctx.lineWidth = 2.3;
        ctx.beginPath(); ctx.moveTo(-32, 0); ctx.lineTo(14, 0); ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(13, 0, 4.5 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.shadowColor = plasma ? "#9c63ff" : (colors[(projectile.tier || 1) - 1] || "#74f6ff");
      ctx.shadowBlur = this.dynamicShadowBlur(plasma ? 19 : 11);
      ctx.fillStyle = plasma ? "#f8efff" : ctx.shadowColor;
      if (Number.isFinite(projectile.trailStartX) && Number.isFinite(projectile.trailStartY)) {
        ctx.strokeStyle = ctx.shadowColor;
        ctx.globalAlpha = .72;
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(1.5, (projectile.radius || 3.5) * 1.15);
        ctx.beginPath();
        ctx.moveTo(projectile.trailStartX - this.camera.x, projectile.trailStartY - this.camera.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.arc(x, y, projectile.radius || 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  drawLocalProjectiles() {
    const now = performance.now();
    const projectiles = [];
    for (const [id, projectile] of this.localProjectiles) {
      // The confirmation is materialized immediately before this draw pass.
      // Pin its first rendered sample to the nozzle exactly; it begins moving
      // on the following animation frame.
      if (projectile.firstFrame) projectile.born = now;
      const age = projectile.firstFrame ? 0 : now - projectile.born;
      if (age >= projectile.life) {
        this.localProjectiles.delete(id);
        continue;
      }
      const rendered = {
        ...projectile,
        x: projectile.startX + projectile.vx * age / 1000,
        y: projectile.startY + projectile.vy * age / 1000,
        trailStartX: projectile.previousX,
        trailStartY: projectile.previousY,
      };
      // Local shots are predicted ahead of the authoritative server response.
      // Stop that visual prediction at the same static colliders used by the
      // simulation so network latency can never paint a round through a wall.
      const previous = { x: projectile.previousX, y: projectile.previousY };
      const next = { x: rendered.x, y: rendered.y };
      const projectilePolygons = this.assets?.projectileBroadphase?.querySegment(previous, next, projectile.radius || 3.5)
        || this.assets?.projectilePolygons || [];
      const blocked = projectilePolygons.some((polygon) =>
        sweptCircleIntersectsPolygon(
          previous,
          next,
          projectile.radius || 3.5,
          polygon,
        ));
      if (blocked) {
        this.localProjectiles.delete(id);
        continue;
      }
      projectiles.push(rendered);
      if (projectile.firstFrame && this.lastLocalLaunch?.projectileId === id) {
        this.lastLocalLaunch.firstRenderError = Math.hypot(
          projectiles.at(-1).x - projectile.startX,
          projectiles.at(-1).y - projectile.startY,
        );
      }
      projectile.previousX = projectiles.at(-1).x;
      projectile.previousY = projectiles.at(-1).y;
      projectile.firstFrame = false;
    }
    this.drawProjectiles(projectiles);
  }

  drawEffects(pass = "foreground", now = performance.now()) {
    const effects = pass === "muzzle" ? this.effects : this.effectPasses[pass] || [];
    for (const effect of effects) {
      const muzzleEffect = effect.type === "weapon-muzzle" || effect.type === "muzzle";
      if (!this.isEffectVisible(effect)) continue;
      if (effect.type === "nuke-blast") {
        this.ctx.save();
        if (pass === "underlay") this.drawNukeUnderlay(effect, now);
        else if (pass === "foreground") this.drawNukeForeground(effect, now);
        this.ctx.restore();
        continue;
      }
      if (pass === "underlay") continue;
      if ((pass === "muzzle") !== muzzleEffect) continue;
      const amount = (now - effect.born) / effect.life;
      this.ctx.save();
      this.ctx.globalAlpha = 1 - amount;
      if (effect.type === "weapon-muzzle" || effect.type === "muzzle") {
        const plasma = effect.tier === 6;
        const visual = weaponVisualForTier(effect.tier);
        const x = effect.x - this.camera.x, y = effect.y - this.camera.y;
        const size = Math.max(2, effect.size || visual.flashSize);
        this.ctx.translate(x, y);
        this.ctx.rotate(effect.angle || 0);
        this.ctx.globalCompositeOperation = this.dynamicComposite("screen");
        this.ctx.fillStyle = plasma ? "#f7efff" : "#eaffff";
        this.ctx.shadowColor = visual.accent;
        this.ctx.shadowBlur = this.dynamicShadowBlur(plasma ? 26 : 8);
        this.ctx.beginPath();
        this.ctx.arc(0, 0, size * (1 - amount * .45), 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = visual.accent;
        this.ctx.beginPath();
        this.ctx.moveTo(size * .25, -size * .58);
        this.ctx.lineTo(size * (plasma ? 3.2 : 1.85), 0);
        this.ctx.lineTo(size * .25, size * .58);
        this.ctx.closePath();
        this.ctx.fill();
        if (plasma) {
          this.ctx.strokeStyle = `rgba(116,225,255,${1 - amount})`;
          this.ctx.lineWidth = 2.5;
          this.ctx.beginPath(); this.ctx.arc(0, 0, size + amount * 20, 0, Math.PI * 2); this.ctx.stroke();
        }
        this.ctx.restore();
        continue;
      }
      if (effect.type === "blocked") {
        this.ctx.globalAlpha = 1 - amount;
        this.ctx.fillStyle = "#ffdc70"; this.ctx.textAlign = "center"; this.ctx.font = "1000 24px ui-monospace,monospace";
        this.ctx.fillText("BLOCKED", this.viewport.width / 2, this.viewport.height * .35); this.ctx.restore(); continue;
      }
      if (effect.type === "shield" || effect.type === "teleport") {
        this.ctx.strokeStyle = effect.type === "shield" ? "#7ef6ff" : "#ef8cff";
        this.ctx.lineWidth = 3; this.ctx.beginPath();
        this.ctx.arc(effect.x - this.camera.x, effect.y - this.camera.y, 12 + amount * 35, 0, Math.PI * 2); this.ctx.stroke(); this.ctx.restore(); continue;
      }
      if (effect.type === "dirt") {
        this.drawDirtEffect(effect, amount, now);
        this.ctx.restore(); continue;
      }
      if (effect.type === "death") {
        this.drawDeathEffect(effect, amount, now);
        this.ctx.restore(); continue;
      }
      if (effect.type === "respawn") {
        this.drawRespawnEffect(effect, amount, now);
        this.ctx.restore(); continue;
      }
      if (effect.type === "nuke-hit") {
        this.drawNukeHit(effect, amount);
        this.ctx.restore(); continue;
      }
      this.ctx.strokeStyle = "#91fbff";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath(); this.ctx.arc(effect.x - this.camera.x, effect.y - this.camera.y, 4 + amount * 16, 0, Math.PI * 2); this.ctx.stroke();
      this.ctx.restore();
    }
  }

  drawNukeUnderlay(effect, now) {
    const ctx = this.ctx;
    const timeline = nukeTimeline(now - effect.born);
    const x = effect.x - this.camera.x, y = effect.y - this.camera.y;
    const bloomRadius = effect.radius * (.08 + timeline.plasmaProgress * .43);
    if (timeline.plasmaAlpha <= .001) return;
    ctx.globalCompositeOperation = this.dynamicComposite("screen");
    ctx.globalAlpha = timeline.plasmaAlpha * .58;
    this.drawEnergyGlow(x, y, bloomRadius, timeline.plasmaAlpha * .58);
  }

  drawEnergyGlow(x, y, radius, alpha = 1) {
    if (!this.energyGlowSprite || radius <= 0 || alpha <= .001) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = this.dynamicComposite("screen");
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.energyGlowSprite, x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  }

  drawNukeForeground(effect, now) {
    const ctx = this.ctx;
    const timeline = nukeTimeline(now - effect.born);
    const x = effect.x - this.camera.x, y = effect.y - this.camera.y;
    ctx.globalCompositeOperation = this.dynamicComposite("lighter");

    if (timeline.ignitionAlpha > .001 || timeline.coreAlpha > .001) {
      const ignitionRadius = mix(8, Math.min(92, effect.radius * .14), timeline.ignitionProgress);
      const coreRadius = mix(ignitionRadius, effect.radius * .31, timeline.coreProgress);
      ctx.globalAlpha = Math.max(timeline.ignitionAlpha, timeline.coreAlpha * .86);
      this.drawEnergyGlow(x, y, coreRadius, Math.max(timeline.ignitionAlpha, timeline.coreAlpha * .86));

      ctx.globalAlpha = timeline.ignitionAlpha;
      ctx.strokeStyle = "#ffffff";
      ctx.shadowColor = "#56f4ff"; ctx.shadowBlur = this.dynamicShadowBlur(12);
      ctx.lineWidth = 3.5;
      const starLength = ignitionRadius * 1.65;
      ctx.beginPath();
      ctx.moveTo(x - starLength, y); ctx.lineTo(x + starLength, y);
      ctx.moveTo(x, y - starLength); ctx.lineTo(x, y + starLength);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (timeline.shockwaveAlpha > .001) {
      const ringRadius = effect.radius * timeline.shockwaveProgress;
      const lineWidth = mix(15, 2.2, timeline.shockwaveProgress);
      ctx.globalAlpha = timeline.shockwaveAlpha;
      ctx.strokeStyle = "#c9ffff";
      ctx.shadowColor = "#35ddff"; ctx.shadowBlur = this.dynamicShadowBlur(mix(15, 5, timeline.shockwaveProgress));
      ctx.lineWidth = lineWidth;
      ctx.beginPath(); ctx.arc(x, y, ringRadius, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha *= .82;
      ctx.strokeStyle = "#45cfff";
      ctx.lineWidth = Math.max(1.5, lineWidth * .28);
      ctx.beginPath(); ctx.arc(x, y, Math.max(0, ringRadius - lineWidth * .72), 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      if (!effect.shockwaveCuePlayed && timeline.elapsed >= 100) {
        effect.shockwaveCuePlayed = true;
        this.emitNukeAudioCue("shockwave", effect);
      }
    }

    if (timeline.secondaryAlpha > .001) {
      ctx.globalAlpha = timeline.secondaryAlpha * .64;
      ctx.strokeStyle = "#ef64ff";
      ctx.shadowColor = "#9b54ff"; ctx.shadowBlur = this.dynamicShadowBlur(8);
      ctx.lineWidth = mix(9, 1.5, timeline.secondaryProgress);
      ctx.beginPath(); ctx.arc(x, y, effect.radius * timeline.secondaryProgress, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    const particleStep = this.effectParticleStep();
    for (let shardIndex = 0; shardIndex < effect.shards.length; shardIndex += particleStep) {
      const shard = effect.shards[shardIndex];
      const elapsed = timeline.elapsed - shard.delay;
      if (elapsed <= 0 || elapsed >= shard.life) continue;
      const amount = elapsed / shard.life;
      const fade = 1 - smoothstep(amount);
      const distance = shard.distance * easeOutCubic(amount);
      const headX = x + Math.cos(shard.angle) * distance;
      const headY = y + Math.sin(shard.angle) * distance;
      const tailDistance = Math.max(0, distance - shard.length * (1 - amount * .45));
      ctx.globalAlpha = fade * .95;
      ctx.strokeStyle = shard.color;
      ctx.lineWidth = shard.width * (1 - amount * .45);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(shard.angle) * tailDistance, y + Math.sin(shard.angle) * tailDistance);
      ctx.lineTo(headX, headY);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    for (let particleIndex = 0; particleIndex < effect.particles.length; particleIndex += particleStep) {
      const particle = effect.particles[particleIndex];
      const elapsed = timeline.elapsed - particle.delay;
      if (elapsed <= 0 || elapsed >= particle.life) continue;
      const amount = elapsed / particle.life;
      const fade = (1 - smoothstep(amount)) * Math.min(1, elapsed / 55);
      const distance = particle.distance * easeOutCubic(amount);
      const angle = particle.angle + particle.drift * amount;
      const px = x + Math.cos(angle) * distance;
      const py = y + Math.sin(angle) * distance;
      if (particle.type === "violet-fragment" || particle.type === "magenta-fragment") {
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(px, py); ctx.rotate(angle + particle.spin * amount);
        ctx.fillStyle = particle.color;
        const size = particle.size * (1 - amount * .35);
        ctx.beginPath(); ctx.moveTo(size * 1.45, 0); ctx.lineTo(-size * .65, size * .72); ctx.lineTo(-size, -size * .52); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else {
        ctx.globalAlpha = fade;
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = particle.size;
        const tailLength = particle.size * particle.stretch;
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(angle) * tailLength, py - Math.sin(angle) * tailLength);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  drawNukeHit(effect, amount) {
    const ctx = this.ctx;
    const x = effect.x - this.camera.x, y = effect.y - this.camera.y;
    const fade = 1 - smoothstep(amount);
    ctx.globalCompositeOperation = this.dynamicComposite("screen");
    ctx.globalAlpha = fade;
    ctx.fillStyle = "rgba(255,255,255,.78)";
    ctx.shadowColor = "#60f4ff"; ctx.shadowBlur = this.dynamicShadowBlur(20);
    ctx.beginPath(); ctx.arc(x, y, 19 + amount * 23, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#7bfbff"; ctx.lineWidth = 3 - amount * 1.5;
    ctx.beginPath(); ctx.arc(x, y, 25 + amount * 32, 0, Math.PI * 2); ctx.stroke();
  }

  drawDirtEffect(effect, amount, now) {
    const ctx = this.ctx;
    const x = effect.x - this.camera.x, y = effect.y - this.camera.y + 9;
    const age = (now - effect.born) / 1000;
    const fade = Math.pow(1 - amount, .72);
    const outward = effect.direction === "emerge" ? 1.2 : 1;
    ctx.globalAlpha = fade;
    ctx.fillStyle = `rgba(83,43,48,${.72 * fade})`;
    ctx.beginPath(); ctx.ellipse(x, y, 25 + amount * 31, 8 + amount * 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = effect.direction === "emerge" ? "#f1ca7f" : "#c58c5e";
    ctx.lineWidth = 4 - amount * 2.3;
    ctx.shadowColor = "#6d3940"; ctx.shadowBlur = this.dynamicShadowBlur(8);
    ctx.beginPath(); ctx.ellipse(x, y, 17 + amount * 46, 5 + amount * 17, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    for (let index = 0; index < 7; index++) {
      const phase = index * .91 + effect.x * .01;
      const puffAmount = clamp(amount * 1.5 - index * .035, 0, 1);
      const distance = (14 + index * 5) * puffAmount;
      ctx.globalAlpha = fade * .55;
      ctx.fillStyle = index % 2 ? "#b87855" : "#e0ad6e";
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(phase) * distance, y - 4 - Math.sin(phase) * distance * .24 - puffAmount * 14, 7 + puffAmount * 7, 4 + puffAmount * 4, phase, 0, Math.PI * 2);
      ctx.fill();
    }
    const particles = effect.particles || [];
    for (let particleIndex = 0; particleIndex < particles.length; particleIndex += this.effectParticleStep()) {
      const particle = particles[particleIndex];
      const px = x + particle.vx * age * outward;
      const py = y + particle.vy * age * outward + 125 * age * age;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(px, py); ctx.rotate(particle.spin * age);
      ctx.fillStyle = particle.color;
      ctx.fillRect(-particle.size / 2, -particle.size / 3, particle.size, particle.size * .66);
      ctx.restore();
    }
  }

  drawDeathEffect(effect, amount, now) {
    const ctx = this.ctx;
    const x = effect.x - this.camera.x, y = effect.y - this.camera.y;
    const age = (now - effect.born) / 1000;
    const fade = Math.pow(1 - amount, .62);
    const scale = effect.scale || 1;
    ctx.globalCompositeOperation = this.dynamicComposite("screen");
    ctx.globalAlpha = fade;
    const core = ctx.createRadialGradient(x, y, 0, x, y, (18 + amount * 46) * scale);
    core.addColorStop(0, "rgba(255,255,255,.98)");
    core.addColorStop(.22, "rgba(126,247,255,.92)");
    core.addColorStop(.56, "rgba(218,88,255,.62)");
    core.addColorStop(1, "rgba(255,92,68,0)");
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(x, y, (18 + amount * 46) * scale, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,240,166,${fade})`;
    ctx.shadowColor = "#ff7eef"; ctx.shadowBlur = this.dynamicShadowBlur(24);
    ctx.lineWidth = (6 - amount * 4) * scale;
    ctx.beginPath(); ctx.arc(x, y, (8 + amount * 74) * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = `rgba(103,237,255,${fade * .75})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, (22 + amount * 102) * scale, 0, Math.PI * 2); ctx.stroke();
    const particles = effect.particles || [];
    for (let particleIndex = 0; particleIndex < particles.length; particleIndex += this.effectParticleStep()) {
      const particle = particles[particleIndex];
      const px = x + particle.vx * age;
      const py = y + particle.vy * age + 75 * age * age;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(px, py); ctx.rotate(particle.spin * age);
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color; ctx.shadowBlur = this.dynamicShadowBlur(12);
      ctx.beginPath();
      ctx.moveTo(particle.size * 1.8, 0);
      ctx.lineTo(-particle.size, particle.size * .55);
      ctx.lineTo(-particle.size * .6, -particle.size * .55);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  drawRespawnEffect(effect, amount, now) {
    const ctx = this.ctx;
    const x = effect.x - this.camera.x, y = effect.y - this.camera.y;
    const age = (now - effect.born) / 1000;
    const fade = Math.pow(1 - amount, .75);
    const arrive = smoothstep(clamp(amount * 1.8, 0, 1));
    ctx.globalCompositeOperation = this.dynamicComposite("screen");
    const column = ctx.createLinearGradient(x, y - 150, x, y + 34);
    column.addColorStop(0, "rgba(116,239,255,0)");
    column.addColorStop(.5, `rgba(130,246,255,${.18 * fade})`);
    column.addColorStop(1, "rgba(185,255,132,0)");
    ctx.fillStyle = column;
    ctx.fillRect(x - 30 * fade, y - 150, 60 * fade, 184);
    ctx.shadowColor = "#8efbff"; ctx.shadowBlur = this.dynamicShadowBlur(20);
    for (let ring = 0; ring < 3; ring++) {
      const phase = clamp(amount * 1.35 - ring * .1, 0, 1);
      ctx.globalAlpha = (1 - phase) * .9;
      ctx.strokeStyle = ring === 1 ? "#b9ff79" : "#91f5ff";
      ctx.lineWidth = 3 - ring * .5;
      ctx.beginPath();
      ctx.ellipse(x, y + 13 - arrive * 10, 14 + phase * (52 + ring * 8), 4 + phase * 15, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const particles = effect.particles || [];
    for (let particleIndex = 0; particleIndex < particles.length; particleIndex += this.effectParticleStep()) {
      const particle = particles[particleIndex];
      const px = x + particle.vx * age * .55;
      const py = y + 12 + particle.vy * age - 85 * age;
      ctx.globalAlpha = fade;
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color; ctx.shadowBlur = this.dynamicShadowBlur(10);
      ctx.beginPath(); ctx.arc(px, py, particle.size * .55, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = fade;
    ctx.fillStyle = "rgba(244,255,255,.92)";
    ctx.beginPath(); ctx.arc(x, y, 5 + (1 - amount) * 17, 0, Math.PI * 2); ctx.fill();
  }

  drawWeaponDebug() {
    const ctx = this.ctx;
    for (const pose of this.weaponPoses.values()) {
      const pivotX = pose.pivotWorld.x - this.camera.x;
      const pivotY = pose.pivotWorld.y - this.camera.y;
      const muzzleX = pose.muzzleWorld.x - this.camera.x;
      const muzzleY = pose.muzzleWorld.y - this.camera.y;
      ctx.save();
      ctx.strokeStyle = "rgba(113,247,255,.9)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pivotX, pivotY); ctx.lineTo(muzzleX, muzzleY); ctx.stroke();
      ctx.fillStyle = "#63f4ff";
      ctx.beginPath(); ctx.arc(pivotX, pivotY, 2.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffe96d";
      ctx.beginPath(); ctx.arc(muzzleX, muzzleY, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(8,2,16,.88)";
      ctx.fillRect(pivotX - 2, pivotY + 5, 76, 12);
      ctx.fillStyle = "#dffeff";
      ctx.font = "800 8px ui-monospace,monospace";
      ctx.textAlign = "left";
      ctx.fillText(`T${pose.tier} ${pose.visual.id}`, pivotX + 2, pivotY + 14);
      ctx.restore();
    }
  }

  drawCollision(players) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(112,255,159,.9)";
    ctx.lineWidth = 1.5;
    for (const polygon of this.assets.polygons) {
      ctx.beginPath();
      polygon.forEach((point, index) => index ? ctx.lineTo(point.x - this.camera.x, point.y - this.camera.y) : ctx.moveTo(point.x - this.camera.x, point.y - this.camera.y));
      ctx.closePath(); ctx.stroke();
    }
    for (const satellite of this.assets.satellites) {
      ctx.save();
      ctx.strokeStyle = "rgba(69,239,255,.16)";
      ctx.lineWidth = 46;
      ctx.lineJoin = "round";
      ctx.beginPath();
      satellite.polygon.forEach((point, index) => index ? ctx.lineTo(point.x - this.camera.x, point.y - this.camera.y) : ctx.moveTo(point.x - this.camera.x, point.y - this.camera.y));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(157,255,88,.95)";
    for (const player of players) { if (!player.alive) continue; ctx.beginPath(); ctx.arc(player.x - this.camera.x, player.y - this.camera.y, 17, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
    this.collisionEditor?.draw(ctx, this.camera);
  }

  drawPickup(pickup) {
    const labels = { spy: "SPY", speed: "SPD", health: "HP", shield: "SHD", teleport: "TP", mole: "MOLE", fart: "FART" };
    const colors = { spy: "#8cecff", speed: "#ffeb67", health: "#8cff82", shield: "#81adff", teleport: "#e788ff", mole: "#c49a72", fart: "#adff70" };
    const now = performance.now();
    const phase = now / 1000 * Math.PI * 1.8 + pickup.id * 1.73;
    const x = pickup.x - this.camera.x, y = pickup.y - this.camera.y;
    const bob = Math.sin(phase) * 3.4;
    const lift = 7 - bob;
    const pulse = 1 + Math.sin(phase * .72) * .035;
    const color = colors[pickup.type] || "#fff";
    const art = this.assets.powerups?.[pickup.type];
    const ctx = this.ctx;

    // The shadow remains grounded while its width/opacity respond to height,
    // making the pickup read as a hovering world object rather than a decal.
    ctx.save();
    ctx.globalAlpha = .3 - lift * .009;
    ctx.fillStyle = "#100517";
    ctx.shadowColor = "rgba(4,0,10,.75)";
    ctx.shadowBlur = this.dynamicShadowBlur(7);
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 14 - lift * .22, 5 - lift * .055, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = .34 + Math.sin(phase * .72) * .08;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.shadowColor = color;
    ctx.shadowBlur = this.dynamicShadowBlur(12);
    ctx.beginPath();
    ctx.arc(x, y - lift, 21 + Math.sin(phase * .72) * 2.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    if (art) {
      const source = art.sourceBounds;
      const maxDrawSize = 40; // Moon Blob is 84x84: pickups stay under half-size.
      const aspect = source.width / source.height;
      const drawWidth = (aspect >= 1 ? maxDrawSize : maxDrawSize * aspect) * pulse;
      const drawHeight = (aspect >= 1 ? maxDrawSize / aspect : maxDrawSize) * pulse;
      ctx.save();
      ctx.translate(x, y - lift);
      ctx.rotate(Math.sin(phase * .55) * .035);
      ctx.shadowColor = color;
      ctx.shadowBlur = this.dynamicShadowBlur(10 + Math.sin(phase * .72) * 2);
      ctx.drawImage(art.image, source.x, source.y, source.width, source.height, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      ctx.restore();
      return;
    }

    const radius = 16 * pulse;
    ctx.save();
    ctx.translate(x, y - lift);
    ctx.fillStyle = color;
    ctx.globalAlpha = .92;
    ctx.shadowColor = color;
    ctx.shadowBlur = this.dynamicShadowBlur(12);
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = "#180820"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `1000 ${pickup.type === "fart" || pickup.type === "mole" ? 7 : 9}px ui-monospace,monospace`;
    ctx.fillText(labels[pickup.type] || "?", 0, .5);
    ctx.restore();
  }

  drawPickupLabel(pickup) {
    const now = performance.now();
    const phase = now / 1000 * Math.PI * 1.8 + pickup.id * 1.73;
    const x = pickup.x - this.camera.x;
    const y = pickup.y - this.camera.y;
    if (x < -90 || x > this.viewport.width + 90 || y < -70 || y > this.viewport.height + 70) return;
    const bob = Math.sin(phase) * 3.4;
    const lift = 7 - bob;
    const label = POWERUP_DISPLAY_NAMES[pickup.type] || String(pickup.type || "POWER-UP").toUpperCase();
    const color = ({ spy: "#8cecff", speed: "#ffeb67", health: "#8cff82", shield: "#81adff", teleport: "#e788ff", mole: "#e5b477", fart: "#adff70" })[pickup.type] || "#fff";
    const ctx = this.ctx;
    ctx.save();
    ctx.font = "1000 9px ui-monospace,monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let width = this.pickupLabelWidths.get(label);
    if (!width) {
      width = Math.ceil(ctx.measureText(label).width) + 12;
      this.pickupLabelWidths.set(label, width);
    }
    const labelX = clamp(x, width / 2 + 4, this.viewport.width - width / 2 - 4);
    const boxX = Math.round(labelX - width / 2);
    const boxY = Math.round(clamp(y - lift - 40, 4, this.viewport.height - 19));
    ctx.fillStyle = "rgba(12,4,22,.9)";
    ctx.shadowColor = "rgba(3,0,8,.86)";
    ctx.shadowBlur = this.dynamicShadowBlur(6);
    ctx.fillRect(boxX, boxY, width, 15);
    ctx.shadowBlur = this.dynamicShadowBlur(8);
    ctx.shadowColor = color;
    ctx.strokeStyle = color;
    ctx.globalAlpha = .82;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX + .5, boxY + .5, width - 1, 14);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = this.dynamicShadowBlur(4);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, labelX, boxY + 7.8);
    ctx.restore();
  }

  drawFartClouds(clouds, serverNow = Date.now()) {
    const ctx = this.ctx;
    const now = Number.isFinite(serverNow) ? serverNow : Date.now();
    for (const cloud of clouds) {
      const x = cloud.x - this.camera.x, y = cloud.y - this.camera.y;
      if (x + cloud.radius < -20 || x - cloud.radius > this.viewport.width + 20 || y + cloud.radius < -20 || y - cloud.radius > this.viewport.height + 20) continue;
      const age = Math.max(0, now - cloud.createdAt);
      const remaining = Math.max(0, cloud.expiresAt - now);
      const visibility = Math.min(1, age / 260, remaining / 650);
      const pulse = 1 + Math.sin(performance.now() / 310 + cloud.id) * .025;
      const radius = cloud.radius * fartCloudGrowth(cloud.createdAt, now, cloud.growMs) * pulse;
      const sprite = this.fartCloudSprites[cloud.id % this.fartCloudSprites.length];
      if (!sprite) continue;
      ctx.save();
      ctx.globalAlpha = visibility;
      ctx.translate(x, y);
      ctx.rotate(performance.now() / 12000 + cloud.id * .31);
      ctx.drawImage(sprite, -radius, -radius, radius * 2, radius * 2);

      ctx.globalAlpha = visibility * .26;
      ctx.strokeStyle = "#dfff57";
      ctx.lineWidth = Math.max(2, radius * .009);
      ctx.setLineDash([radius * .055, radius * .035]);
      ctx.lineDashOffset = -performance.now() / 24;
      ctx.beginPath(); ctx.arc(0, 0, radius * .61, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  collectNukeWarnings(nukes, now = Date.now()) {
    const renderNow = performance.now();
    for (const [id, expiresAt] of this.detonatedNukeIds) if (renderNow >= expiresAt) this.detonatedNukeIds.delete(id);
    for (const nuke of nukes || []) {
      if (!this.detonatedNukeIds.has(nuke.id) && Number.isFinite(nuke.startedAt) && Number.isFinite(nuke.detonateAt)) {
        this.nukeWarnings.set(nuke.id, { ...nuke });
      }
    }
    for (const [id, nuke] of this.nukeWarnings) {
      if (this.detonatedNukeIds.has(id) || now > nuke.detonateAt + 250) this.nukeWarnings.delete(id);
    }
    return [...this.nukeWarnings.values()];
  }

  getNukeScreenShake(now = performance.now()) {
    if (this.reducedMotion) return { x: 0, y: 0 };
    const compact = this.viewport.width < 700 || globalThis.document?.documentElement?.classList.contains("mobile-preview");
    const baseAmplitude = compact ? 5 : 7.5;
    let x = 0, y = 0;
    for (const effect of this.effects) {
      if (effect.type !== "nuke-blast") continue;
      const timeline = nukeTimeline(now - effect.born);
      const amplitude = baseAmplitude * timeline.shakeAmount;
      x += (Math.sin(timeline.elapsed * .31 + effect.seed) * .68 + Math.sin(timeline.elapsed * .083 + effect.seed * .7) * .32) * amplitude;
      y += (Math.cos(timeline.elapsed * .27 + effect.seed * 1.3) * .64 + Math.sin(timeline.elapsed * .097 + effect.seed) * .36) * amplitude;
    }
    return { x: clamp(x, -9, 9), y: clamp(y, -9, 9) };
  }

  drawNukeScreenEffects(now = performance.now()) {
    let flashAlpha = 0, energyAlpha = 0;
    for (const effect of this.effects) {
      if (effect.type !== "nuke-blast") continue;
      const timeline = nukeTimeline(now - effect.born);
      flashAlpha = Math.max(flashAlpha, timeline.flashAlpha);
      energyAlpha = Math.max(energyAlpha, (1 - smoothstep(timeline.elapsed / 520)) * .16);
    }
    if (flashAlpha <= .001 && energyAlpha <= .001) return;
    const ctx = this.ctx;
    const motionFactor = this.reducedMotion ? .35 : 1;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    if (flashAlpha > .001) {
      ctx.globalAlpha = flashAlpha * .44 * motionFactor;
      ctx.fillStyle = "#eaffff";
      ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);
    }
    if (energyAlpha > .001) {
      const left = ctx.createLinearGradient(0, 0, this.viewport.width * .32, 0);
      left.addColorStop(0, `rgba(37,229,255,${energyAlpha * motionFactor})`);
      left.addColorStop(1, "rgba(37,229,255,0)");
      ctx.globalAlpha = 1; ctx.fillStyle = left; ctx.fillRect(0, 0, this.viewport.width * .34, this.viewport.height);
      const right = ctx.createLinearGradient(this.viewport.width, 0, this.viewport.width * .68, 0);
      right.addColorStop(0, `rgba(255,44,220,${energyAlpha * .7 * motionFactor})`);
      right.addColorStop(1, "rgba(255,44,220,0)");
      ctx.fillStyle = right; ctx.fillRect(this.viewport.width * .66, 0, this.viewport.width * .34, this.viewport.height);
    }
    ctx.restore();
  }

  drawNukes(nukes, now = Date.now()) {
    const ctx = this.ctx;
    for (const nuke of this.collectNukeWarnings(nukes, now)) {
      const timeline = nukeWarningTimeline(nuke.startedAt, nuke.detonateAt, now);
      const x = nuke.x - this.camera.x, y = nuke.y - this.camera.y;
      const pulse = .5 + .5 * Math.sin(now / 58);
      const targetRadius = nuke.radius * (.045 + smoothstep(timeline.amount) * .955);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.strokeStyle = `rgba(255,102,56,${.68 + pulse * .25})`;
      ctx.lineWidth = 3.5 + timeline.finalCharge * 3;
      ctx.setLineDash([18, 11]);
      ctx.lineDashOffset = -now / 18;
      ctx.shadowColor = "#ff5c42"; ctx.shadowBlur = 11 + timeline.finalCharge * 15;
      ctx.beginPath(); ctx.arc(x, y, targetRadius, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);

      ctx.globalAlpha = .25 + timeline.amount * .2;
      ctx.strokeStyle = "#ffbd5e"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, nuke.radius, 0, Math.PI * 2); ctx.stroke();
      if (timeline.finalCharge > .001) {
        ctx.globalAlpha = timeline.finalCharge * .8;
        ctx.strokeStyle = "#8ffaff"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, Math.max(5, nuke.radius * (1 - timeline.finalCharge) * .38), 0, Math.PI * 2); ctx.stroke();
      }

      const coreRadius = 12 + timeline.amount * 24 + pulse * 5;
      ctx.globalAlpha = .6 + timeline.amount * .35;
      const core = ctx.createRadialGradient(x, y, 0, x, y, coreRadius);
      core.addColorStop(0, "rgba(255,255,255,.96)");
      core.addColorStop(.22, "rgba(102,247,255,.88)");
      core.addColorStop(.62, "rgba(255,91,64,.55)");
      core.addColorStop(1, "rgba(255,61,113,0)");
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(x, y, coreRadius, 0, Math.PI * 2); ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = timeline.finalCharge > .7 ? "#ffffff" : "#ffd5a1";
      ctx.shadowColor = "#ff4f5d"; ctx.shadowBlur = 10;
      ctx.textAlign = "center"; ctx.font = "1000 18px ui-monospace,monospace";
      ctx.fillText("NUKE INCOMING", x, y - 34);
      if (this.debug) {
        ctx.globalAlpha = .72; ctx.strokeStyle = "#74f5ff"; ctx.lineWidth = 1.5; ctx.setLineDash([7, 7]);
        ctx.beginPath(); ctx.arc(x, y, nuke.radius, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  drawNukeMinimap(snapshot, left, top, scaleX, scaleY, nowEpoch = Date.now(), nowRender = performance.now()) {
    const ctx = this.ctx;
    const radiusScale = (scaleX + scaleY) / 2;
    for (const nuke of this.collectNukeWarnings(snapshot?.nukes || [], nowEpoch)) {
      const timeline = nukeWarningTimeline(nuke.startedAt, nuke.detonateAt, nowEpoch);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = .42 + timeline.amount * .38;
      ctx.strokeStyle = "#ff764f"; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(left + nuke.x * scaleX, top + nuke.y * scaleY, nuke.radius * radiusScale, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
    }
    for (const effect of this.effects) {
      if (effect.type !== "nuke-blast") continue;
      const timeline = nukeTimeline(nowRender - effect.born);
      if (timeline.shockwaveAlpha <= .001) continue;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = timeline.shockwaveAlpha * .78;
      ctx.strokeStyle = "#79f8ff"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(left + effect.x * scaleX, top + effect.y * scaleY, effect.radius * timeline.shockwaveProgress * radiusScale, 0, Math.PI * 2);
      ctx.stroke(); ctx.restore();
    }
  }

  drawMinimap(snapshot, localPlayer) {
    const ctx = this.ctx;
    const compact = this.viewport.width < 700 || document.documentElement.classList.contains("mobile-preview");
    const width = compact ? 142 : 190;
    const height = Math.round(width * this.assets.world.height / this.assets.world.width);
    const margin = 12;
    const controlsClearance = compact ? 108 : 47;
    const left = this.viewport.width - width - margin;
    const top = this.viewport.height - height - margin - controlsClearance;
    const scaleX = width / this.assets.world.width;
    const scaleY = height / this.assets.world.height;
    const surface = this.getMinimapSurface(width, height);

    ctx.save();
    ctx.fillStyle = "rgba(12,4,22,.9)";
    ctx.fillRect(left - 6, top - 22, width + 12, height + 28);
    ctx.strokeStyle = "rgba(117,239,255,.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(left - 5.5, top - 21.5, width + 11, height + 27);
    ctx.fillStyle = "#c9fbff";
    ctx.font = "900 9px ui-monospace, monospace";
    ctx.textAlign = "left";
    const spyActive = localPlayer?.spyRemaining > 0;
    const satelliteConnected = localPlayer?.satelliteConnected === true;
    const radarLabel = spyActive && satelliteConnected ? "SPY + SATELLITE" : spyActive ? "SPY ACTIVE" : satelliteConnected ? "UPLINK ACTIVE" : "";
    ctx.fillText(radarLabel ? `MINIMAP · ${radarLabel}` : "MINIMAP", left, top - 9);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.drawImage(surface, left, top, width, height);
    this.drawNukeMinimap(snapshot, left, top, scaleX, scaleY);
    if (localPlayer?.alive) {
      const markerX = left + localPlayer.x * scaleX;
      const markerY = top + localPlayer.y * scaleY;
      const pulse = 4.5 + Math.sin(performance.now() / 180) * 1.2;
      ctx.fillStyle = "#a6ff65";
      ctx.shadowColor = "#a6ff65";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(markerX, markerY, pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
    for (const marker of snapshot?.minimapPlayers || []) {
      const markerX = left + marker.x * scaleX, markerY = top + marker.y * scaleY;
      ctx.save();
      if (marker.threat) {
        const pulse = 6 + Math.sin(performance.now() / 130) * 1.4;
        ctx.strokeStyle = "#ffd84f"; ctx.fillStyle = "#ff6b50"; ctx.lineWidth = 2.5; ctx.shadowColor = "#ffd84f"; ctx.shadowBlur = 9;
        ctx.beginPath(); ctx.arc(markerX, markerY, pulse, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff2a0"; ctx.font = "1000 8px sans-serif"; ctx.textAlign = "center"; ctx.fillText("♛", markerX, markerY - 8);
      } else {
        ctx.fillStyle = marker.color || "#ff66ca"; ctx.beginPath(); ctx.arc(markerX, markerY, 3.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
    ctx.restore();
  }

  getMinimapSurface(width, height) {
    const key = `${width}x${height}`;
    const existing = this.minimapSurfaces.get(key);
    if (existing) return existing;

    const surface = document.createElement("canvas");
    surface.width = width;
    surface.height = height;
    const ctx = surface.getContext("2d", { alpha: false });
    const scaleX = width / this.assets.world.width;
    const scaleY = height / this.assets.world.height;

    ctx.fillStyle = "#020105";
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    if (this.assets.playableArea && tracePolygon(ctx, this.assets.playableArea, 0, 0, scaleX, scaleY)) ctx.clip();
    ctx.globalAlpha = .58;
    ctx.drawImage(this.assets.terrain, 0, 0, width, height);
    if (this.assets.terrainMode === "tile" && this.assets.terrainVariations?.length) {
      const tileWidth = this.assets.terrain.naturalWidth;
      const tileHeight = this.assets.terrain.naturalHeight;
      for (let worldY = 0; worldY < this.assets.world.height; worldY += tileHeight) {
        for (let worldX = 0; worldX < this.assets.world.width; worldX += tileWidth) {
          const drawWidth = Math.min(tileWidth, this.assets.world.width - worldX);
          const drawHeight = Math.min(tileHeight, this.assets.world.height - worldY);
          const variation = terrainVariationForCell(this.assets.terrainVariations, Math.floor(worldX / tileWidth), Math.floor(worldY / tileHeight));
          if (variation) drawTerrainVariationCell(ctx, variation, worldX * scaleX, worldY * scaleY, drawWidth * scaleX, drawHeight * scaleY);
        }
      }
    }
    ctx.restore();
    const overlay = this.assets.boundaryOverlay;
    if (!overlay && this.assets.playableArea && tracePolygon(ctx, this.assets.playableArea, 0, 0, scaleX, scaleY)) {
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(255,68,8,.8)";
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = "rgba(30,25,27,.96)";
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    if (overlay) {
      if (overlay.mode === "polygon-strip" && this.assets.playableArea) {
        drawPolygonBoundary(ctx, overlay, this.assets.playableArea, 0, 0, scaleX, scaleY, width, height);
      } else {
        drawNineSliceBoundary(ctx, overlay, 0, 0, width, height, {
          left: overlay.inset.left * scaleX,
          top: overlay.inset.top * scaleY,
          right: overlay.inset.right * scaleX,
          bottom: overlay.inset.bottom * scaleY,
        });
      }
    }
    for (const item of this.assets.environment) {
      if (item.renderLayer !== "terrain") continue;
      ctx.save();
      ctx.translate(item.x * scaleX, item.y * scaleY);
      ctx.rotate((Number(item.rotation) || 0) * Math.PI / 180);
      ctx.globalAlpha = item.assetId === "hell-moon-scorch-decal" ? .68 : .9;
      ctx.drawImage(item.image, -item.width * scaleX / 2, -item.height * scaleY / 2, item.width * scaleX, item.height * scaleY);
      ctx.restore();
    }
    ctx.fillStyle = "rgba(19,5,30,.24)";
    ctx.fillRect(0, 0, width, height);
    for (const item of this.assets.environment) {
      if (item.renderLayer === "terrain") continue;
      ctx.beginPath();
      item.polygon.forEach((point, index) => {
        const x = point.x * scaleX;
        const y = point.y * scaleY;
        if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = item.kind === "satellite" ? "rgba(74,239,255,.78)" : item.kind === "healing-station" ? "rgba(125,255,135,.82)" : item.kind === "weapon-station" ? "rgba(255,179,76,.86)" : "rgba(229,137,255,.6)";
      ctx.fill();
      ctx.strokeStyle = item.kind === "satellite" ? "rgba(184,252,255,.92)" : item.kind === "healing-station" ? "rgba(210,255,214,.9)" : item.kind === "weapon-station" ? "rgba(255,227,171,.94)" : "rgba(255,213,255,.62)";
      ctx.lineWidth = .75;
      ctx.stroke();
    }
    this.minimapSurfaces.set(key, surface);
    return surface;
  }

  getDebugState(playerId = this.localPlayerId) {
    const pose = this.weaponPoses.get(playerId);
    const now = performance.now();
    const blast = this.effects.findLast?.((effect) => effect.type === "nuke-blast" && now - effect.born < effect.life)
      || [...this.effects].reverse().find((effect) => effect.type === "nuke-blast" && now - effect.born < effect.life);
    const warning = [...this.nukeWarnings.values()][0];
    const nuke = blast ? {
      state: now - blast.born < 900 ? "DETONATING" : "DECAY",
      x: blast.x, y: blast.y, radius: blast.radius,
      elapsed: Math.max(0, now - blast.born), particles: blast.particles.length,
    } : warning ? {
      state: "WARNING", x: warning.x, y: warning.y, radius: warning.radius,
      elapsed: Math.max(0, Date.now() - warning.startedAt), particles: 0,
    } : null;
    return {
      camera: { ...this.camera },
      playerScreen: { ...this.playerScreen },
      viewport: { ...this.viewport },
      quality: { render: this.renderQuality, effects: this.effectsQuality, frameMs: this.frameTimeEma },
      weapon: pose ? {
        tier: pose.tier,
        id: pose.visual.id,
        rotation: pose.angle,
        pivot: { ...pose.visual.pivot },
        attachmentWorld: { ...pose.pivotWorld },
        muzzleWorld: { ...pose.muzzleWorld },
      } : null,
      lastLocalLaunch: this.lastLocalLaunch ? {
        ...this.lastLocalLaunch,
        muzzleWorld: { ...this.lastLocalLaunch.muzzleWorld },
        direction: { ...this.lastLocalLaunch.direction },
      } : null,
      nuke,
    };
  }
}
