import test from "node:test";
import assert from "node:assert/strict";
import { DUSTY_AUDIO_FILES, DUSTY_AUDIO_MAX_VOLUME, DUSTY_AUDIO_MIN_VOLUME, DustyOrbitAudio, spatialSoundVolume } from "../../games/game-03/audio.js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

class FakeAudio {
  static played = [];
  static volumes = [];
  constructor(src) { this.src = src; this.currentTime = 0; this.volume = 1; }
  load() {}
  cloneNode() { return new FakeAudio(this.src); }
  addEventListener() {}
  play() { FakeAudio.played.push(this.src); FakeAudio.volumes.push(this.volume); return Promise.resolve(); }
}

function fresh(options = {}) {
  FakeAudio.played = [];
  FakeAudio.volumes = [];
  return new DustyOrbitAudio({ AudioCtor: FakeAudio, ...options });
}

test("all supplied production audio files are packaged with the game", () => {
  const urls = [DUSTY_AUDIO_FILES.nuke, DUSTY_AUDIO_FILES.death, DUSTY_AUDIO_FILES.teleport,
    ...Object.values(DUSTY_AUDIO_FILES.powerups), ...Object.values(DUSTY_AUDIO_FILES.weapons)];
  assert.equal(urls.length, 15);
  for (const url of urls) {
    const file = new URL(url); file.search = "";
    assert.equal(existsSync(file), true, url);
  }
});

test("every weapon tier uses its supplied production sound", () => {
  const audio = fresh();
  for (let tier = 1; tier <= 6; tier++) audio.weaponFired({ playerId: "pilot", groupKey: `shot:${tier}`, tier });
  assert.deepEqual(FakeAudio.played, Object.values(DUSTY_AUDIO_FILES.weapons));
  assert.deepEqual(FakeAudio.volumes, Array(6).fill(DUSTY_AUDIO_MAX_VOLUME));
});

test("three shotgun pellets sharing one authoritative discharge play one sound", () => {
  const audio = fresh();
  for (let pellet = 0; pellet < 3; pellet++) audio.weaponFired({ playerId: "pilot", groupKey: "shot:99", tier: 5 });
  assert.deepEqual(FakeAudio.played, [DUSTY_AUDIO_FILES.weapons[5]]);
  audio.weaponFired({ playerId: "pilot", groupKey: "shot:100", tier: 5 });
  assert.deepEqual(FakeAudio.played, [DUSTY_AUDIO_FILES.weapons[5], DUSTY_AUDIO_FILES.weapons[5]]);
});

test("weapon audio is emitted from the exact muzzle-materialization path", async () => {
  const renderer = await readFile(new URL("../../games/game-03/renderer.js", import.meta.url), "utf8");
  const materialize = renderer.slice(renderer.indexOf("  materializeShot("), renderer.indexOf("  emitWeaponAudioCue("));
  assert.ok(materialize.indexOf('type: "weapon-muzzle"') < materialize.indexOf("this.emitWeaponAudioCue(event, visualOrigin)"));
});

test("power-ups, teleport, death, and nuke map to their production files", () => {
  const audio = fresh();
  for (const type of ["fart", "health", "mole", "shield", "speed", "spy"]) audio.powerupCollected(type);
  audio.teleport(); audio.death(); audio.nuke();
  assert.deepEqual(FakeAudio.played, [
    ...Object.values(DUSTY_AUDIO_FILES.powerups),
    DUSTY_AUDIO_FILES.teleport,
    DUSTY_AUDIO_FILES.death,
    DUSTY_AUDIO_FILES.nuke,
  ]);
});

test("teleport uses the one supplied power-up sound exactly once", () => {
  const audio = fresh();
  assert.equal(audio.powerupCollected("teleport"), false);
  assert.equal(audio.teleport(), true);
  assert.deepEqual(FakeAudio.played, [DUSTY_AUDIO_FILES.teleport]);
  assert.match(DUSTY_AUDIO_FILES.teleport, /powerup-teleport\.mp3\?v=20260815-1$/);
  assert.equal(existsSync(new URL("../../games/game-03/assets/audio/teleport.mp3", import.meta.url)), false);
});

test("world audio is full nearby, 25% at half-map distance, and silent across the map", () => {
  const listener = { x: 0, y: 1250 };
  const world = { width: 4000, height: 2500 };
  const local = spatialSoundVolume({ x: 0, y: 1250 }, listener, world);
  const adjacent = spatialSoundVolume({ x: 50, y: 1250 }, listener, world);
  const halfMap = spatialSoundVolume({ x: 2000, y: 1250 }, listener, world);
  const farSide = spatialSoundVolume({ x: 4000, y: 1250 }, listener, world);
  assert.equal(local, DUSTY_AUDIO_MAX_VOLUME);
  assert.ok(adjacent > DUSTY_AUDIO_MAX_VOLUME * .97);
  assert.ok(Math.abs(halfMap - DUSTY_AUDIO_MAX_VOLUME * .25) < 1e-9);
  assert.equal(farSide, DUSTY_AUDIO_MIN_VOLUME);

  const audio = fresh({ getListener: () => listener, world });
  const distant = { x: 2000, y: 1250 };
  audio.weaponFired({ playerId: "remote", groupKey: "shot:remote", tier: 1, ...distant });
  audio.powerupCollected("health", distant);
  audio.teleport(distant);
  audio.death(distant);
  audio.nuke(distant);
  assert.deepEqual(FakeAudio.volumes, Array(5).fill(DUSTY_AUDIO_MAX_VOLUME * .25));
});
