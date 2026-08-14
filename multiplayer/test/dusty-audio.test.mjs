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
  assert.equal(urls.length, 16);
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
  for (const type of ["fart", "health", "mole", "shield", "speed", "spy", "teleport"]) audio.powerupCollected(type);
  audio.teleport(); audio.death(); audio.nuke();
  assert.deepEqual(FakeAudio.played, [
    ...Object.values(DUSTY_AUDIO_FILES.powerups),
    DUSTY_AUDIO_FILES.teleport,
    DUSTY_AUDIO_FILES.death,
    DUSTY_AUDIO_FILES.nuke,
  ]);
});

test("all game audio has a 30% ceiling and fades smoothly beyond the visible screen", () => {
  const view = { x: 0, y: 0, width: 1000, height: 600 };
  const world = { width: 3200, height: 2000 };
  const inside = spatialSoundVolume({ x: 500, y: 300 }, view, world);
  const justOutside = spatialSoundVolume({ x: 1001, y: 300 }, view, world);
  const farther = spatialSoundVolume({ x: 2000, y: 1000 }, view, world);
  const oppositeCorner = spatialSoundVolume({ x: 3200, y: 2000 }, view, world);
  assert.equal(inside, .7);
  assert.ok(Math.abs(justOutside - DUSTY_AUDIO_MAX_VOLUME * .85) < .002);
  assert.ok(farther < justOutside && farther > oppositeCorner);
  assert.ok(Math.abs(oppositeCorner - DUSTY_AUDIO_MIN_VOLUME) < 1e-9);

  const audio = fresh({ getView: () => view, world });
  audio.weaponFired({ playerId: "near", groupKey: "shot:near", tier: 1, x: 500, y: 300 });
  audio.death({ x: 3200, y: 2000 });
  assert.equal(FakeAudio.volumes[0], DUSTY_AUDIO_MAX_VOLUME);
  assert.ok(Math.abs(FakeAudio.volumes[1] - DUSTY_AUDIO_MIN_VOLUME) < 1e-9);
});
