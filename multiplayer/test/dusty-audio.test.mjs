import test from "node:test";
import assert from "node:assert/strict";
import { DUSTY_AUDIO_FILES, DustyOrbitAudio } from "../../games/game-03/audio.js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

class FakeAudio {
  static played = [];
  constructor(src) { this.src = src; this.currentTime = 0; }
  load() {}
  cloneNode() { return new FakeAudio(this.src); }
  addEventListener() {}
  play() { FakeAudio.played.push(this.src); return Promise.resolve(); }
}

function fresh() {
  FakeAudio.played = [];
  return new DustyOrbitAudio({ AudioCtor: FakeAudio });
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
