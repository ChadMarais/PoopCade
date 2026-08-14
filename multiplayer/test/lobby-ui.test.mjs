import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatSessionDuration, initialSkinId } from "../../games/game-03/lobby.js";

test("session timer formats locally from authoritative joinedAt", () => {
  assert.equal(formatSessionDuration(1000, 48000), "00:47");
  assert.equal(formatSessionDuration(1000, 204000), "03:23");
  assert.equal(formatSessionDuration(1000, 3979000), "1:06:18");
});

test("stored skin selection persists when enabled and safely falls back when removed", () => {
  const registry = [
    { id: "first", enabled: true },
    { id: "second", enabled: true },
    { id: "disabled", enabled: false },
  ];
  assert.equal(initialSkinId({ getItem: () => "second" }, registry), "second");
  assert.equal(initialSkinId({ getItem: () => "disabled" }, registry), "first");
  assert.equal(initialSkinId({ getItem: () => "missing" }, registry), "first");
});

test("game header omits the redundant scores link while the gameplay HUD retains score", async () => {
  const html = await readFile(new URL("../../games/game-03/index.html", import.meta.url), "utf8");
  const game = await readFile(new URL("../../games/game-03/game.js", import.meta.url), "utf8");
  const header = html.match(/<header class="panel title">[\s\S]*?<\/header>/)?.[0] || "";
  assert.doesNotMatch(header, /SCORES|leaderboard\/dusty-orbit/);
  assert.match(html, /id="gameplayHud"[^>]*>[\s\S]*?SCORE: 0/);
  assert.match(html, /TOTAL PLAYERS: 0/);
  assert.match(game, /snapshot\?\.totalPlayers/);
  assert.match(html, /\.gameplay-hud[^}]*background:\s*rgba\(18,8,27,\.48\)/);
});

test("lobby visibly separates waiting players from players already in the arena", async () => {
  const html = await readFile(new URL("../../games/game-03/index.html", import.meta.url), "utf8");
  assert.match(html, /data-lobby-waiting-roster/);
  assert.match(html, /data-lobby-player-count/);
  assert.match(html, /WAITING IN LOBBY/);
  assert.match(html, /data-lobby-roster/);
  assert.match(html, /FIGHTING RIGHT NOW/);
});

test("gameplay lobby button is clickable and waits for authoritative leave confirmation", async () => {
  const [html, game, arena] = await Promise.all([
    readFile(new URL("../../games/game-03/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../games/game-03/game.js", import.meta.url), "utf8"),
    readFile(new URL("../src/dusty-arena.ts", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="leaveGame" class="leave-button"/);
  assert.doesNotMatch(html, /id="leaveGame" class="panel leave-button"/);
  assert.match(game, /message\.type === "leave_confirmed"/);
  assert.match(game, /function completeLeaveToLobby\(\)/);
  assert.ok(game.indexOf('network.send({ type: "leave" })') < game.indexOf("highscoreTracker.flush(finalPlayer)"));
  assert.match(arena, /type: "leave_confirmed"/);
});

test("crash kills expose a prominent arcade callout to both involved pilots", async () => {
  const [html, game, arena] = await Promise.all([
    readFile(new URL("../../games/game-03/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../games/game-03/game.js", import.meta.url), "utf8"),
    readFile(new URL("../src/dusty-simulation.ts", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="arcadeCallout" class="arcade-callout"/);
  assert.match(game, /message\.type === "collision_kill"/);
  assert.match(game, /message\.playerIds\.includes\(localId\)/);
  assert.match(arena, /type: "collision_kill"/);
  assert.match(arena, /!player\.moleMode/);
});
