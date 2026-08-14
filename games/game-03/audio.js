const AUDIO_ASSET_VERSION = "20260814-2";
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

export class DustyOrbitAudio {
  constructor({ AudioCtor = globalThis.Audio } = {}) {
    this.AudioCtor = AudioCtor;
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

  play(url) {
    const template = this.templates.get(url);
    if (!template) return false;
    const voice = typeof template.cloneNode === "function" ? template.cloneNode(true) : new this.AudioCtor(url);
    voice.preload = "auto";
    voice.currentTime = 0;
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

  weaponFired({ playerId, groupKey, tier } = {}) {
    const weaponTier = Math.max(1, Math.min(6, Math.trunc(Number(tier) || 1)));
    const key = `${String(playerId || "unknown")}:${String(groupKey || "ungrouped")}`;
    if (this.playedShotGroups.has(key)) return false;
    this.playedShotGroups.add(key);
    this.shotGroupOrder.push(key);
    while (this.shotGroupOrder.length > 512) this.playedShotGroups.delete(this.shotGroupOrder.shift());
    return this.play(DUSTY_AUDIO_FILES.weapons[weaponTier]);
  }

  powerupCollected(type) {
    const url = DUSTY_AUDIO_FILES.powerups[String(type || "")];
    return url ? this.play(url) : false;
  }

  teleport() { return this.play(DUSTY_AUDIO_FILES.teleport); }
  death() { return this.play(DUSTY_AUDIO_FILES.death); }
  nuke() { return this.play(DUSTY_AUDIO_FILES.nuke); }
}
