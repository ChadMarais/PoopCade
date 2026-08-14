import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  RECRUITMENT_COOLDOWN_MS,
  RECRUITMENT_HREF,
  normalizedOnlinePlayers,
  recruitmentCooldownRemaining,
  recruitmentMessage,
} from "../../games/game-03/presence.js";

test("recruitment copy is cheeky, safe to render as text, and links to the production lobby", () => {
  assert.equal(RECRUITMENT_COOLDOWN_MS, 60_000);
  assert.equal(RECRUITMENT_HREF, "/games/game-03/");
  assert.match(recruitmentMessage("Player XYZ"), /^Player XYZ is banging on the DUSTY ORBIT airlock/);
  assert.match(recruitmentMessage("Player XYZ"), /recruiting moon rocks\.$/);
});

test("online counts and recruitment cooldowns normalize hostile client values", () => {
  assert.equal(normalizedOnlinePlayers(4.9), 4);
  assert.equal(normalizedOnlinePlayers(-20), 0);
  assert.equal(normalizedOnlinePlayers("nope"), 0);
  assert.equal(recruitmentCooldownRemaining(61_000, 1_000), 60);
  assert.equal(recruitmentCooldownRemaining(900, 1_000), 0);
});

test("production launch links omit devtest and both pages expose live presence UI", async () => {
  const [home, lobby, game] = await Promise.all([
    readFile(new URL("../../index.html", import.meta.url), "utf8"),
    readFile(new URL("../../games/game-03/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../games/game-03/game.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(home, /href="\/games\/game-03\/\?devtest=true"/);
  assert.doesNotMatch(lobby, /\?devtest=true/);
  assert.match(home, /data-dusty-online-value/);
  assert.match(home, /data-dusty-recruitment-toast/);
  assert.match(lobby, /data-online-count/);
  assert.match(lobby, /data-lobby-waiting-roster/);
  assert.match(lobby, /data-recruit-players/);
  assert.match(game, /parameters\.delete\("devtest"\)/);
});
