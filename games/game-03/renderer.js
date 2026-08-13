import { weaponPose, weaponVisualForTier } from "./weapon-visuals.js?v=20260813-5";
import { fartCloudGrowth } from "./effect-timing.js?v=20260813";
import {
  NUKE_EFFECT_DURATION_MS,
  createNukeBurst,
  easeOutCubic,
  nukeTimeline,
  nukeWarningTimeline,
} from "./nuke-vfx.js?v=20260813";

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function mix(a, b, amount) { return a + (b - a) * amount; }
function smoothstep(amount) { const t = clamp(amount, 0, 1); return t * t * (3 - 2 * t); }
function seededUnit(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
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
    this.localPlayerId = null;
    this.minimapSurfaces = new Map();
    this.nukeWarnings = new Map();
    this.detonatedNukeIds = new Map();
    this.reducedMotionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") || null;
    this.reducedMotion = this.reducedMotionQuery?.matches === true;
    this.reducedMotionQuery?.addEventListener?.("change", (event) => { this.reducedMotion = event.matches; });
    this.collisionEditor = null;
    this.uplink = { active: false, phase: null, changedAt: 0 };
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.viewport = { width, height, dpr };
  }

  impact(event) {
    if (Number.isSafeInteger(event.projectileId)) this.localProjectiles.delete(event.projectileId);
    this.effects.push({ x: event.x, y: event.y, born: performance.now(), life: 280 });
  }

  clearLocalShotHistory() {
    this.localProjectiles.clear();
    this.pendingLocalShotConfirmations.length = 0;
    this.lastLocalLaunch = null;
  }

  confirmShot(event, local = false) {
    const projectile = event?.projectile;
    if (!projectile || !Number.isSafeInteger(projectile.id) ||
        !Number.isFinite(projectile.vx) || !Number.isFinite(projectile.vy)) return;
    const speed = Math.hypot(projectile.vx, projectile.vy);
    if (speed < .001) return;
    if (local) {
      // A WebSocket callback can run between animation frames, when
      // weaponPoses still describes the previous frame. Defer local launch
      // until render() has calculated this frame's exact visible nozzle.
      this.pendingLocalShotConfirmations.push(event);
      return;
    }
    this.materializeShot(event, false, this.weaponPoses.get(event.playerId));
  }

  materializeShot(event, local, shotPose) {
    const projectile = event.projectile;
    const speed = Math.hypot(projectile.vx, projectile.vy);
    const authoritativeDirection = { x: projectile.vx / speed, y: projectile.vy / speed };
    // Local presentation follows the barrel that was calculated for this very
    // render frame. The muzzle flash, projectile origin, and trajectory all
    // consume the same pose; there is no second nozzle calculation to drift.
    // Ordinary local rounds follow the exact currently rendered barrel pose.
    // Shotgun pellets are deliberately server-authored at different angles,
    // so preserve each pellet's authoritative spread direction.
    const useRenderedBarrel = local && shotPose?.forward && projectile.tier !== 5;
    const directionX = useRenderedBarrel ? shotPose.forward.x : authoritativeDirection.x;
    const directionY = useRenderedBarrel ? shotPose.forward.y : authoritativeDirection.y;
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

  flushLocalShotConfirmations() {
    if (!this.pendingLocalShotConfirmations.length) return;
    const confirmations = this.pendingLocalShotConfirmations.splice(0);
    const currentPose = this.weaponPoses.get(this.localPlayerId);
    if (!currentPose) return;
    for (const event of confirmations) this.materializeShot(event, true, currentPose);
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
    const particleCount = this.reducedMotion ? 32 : compact ? 44 : 64;
    const shardCount = this.reducedMotion ? 4 : compact ? 8 : 12;
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

  render(snapshot, localId, predicted, delta, inputVisual) {
    const { ctx } = this;
    const { width, height, dpr } = this.viewport;
    const now = performance.now();
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

    ctx.fillStyle = "#371447";
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(shake.x, shake.y);
    this.drawTerrain();
    this.drawNukes(snapshot?.nukes || [], Date.now());
    this.drawEffects("underlay", now);

    const players = (snapshot?.players || []).map((player) => player.id === localId && predicted
      ? { ...player, x: predicted.x, y: predicted.y, aimX: inputVisual?.aimX ?? player.aimX, aimY: inputVisual?.aimY ?? player.aimY }
      : player);
    this.renderedPlayers = new Map(players.map((player) => [player.id, { x: player.x, y: player.y, vx: player.vx || 0, vy: player.vy || 0 }]));
    const layers = [
      ...this.assets.environment.map((item) => ({ type: "environment", depth: item.depthY, value: item })),
      ...(snapshot?.pickups || []).map((pickup) => ({ type: "pickup", depth: pickup.y, value: pickup })),
      ...players.map((player) => ({ type: "player", depth: player.y, value: player })),
    ].sort((a, b) => a.depth - b.depth);
    for (const layer of layers) {
      if (layer.type === "environment") this.drawEnvironmentObject(layer.value, snapshot?.activeSatelliteIds?.includes(layer.value.id) === true);
      else if (layer.type === "pickup") this.drawPickup(layer.value);
      else this.drawPlayer(layer.value, layer.value.id === localId);
    }
    // Labels are a world-space readability layer so nearby players and rocks
    // cannot cover the name while deciding whether to collect a power-up.
    for (const pickup of snapshot?.pickups || []) this.drawPickupLabel(pickup);
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
    this.drawFartClouds(snapshot?.fartClouds || []);
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
    const { ctx, camera, viewport, assets } = this;
    const sx = clamp(camera.x, 0, Math.max(0, assets.terrain.naturalWidth - viewport.width));
    const sy = clamp(camera.y, 0, Math.max(0, assets.terrain.naturalHeight - viewport.height));
    const sw = Math.min(viewport.width, assets.terrain.naturalWidth - sx);
    const sh = Math.min(viewport.height, assets.terrain.naturalHeight - sy);
    ctx.drawImage(assets.terrain, sx, sy, sw, sh, sx - camera.x, sy - camera.y, sw, sh);
  }

  drawEnvironmentObject(item, satelliteActive) {
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
    if (item.kind === "satellite" && satelliteActive) this.drawSatelliteActivePulse(item);
    this.ctx.restore();
  }

  drawSatelliteActivePulse(item) {
    const pulse = .5 + .5 * Math.sin(performance.now() / 180);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = .25 + pulse * .3;
    ctx.strokeStyle = "#5ff7ff";
    ctx.shadowColor = "#42eaff";
    ctx.shadowBlur = 12;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(item.width * .035, -item.height * .18, item.width * (.08 + pulse * .018), item.height * (.025 + pulse * .008), -.15, 0, Math.PI * 2);
    ctx.stroke();
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
    const tier = Number.isFinite(player.weaponTier) ? player.weaponTier : 1;
    const previousTier = this.weaponTierByPlayer.get(player.id);
    if (previousTier === undefined) this.weaponTierByPlayer.set(player.id, tier);
    else if (previousTier !== tier) {
      this.weaponTierByPlayer.set(player.id, tier);
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
      ctx.save(); ctx.strokeStyle = "rgba(120,241,255,.86)"; ctx.lineWidth = 2; ctx.shadowColor = "#72efff"; ctx.shadowBlur = 10;
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
      ctx.save();
      const plasma = projectile.tier === 6;
      const colors = ["#d8ff8a", "#fff0a4", "#98f8ff", "#ffb1f0", "#ffc977", "#c89cff"];
      if (plasma) {
        const speed = Math.max(.001, Math.hypot(projectile.vx || 0, projectile.vy || 0));
        const angle = Math.atan2(projectile.vy || 0, projectile.vx || 1);
        const pulse = .92 + Math.sin(performance.now() / 42 + projectile.id) * .08;
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.globalCompositeOperation = "screen";
        ctx.lineCap = "round";
        ctx.shadowColor = "#9a4dff";
        ctx.shadowBlur = 28;
        ctx.strokeStyle = "rgba(113,50,255,.48)";
        ctx.lineWidth = 15 * pulse;
        ctx.beginPath(); ctx.moveTo(-48, 0); ctx.lineTo(11, 0); ctx.stroke();
        const beam = ctx.createLinearGradient(-50, 0, 13, 0);
        beam.addColorStop(0, "rgba(62,26,170,0)");
        beam.addColorStop(.24, "rgba(137,74,255,.76)");
        beam.addColorStop(.76, "rgba(108,240,255,.98)");
        beam.addColorStop(1, "#ffffff");
        ctx.shadowBlur = 18;
        ctx.strokeStyle = beam;
        ctx.lineWidth = 7 * pulse;
        ctx.beginPath(); ctx.moveTo(-52, 0); ctx.lineTo(12, 0); ctx.stroke();
        ctx.shadowColor = "#dfffff";
        ctx.shadowBlur = 10;
        ctx.strokeStyle = "rgba(247,255,255,.96)";
        ctx.lineWidth = 2.3;
        ctx.beginPath(); ctx.moveTo(-32, 0); ctx.lineTo(14, 0); ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(13, 0, 4.5 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.shadowColor = plasma ? "#9c63ff" : (colors[(projectile.tier || 1) - 1] || "#74f6ff");
      ctx.shadowBlur = plasma ? 19 : 11;
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
      projectiles.push({
        ...projectile,
        x: projectile.startX + projectile.vx * age / 1000,
        y: projectile.startY + projectile.vy * age / 1000,
        trailStartX: projectile.previousX,
        trailStartY: projectile.previousY,
      });
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
    this.effects = this.effects.filter((effect) => now - effect.born < effect.life);
    for (const effect of this.effects) {
      const muzzleEffect = effect.type === "weapon-muzzle" || effect.type === "muzzle";
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
        this.ctx.globalCompositeOperation = "screen";
        this.ctx.fillStyle = plasma ? "#f7efff" : "#eaffff";
        this.ctx.shadowColor = visual.accent;
        this.ctx.shadowBlur = plasma ? 26 : 8;
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
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = timeline.plasmaAlpha * .58;
    const haze = ctx.createRadialGradient(x, y, bloomRadius * .02, x, y, bloomRadius);
    haze.addColorStop(0, "rgba(255,255,255,.95)");
    haze.addColorStop(.12, "rgba(90,239,255,.82)");
    haze.addColorStop(.42, "rgba(111,58,255,.62)");
    haze.addColorStop(.73, "rgba(232,49,255,.34)");
    haze.addColorStop(1, "rgba(70,28,170,0)");
    ctx.fillStyle = haze;
    ctx.beginPath(); ctx.arc(x, y, bloomRadius, 0, Math.PI * 2); ctx.fill();

    const lobeColors = [
      ["rgba(77,234,255,.68)", "rgba(62,75,255,0)"],
      ["rgba(171,67,255,.67)", "rgba(100,32,211,0)"],
      ["rgba(255,70,225,.55)", "rgba(175,25,181,0)"],
    ];
    for (const lobe of effect.lobes) {
      const orbit = bloomRadius * lobe.orbit;
      const lobeRadius = bloomRadius * lobe.radius;
      const wobble = Math.sin(timeline.elapsed / 115 + lobe.angle * 4) * bloomRadius * .018;
      const lx = x + Math.cos(lobe.angle) * (orbit + wobble);
      const ly = y + Math.sin(lobe.angle) * (orbit + wobble) * lobe.squash;
      const gradient = ctx.createRadialGradient(lx, ly, 0, lx, ly, lobeRadius);
      gradient.addColorStop(0, lobeColors[lobe.colorIndex][0]);
      gradient.addColorStop(1, lobeColors[lobe.colorIndex][1]);
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.arc(lx, ly, lobeRadius, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawNukeForeground(effect, now) {
    const ctx = this.ctx;
    const timeline = nukeTimeline(now - effect.born);
    const x = effect.x - this.camera.x, y = effect.y - this.camera.y;
    ctx.globalCompositeOperation = "lighter";

    if (timeline.ignitionAlpha > .001 || timeline.coreAlpha > .001) {
      const ignitionRadius = mix(8, Math.min(92, effect.radius * .14), timeline.ignitionProgress);
      const coreRadius = mix(ignitionRadius, effect.radius * .31, timeline.coreProgress);
      ctx.globalAlpha = Math.max(timeline.ignitionAlpha, timeline.coreAlpha * .86);
      const core = ctx.createRadialGradient(x, y, 0, x, y, coreRadius);
      core.addColorStop(0, "rgba(255,255,255,1)");
      core.addColorStop(.08, "rgba(255,248,219,.98)");
      core.addColorStop(.2, "rgba(121,250,255,.94)");
      core.addColorStop(.52, "rgba(90,88,255,.62)");
      core.addColorStop(.76, "rgba(236,62,255,.36)");
      core.addColorStop(1, "rgba(115,25,214,0)");
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(x, y, coreRadius, 0, Math.PI * 2); ctx.fill();

      ctx.globalAlpha = timeline.ignitionAlpha;
      ctx.strokeStyle = "#ffffff";
      ctx.shadowColor = "#56f4ff"; ctx.shadowBlur = 12;
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
      ctx.shadowColor = "#35ddff"; ctx.shadowBlur = mix(15, 5, timeline.shockwaveProgress);
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
      ctx.shadowColor = "#9b54ff"; ctx.shadowBlur = 8;
      ctx.lineWidth = mix(9, 1.5, timeline.secondaryProgress);
      ctx.beginPath(); ctx.arc(x, y, effect.radius * timeline.secondaryProgress, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    for (const shard of effect.shards) {
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

    for (const particle of effect.particles) {
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
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = fade;
    ctx.fillStyle = "rgba(255,255,255,.78)";
    ctx.shadowColor = "#60f4ff"; ctx.shadowBlur = 20;
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
    ctx.shadowColor = "#6d3940"; ctx.shadowBlur = 8;
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
    for (const particle of effect.particles || []) {
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
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = fade;
    const core = ctx.createRadialGradient(x, y, 0, x, y, (18 + amount * 46) * scale);
    core.addColorStop(0, "rgba(255,255,255,.98)");
    core.addColorStop(.22, "rgba(126,247,255,.92)");
    core.addColorStop(.56, "rgba(218,88,255,.62)");
    core.addColorStop(1, "rgba(255,92,68,0)");
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(x, y, (18 + amount * 46) * scale, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,240,166,${fade})`;
    ctx.shadowColor = "#ff7eef"; ctx.shadowBlur = 24;
    ctx.lineWidth = (6 - amount * 4) * scale;
    ctx.beginPath(); ctx.arc(x, y, (8 + amount * 74) * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = `rgba(103,237,255,${fade * .75})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, (22 + amount * 102) * scale, 0, Math.PI * 2); ctx.stroke();
    for (const particle of effect.particles || []) {
      const px = x + particle.vx * age;
      const py = y + particle.vy * age + 75 * age * age;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(px, py); ctx.rotate(particle.spin * age);
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color; ctx.shadowBlur = 12;
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
    ctx.globalCompositeOperation = "screen";
    const column = ctx.createLinearGradient(x, y - 150, x, y + 34);
    column.addColorStop(0, "rgba(116,239,255,0)");
    column.addColorStop(.5, `rgba(130,246,255,${.18 * fade})`);
    column.addColorStop(1, "rgba(185,255,132,0)");
    ctx.fillStyle = column;
    ctx.fillRect(x - 30 * fade, y - 150, 60 * fade, 184);
    ctx.shadowColor = "#8efbff"; ctx.shadowBlur = 20;
    for (let ring = 0; ring < 3; ring++) {
      const phase = clamp(amount * 1.35 - ring * .1, 0, 1);
      ctx.globalAlpha = (1 - phase) * .9;
      ctx.strokeStyle = ring === 1 ? "#b9ff79" : "#91f5ff";
      ctx.lineWidth = 3 - ring * .5;
      ctx.beginPath();
      ctx.ellipse(x, y + 13 - arrive * 10, 14 + phase * (52 + ring * 8), 4 + phase * 15, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const particle of effect.particles || []) {
      const px = x + particle.vx * age * .55;
      const py = y + 12 + particle.vy * age - 85 * age;
      ctx.globalAlpha = fade;
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color; ctx.shadowBlur = 10;
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
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 14 - lift * .22, 5 - lift * .055, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = .34 + Math.sin(phase * .72) * .08;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
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
      ctx.shadowBlur = 10 + Math.sin(phase * .72) * 2;
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
    ctx.shadowBlur = 12;
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
    ctx.shadowBlur = 6;
    ctx.fillRect(boxX, boxY, width, 15);
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
    ctx.strokeStyle = color;
    ctx.globalAlpha = .82;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX + .5, boxY + .5, width - 1, 14);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 4;
    ctx.fillStyle = "#fff";
    ctx.fillText(label, labelX, boxY + 7.8);
    ctx.restore();
  }

  drawFartClouds(clouds) {
    const ctx = this.ctx;
    const now = Date.now();
    for (const cloud of clouds) {
      const x = cloud.x - this.camera.x, y = cloud.y - this.camera.y;
      if (x + cloud.radius < -20 || x - cloud.radius > this.viewport.width + 20 || y + cloud.radius < -20 || y - cloud.radius > this.viewport.height + 20) continue;
      const age = Math.max(0, now - cloud.createdAt);
      const remaining = Math.max(0, cloud.expiresAt - now);
      const visibility = Math.min(1, age / 260, remaining / 650);
      const pulse = 1 + Math.sin(performance.now() / 310 + cloud.id) * .025;
      const radius = cloud.radius * fartCloudGrowth(cloud.createdAt, now, cloud.growMs) * pulse;
      ctx.save();
      ctx.globalAlpha = visibility;
      const base = ctx.createRadialGradient(x, y, radius * .05, x, y, radius);
      base.addColorStop(0, "rgba(189,219,50,.94)");
      base.addColorStop(.36, "rgba(126,160,38,.9)");
      base.addColorStop(.7, "rgba(75,104,36,.72)");
      base.addColorStop(1, "rgba(45,68,34,0)");
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();

      // Slow, overlapping lobes create a dense smoke-grenade silhouette. The
      // deterministic phase keeps every client visually consistent.
      for (let index = 0; index < 10; index++) {
        const seed = cloud.id * 17 + index * 5.31;
        const angle = index * Math.PI * .2 + seededUnit(seed) * .7 + performance.now() / (5200 + index * 130);
        const orbit = radius * mix(.12, .5, seededUnit(seed + 3));
        const puffRadius = radius * mix(.22, .39, seededUnit(seed + 7)) * (1 + Math.sin(performance.now() / 420 + index) * .045);
        const px = x + Math.cos(angle) * orbit;
        const py = y + Math.sin(angle) * orbit * .58 - Math.sin(performance.now() / 900 + index) * 7;
        const puff = ctx.createRadialGradient(px, py, 0, px, py, puffRadius);
        puff.addColorStop(0, index % 3 === 0 ? "rgba(215,236,61,.7)" : "rgba(111,145,39,.72)");
        puff.addColorStop(.56, index % 2 ? "rgba(77,107,36,.62)" : "rgba(126,151,40,.58)");
        puff.addColorStop(1, "rgba(42,61,31,0)");
        ctx.fillStyle = puff;
        ctx.beginPath(); ctx.arc(px, py, puffRadius, 0, Math.PI * 2); ctx.fill();
      }

      ctx.globalAlpha = visibility * .26;
      ctx.strokeStyle = "#dfff57";
      ctx.lineWidth = Math.max(2, radius * .009);
      ctx.setLineDash([radius * .055, radius * .035]);
      ctx.lineDashOffset = -performance.now() / 24;
      ctx.beginPath(); ctx.arc(x, y, radius * .61, 0, Math.PI * 2); ctx.stroke();
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

    ctx.globalAlpha = .44;
    ctx.drawImage(this.assets.terrain, 0, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(19,5,30,.32)";
    ctx.fillRect(0, 0, width, height);
    for (const item of this.assets.environment) {
      ctx.beginPath();
      item.polygon.forEach((point, index) => {
        const x = point.x * scaleX;
        const y = point.y * scaleY;
        if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = item.kind === "satellite" ? "rgba(74,239,255,.78)" : "rgba(229,137,255,.6)";
      ctx.fill();
      ctx.strokeStyle = item.kind === "satellite" ? "rgba(184,252,255,.92)" : "rgba(255,213,255,.62)";
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
