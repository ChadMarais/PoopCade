const AUDIO_ASSET_VERSION = "20260815-1";
const WEAPON_VOICE_LIMIT = 5;
const EFFECT_VOICE_LIMIT = 2;
export const DUSTY_AUDIO_MAX_VOLUME = .7;
export const DUSTY_AUDIO_MIN_VOLUME = 0;
const audioUrl = (file) => {
  const url = new URL(`./assets/audio/${file}`, import.meta.url);
  url.searchParams.set("v", AUDIO_ASSET_VERSION);
  return url.href;
};

export const DUSTY_AUDIO_FILES = Object.freeze({
  nuke: audioUrl("nuke.mp3"),
  death: audioUrl("player-death.mp3"),
  teleport: audioUrl("powerup-teleport.mp3"),
  powerups: Object.freeze({
    fart: audioUrl("powerup-fart-cloud.mp3"),
    health: audioUrl("powerup-health.mp3"),
    mole: audioUrl("powerup-mole-mode.mp3"),
    shield: audioUrl("powerup-shield.mp3"),
    speed: audioUrl("powerup-speed.mp3"),
    spy: audioUrl("powerup-spy-plane.mp3"),
  }),
  weapons: Object.freeze(Object.fromEntries(
    Array.from({ length: 6 }, (_, index) => [index + 1, audioUrl(`weapon-${index + 1}.mp3`)]),
  )),
});
const WEAPON_AUDIO_URLS = new Set(Object.values(DUSTY_AUDIO_FILES.weapons));

function finitePoint(value) {
  return Boolean(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

export function spatialSoundVolume(source, listener, world) {
  if (!finitePoint(source) || !finitePoint(listener) ||
      !Number.isFinite(world?.width) || !Number.isFinite(world?.height)) return DUSTY_AUDIO_MAX_VOLUME;
  const audibleDistance = Math.max(1, world.width, world.height);
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y);
  const progress = Math.max(0, Math.min(1, distance / audibleDistance));
  // Inverse-square-style falloff: adjacent action is effectively full volume,
  // half a map away is 25%, and the far side is genuinely silent.
  return DUSTY_AUDIO_MAX_VOLUME * Math.pow(1 - progress, 2);
}

export class DustyOrbitAudio {
  constructor({ AudioCtor = globalThis.Audio, getListener = () => null, world = null } = {}) {
    this.AudioCtor = AudioCtor;
    this.getListener = getListener;
    this.world = world;
    this.templates = new Map();
    this.voicePools = new Map();
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
    const pool = this.voicePools.get(url) || [];
    if (!this.voicePools.has(url)) this.voicePools.set(url, pool);
    const limit = WEAPON_AUDIO_URLS.has(url) ? WEAPON_VOICE_LIMIT : EFFECT_VOICE_LIMIT;
    let entry = pool.find((candidate) => !candidate.busy);
    if (!entry && pool.length < limit) {
      const voice = typeof template.cloneNode === "function" ? template.cloneNode(true) : new this.AudioCtor(url);
      entry = { voice, busy: false, startedAt: 0, token: 0 };
      pool.push(entry);
    }
    // Reclaim the oldest voice instead of allocating media elements forever.
    // Weapon and effect URLs have separate pools, so a power-up can never
    // consume the voices reserved for gunfire.
    if (!entry) entry = pool.reduce((oldest, candidate) => candidate.startedAt < oldest.startedAt ? candidate : oldest);
    const voice = entry.voice;
    if (entry.busy) {
      voice.pause?.();
      this.activeVoices.delete(voice);
    }
    voice.preload = "auto";
    voice.currentTime = 0;
    voice.volume = spatialSoundVolume(source, this.getListener?.(), this.world);
    entry.busy = true;
    entry.startedAt = performance.now();
    const token = ++entry.token;
    this.activeVoices.add(voice);
    const release = () => {
      if (entry.token !== token) return;
      entry.busy = false;
      this.activeVoices.delete(voice);
    };
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
