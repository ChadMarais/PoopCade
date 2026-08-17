const AUDIO_ASSET_VERSION = "20260817-4";
const WEAPON_VOICE_LIMIT = 5;
const EFFECT_VOICE_LIMIT = 2;
export const DUSTY_AUDIO_MAX_VOLUME = .35;
export const DUSTY_AUDIO_MIN_VOLUME = 0;
export const RANDOM_WEAPON_VOLUME_SCALE = .5;
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
    [
      ...Array.from({ length: 6 }, (_, index) => [index + 1, audioUrl(`weapon-${index + 1}.mp3`)]),
      [7, audioUrl("weapon-random.mp3")],
    ],
  )),
  randomWeapons: Object.freeze({
    DUD: audioUrl("weapon-random-dud.mp3"),
    AVERAGE: audioUrl("weapon-random.mp3"),
    LEGENDARY: audioUrl("weapon-random-legendary.mp3"),
  }),
});
const WEAPON_AUDIO_URLS = new Set([
  ...Object.values(DUSTY_AUDIO_FILES.weapons),
  ...Object.values(DUSTY_AUDIO_FILES.randomWeapons),
]);

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
  constructor({
    AudioCtor = globalThis.Audio,
    AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext,
    fetchFn = globalThis.fetch,
    getListener = () => null,
    world = null,
  } = {}) {
    this.AudioCtor = AudioCtor;
    this.fetchFn = fetchFn;
    this.getListener = getListener;
    this.world = world;
    this.templates = new Map();
    this.voicePools = new Map();
    this.activeVoices = new Set();
    this.activeSources = new Set();
    this.buffers = new Map();
    this.bufferLoads = [];
    this.audioContext = null;
    this.playedShotGroups = new Set();
    this.shotGroupOrder = [];
    if (typeof AudioContextCtor === "function") {
      try { this.audioContext = new AudioContextCtor(); } catch { this.audioContext = null; }
    }
    if (typeof AudioCtor !== "function") return;
    const urls = [
      DUSTY_AUDIO_FILES.nuke,
      DUSTY_AUDIO_FILES.death,
      DUSTY_AUDIO_FILES.teleport,
      ...Object.values(DUSTY_AUDIO_FILES.powerups),
      ...WEAPON_AUDIO_URLS,
    ];
    for (const url of urls) {
      const template = new AudioCtor(url);
      template.preload = "auto";
      template.load?.();
      this.templates.set(url, template);
      if (this.audioContext && typeof fetchFn === "function") {
        this.bufferLoads.push(Promise.resolve(fetchFn(url))
          .then((response) => {
            if (!response?.ok) throw new Error(`Audio request failed: ${response?.status || "unknown"}`);
            return response.arrayBuffer();
          })
          .then((bytes) => this.audioContext.decodeAudioData(bytes))
          .then((buffer) => this.buffers.set(url, buffer))
          .catch(() => null));
      }
    }
  }

  ready() { return Promise.allSettled(this.bufferLoads); }

  unlock() {
    const context = this.audioContext;
    if (!context || context.state === "running" || typeof context.resume !== "function") return Promise.resolve(Boolean(context));
    return Promise.resolve(context.resume()).then(() => context.state === "running").catch(() => false);
  }

  play(url, source = null, volumeScale = 1) {
    const template = this.templates.get(url);
    if (!template) return false;
    const safeVolumeScale = Number.isFinite(volumeScale) ? Math.max(0, Math.min(1, volumeScale)) : 1;
    const volume = spatialSoundVolume(source, this.getListener?.(), this.world) * safeVolumeScale;
    const context = this.audioContext;
    const buffer = this.buffers.get(url);
    if (context && buffer) {
      try {
        void this.unlock();
        const sourceNode = context.createBufferSource();
        const gainNode = context.createGain();
        sourceNode.buffer = buffer;
        gainNode.gain.value = volume;
        sourceNode.connect(gainNode);
        gainNode.connect(context.destination);
        this.activeSources.add(sourceNode);
        sourceNode.onended = () => {
          this.activeSources.delete(sourceNode);
          sourceNode.disconnect?.();
          gainNode.disconnect?.();
        };
        sourceNode.start(0);
        return true;
      } catch {
        // Fall through to the media-element compatibility path.
      }
    }
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
    voice.volume = volume;
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

  weaponFired({ playerId, groupKey, tier, rarity, x, y } = {}) {
    const weaponTier = Math.max(1, Math.min(7, Math.trunc(Number(tier) || 1)));
    const key = `${String(playerId || "unknown")}:${String(groupKey || "ungrouped")}`;
    if (this.playedShotGroups.has(key)) return false;
    this.playedShotGroups.add(key);
    this.shotGroupOrder.push(key);
    while (this.shotGroupOrder.length > 512) this.playedShotGroups.delete(this.shotGroupOrder.shift());
    const volumeScale = weaponTier === 7 ? RANDOM_WEAPON_VOLUME_SCALE : 1;
    const randomRarity = String(rarity || "AVERAGE").toUpperCase();
    const url = weaponTier === 7
      ? DUSTY_AUDIO_FILES.randomWeapons[randomRarity] || DUSTY_AUDIO_FILES.randomWeapons.AVERAGE
      : DUSTY_AUDIO_FILES.weapons[weaponTier];
    return this.play(url, { x, y }, volumeScale);
  }

  powerupCollected(type, source = null) {
    const url = DUSTY_AUDIO_FILES.powerups[String(type || "")];
    return url ? this.play(url, source) : false;
  }

  teleport(source) { return this.play(DUSTY_AUDIO_FILES.teleport, source); }
  death(source) { return this.play(DUSTY_AUDIO_FILES.death, source); }
  nuke(source) { return this.play(DUSTY_AUDIO_FILES.nuke, source); }
}
