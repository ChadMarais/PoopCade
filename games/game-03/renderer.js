function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export class DustyOrbitMultiplayerRenderer {
  constructor(canvas, assets, debug = false) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.assets = assets;
    this.debug = debug;
    this.camera = { x: 0, y: 0 };
    this.viewport = { width: 1, height: 1, dpr: 1 };
    this.playerScreen = { x: 0, y: 0 };
    this.effects = [];
    this.localProjectiles = new Map();
    this.hitUntil = new Map();
    this.minimapSurfaces = new Map();
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
    this.viewport = { width, height, dpr };
  }

  impact(event) {
    if (Number.isSafeInteger(event.projectileId)) this.localProjectiles.delete(event.projectileId);
    this.effects.push({ x: event.x, y: event.y, born: performance.now(), life: 280 });
  }

  confirmLocalShot(event, playerPosition) {
    const projectile = event?.projectile;
    if (!projectile || !Number.isSafeInteger(projectile.id) ||
        !Number.isFinite(projectile.vx) || !Number.isFinite(projectile.vy)) return;
    const speed = Math.hypot(projectile.vx, projectile.vy);
    if (speed < .001) return;
    const directionX = projectile.vx / speed;
    const directionY = projectile.vy / speed;
    const hasPredictedOrigin = Number.isFinite(playerPosition?.x) && Number.isFinite(playerPosition?.y);
    const x = hasPredictedOrigin ? playerPosition.x + directionX * 36 : projectile.x;
    const y = hasPredictedOrigin ? playerPosition.y + directionY * 36 : projectile.y;
    const born = performance.now();
    const life = clamp((projectile.expiresAt || 0) - (projectile.spawnedAt || 0), 100, 3000);
    this.localProjectiles.set(projectile.id, {
      ...projectile, startX: x, startY: y, born, life,
    });
    this.effects.push({ type: "muzzle", x, y, born, life: 120 });
  }

  playerHit(id) { this.hitUntil.set(id, performance.now() + 180); }

  render(snapshot, localId, predicted, delta, inputVisual) {
    const { ctx } = this;
    const { width, height, dpr } = this.viewport;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const local = snapshot?.players?.find((player) => player.id === localId);
    const focus = predicted || local || { x: this.assets.world.width / 2, y: this.assets.world.height / 2 };
    const targetX = clamp(focus.x - width / 2, 0, Math.max(0, this.assets.world.width - width));
    const targetY = clamp(focus.y - height / 2, 0, Math.max(0, this.assets.world.height - height));
    const blend = 1 - Math.exp(-delta * 10);
    this.camera.x += (targetX - this.camera.x) * blend;
    this.camera.y += (targetY - this.camera.y) * blend;
    this.playerScreen = { x: focus.x - this.camera.x, y: focus.y - this.camera.y };

    ctx.fillStyle = "#371447";
    ctx.fillRect(0, 0, width, height);
    this.drawTerrain();

    const players = (snapshot?.players || []).map((player) => player.id === localId && predicted
      ? { ...player, x: predicted.x, y: predicted.y, aimX: inputVisual?.aimX ?? player.aimX, aimY: inputVisual?.aimY ?? player.aimY }
      : player);
    const layers = [
      ...this.assets.rocks.map((rock) => ({ type: "rock", depth: rock.depthY, value: rock })),
      ...players.map((player) => ({ type: "player", depth: player.y, value: player })),
    ].sort((a, b) => a.depth - b.depth);
    for (const layer of layers) {
      if (layer.type === "rock") this.drawRock(layer.value);
      else this.drawPlayer(layer.value, layer.value.id === localId);
    }
    this.drawProjectiles(snapshot?.projectiles || []);
    this.drawLocalProjectiles();
    this.drawEffects();
    if (this.debug) this.drawCollision(players);
    this.drawMinimap(players.find((player) => player.id === localId));
  }

  drawTerrain() {
    const { ctx, camera, viewport, assets } = this;
    const sx = clamp(camera.x, 0, Math.max(0, assets.terrain.naturalWidth - viewport.width));
    const sy = clamp(camera.y, 0, Math.max(0, assets.terrain.naturalHeight - viewport.height));
    const sw = Math.min(viewport.width, assets.terrain.naturalWidth - sx);
    const sh = Math.min(viewport.height, assets.terrain.naturalHeight - sy);
    ctx.drawImage(assets.terrain, sx, sy, sw, sh, sx - camera.x, sy - camera.y, sw, sh);
  }

  drawRock(rock) {
    const x = rock.x - this.camera.x;
    const y = rock.y - this.camera.y;
    if (x + rock.width / 2 < -20 || x - rock.width / 2 > this.viewport.width + 20 || y + rock.height / 2 < -20 || y - rock.height / 2 > this.viewport.height + 20) return;
    this.ctx.drawImage(this.assets.rock, x - rock.width / 2, y - rock.height / 2, rock.width, rock.height);
  }

  drawPlayer(player, local) {
    if (!player.alive) return;
    const now = performance.now();
    const { definition, body, shadow } = this.assets.character;
    const x = player.x - this.camera.x;
    const y = player.y - this.camera.y;
    const moving = Math.hypot(player.vx || 0, player.vy || 0) > 10;
    const hover = definition.hover;
    const bob = Math.sin(now / 1000 * Math.PI * 2 * (moving ? hover.movingRateHz : hover.idleRateHz)) * (moving ? hover.movingAmplitude : hover.idleAmplitude) - (moving ? hover.movementOffset : 0);
    const shadowBounds = definition.shadowSourceBounds;
    const shadowSize = definition.shadowDrawSize;
    const shadowOffset = definition.shadowOffset;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = player.protectedUntil > Date.now() ? 0.64 + Math.sin(now / 70) * 0.2 : 1;
    ctx.drawImage(shadow, shadowBounds.x, shadowBounds.y, shadowBounds.width, shadowBounds.height,
      x + shadowOffset.x - shadowSize.width * definition.shadowPivot.x,
      y + shadowOffset.y - shadowSize.height * definition.shadowPivot.y,
      shadowSize.width, shadowSize.height);
    ctx.translate(x, y + bob);
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

    ctx.save();
    ctx.fillStyle = "rgba(17,6,28,.9)";
    ctx.fillRect(x - 38, y - 66, 76, 15);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "800 9px system-ui";
    ctx.fillText(player.name, x, y - 55);
    this.drawHealthBar(x, y - 48, player.hp, local ? "#a6ff65" : (player.color || "#ff6cca"));
    ctx.restore();
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
      ctx.shadowColor = "#74f6ff";
      ctx.shadowBlur = 11;
      ctx.fillStyle = "#e9ffff";
      ctx.beginPath(); ctx.arc(x, y, projectile.radius || 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  drawLocalProjectiles() {
    const now = performance.now();
    const projectiles = [];
    for (const [id, projectile] of this.localProjectiles) {
      const age = now - projectile.born;
      if (age >= projectile.life) {
        this.localProjectiles.delete(id);
        continue;
      }
      projectiles.push({
        ...projectile,
        x: projectile.startX + projectile.vx * age / 1000,
        y: projectile.startY + projectile.vy * age / 1000,
      });
    }
    this.drawProjectiles(projectiles);
  }

  drawEffects() {
    const now = performance.now();
    this.effects = this.effects.filter((effect) => now - effect.born < effect.life);
    for (const effect of this.effects) {
      const amount = (now - effect.born) / effect.life;
      this.ctx.save();
      this.ctx.globalAlpha = 1 - amount;
      if (effect.type === "muzzle") {
        this.ctx.fillStyle = "#eaffff";
        this.ctx.shadowColor = "#6ff7ff";
        this.ctx.shadowBlur = 16;
        this.ctx.beginPath();
        this.ctx.arc(effect.x - this.camera.x, effect.y - this.camera.y, 7 - amount * 3, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
        continue;
      }
      this.ctx.strokeStyle = "#91fbff";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath(); this.ctx.arc(effect.x - this.camera.x, effect.y - this.camera.y, 4 + amount * 16, 0, Math.PI * 2); this.ctx.stroke();
      this.ctx.restore();
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
    ctx.strokeStyle = "rgba(157,255,88,.95)";
    for (const player of players) { if (!player.alive) continue; ctx.beginPath(); ctx.arc(player.x - this.camera.x, player.y - this.camera.y, 17, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }

  drawMinimap(localPlayer) {
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
    ctx.fillText("MINIMAP · YOU ONLY", left, top - 9);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.drawImage(surface, left, top, width, height);
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
    for (const rock of this.assets.rocks) {
      ctx.beginPath();
      rock.polygon.forEach((point, index) => {
        const x = point.x * scaleX;
        const y = point.y * scaleY;
        if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(229,137,255,.6)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,213,255,.62)";
      ctx.lineWidth = .75;
      ctx.stroke();
    }
    this.minimapSurfaces.set(key, surface);
    return surface;
  }

  getDebugState() { return { camera: { ...this.camera }, playerScreen: { ...this.playerScreen }, viewport: { ...this.viewport } }; }
}
