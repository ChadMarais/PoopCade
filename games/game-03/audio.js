const AUDIO_ASSET_VERSION = "20260814-3";
export const DUSTY_AUDIO_MAX_VOLUME = .7;
export const DUSTY_AUDIO_MIN_VOLUME = .035;
const audioUrl = (file) => {
  const url = new URL(`./assets/audio/${file}`, import.meta.url);
  url.searchParams.set("v", AUDIO_ASSET_VERSION);
  return url.href;
};

export const DUSTY_AUDIO_FILES = Object.freeze({
  nuke: audioUrl("nuke.mp3"),
  death: audioUrl("player-death.mp3"),
  teleport: audioUrl("teleport.mp3"),
  powerups: Object.freeze({
    fart: audioUrl("powerup-fart-cloud.mp3"),
    health: audioUrl("powerup-health.mp3"),
    mole: audioUrl("powerup-mole-mode.mp3"),
    shield: audioUrl("powerup-shield.mp3"),
    speed: audioUrl("powerup-speed.mp3"),
    spy: audioUrl("powerup-spy-plane.mp3"),
    teleport: audioUrl("powerup-teleport.mp3"),
  }),
  weapons: Object.freeze(Object.fromEntries(
    Array.from({ length: 6 }, (_, index) => [index + 1, audioUrl(`weapon-${index + 1}.mp3`)]),
  )),
});

function finitePoint(value) {
  return Boolean(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function distanceOutsideView(point, view) {
  const left = view.x, top = view.y, right = left + view.width, bottom = top + view.height;
  const dx = point.x < left ? left - point.x : point.x > right ? point.x - right : 0;
  const dy = point.y < top ? top - point.y : point.y > bottom ? point.y - bottom : 0;
  return Math.hypot(dx, dy);
}

export function spatialSoundVolume(source, view, world) {
  if (!finitePoint(source) || !finitePoint(view) || !Number.isFinite(view.width) || !Number.isFinite(view.height) ||
      !Number.isFinite(world?.width) || !Number.isFinite(world?.height)) return DUSTY_AUDIO_MAX_VOLUME;
  const distance = distanceOutsideView(source, view);
  if (distance <= 0) return DUSTY_AUDIO_MAX_VOLUME;

  // Immediately beyond the camera edge the sound is 15% quieter. Continue
  // fading through a near-screen band before falling smoothly to a faint
  // floor at the most distant point in the arena.
  const justOutsideVolume = DUSTY_AUDIO_MAX_VOLUME * .85;
  const nearBand = Math.max(120, Math.min(view.width, view.height) * .25);
  if (distance <= nearBand) return justOutsideVolume * (1 - .2 * distance / nearBand);

  const corners = [{ x: 0, y: 0 }, { x: world.width, y: 0 }, { x: 0, y: world.height }, { x: world.width, y: world.height }];
  const maximumDistance = Math.max(nearBand + 1, ...corners.map((corner) => distanceOutsideView(corner, view)));
  const progress = Math.max(0, Math.min(1, (distance - nearBand) / (maximumDistance - nearBand)));
  const eased = Math.pow(progress, .72);
  return justOutsideVolume * .8 + (DUSTY_AUDIO_MIN_VOLUME - justOutsideVolume * .8) * eased;
}

export class DustyOrbitAudio {
  constructor({ AudioCtor = globalThis.Audio, getView = () => null, world = null } = {}) {
    this.AudioCtor = AudioCtor;
    this.getView = getView;
    this.world = world;
    this.templates = new Map();
    this.activeVoices = new Set();
    this.playedShotGroups = new Set();
    this.shotGroupOrder = [];
    if (typeof AudioCtor !== "function") return;
    const urls = [
      DUSTY_AUDIO_FILES.nuke,
      DUSTY_AUDIO_FILES.death,
      DUSTY_AUDIO_FILES.teleport,
      ...Object.values(DUSTY_AUDIO_FILES.powerups),
      ...Object.values(DUSTY_AUDIO_FILES.weapons),
    ];
    for (const url of urls) {
      const template = new AudioCtor(url);
      template.preload = "auto";
      template.load?.();
      this.templates.set(url, template);
    }
  }

  play(url, source = null) {
    const template = this.templates.get(url);
    if (!template) return false;
    const voice = typeof template.cloneNode === "function" ? template.cloneNode(true) : new this.AudioCtor(url);
    voice.preload = "auto";
    voice.currentTime = 0;
    voice.volume = spatialSoundVolume(source, this.getView?.(), this.world);
    this.activeVoices.add(voice);
    const release = () => this.activeVoices.delete(voice);
    voice.addEventListener?.("ended", release, { once: true });
    voice.addEventListener?.("error", release, { once: true });
    try {
      const playback = voice.play();
      playback?.catch?.(release);
    } catch {
      release();
      return false;
    }
    return true;
  }

  weaponFired({ playerId, groupKey, tier, x, y } = {}) {
    const weaponTier = Math.max(1, Math.min(6, Math.trunc(Number(tier) || 1)));
    const key = `${String(playerId || "unknown")}:${String(groupKey || "ungrouped")}`;
    if (this.playedShotGroups.has(key)) return false;
    this.playedShotGroups.add(key);
    this.shotGroupOrder.push(key);
    while (this.shotGroupOrder.length > 512) this.playedShotGroups.delete(this.shotGroupOrder.shift());
    return this.play(DUSTY_AUDIO_FILES.weapons[weaponTier], { x, y });
  }

  powerupCollected(type, source = null) {
    const url = DUSTY_AUDIO_FILES.powerups[String(type || "")];
    return url ? this.play(url, source) : false;
  }

  teleport(source) { return this.play(DUSTY_AUDIO_FILES.teleport, source); }
  death(source) { return this.play(DUSTY_AUDIO_FILES.death, source); }
  nuke(source) { return this.play(DUSTY_AUDIO_FILES.nuke, source); }
}
