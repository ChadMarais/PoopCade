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

test("weapon progression stays on the landing page instead of repeating in the lobby", async () => {
  const [homepage, html, css] = await Promise.all([
    readFile(new URL("../../index.html", import.meta.url), "utf8"),
    readFile(new URL("../../games/game-03/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../games/game-03/lobby.css", import.meta.url), "utf8"),
  ]);
  assert.match(homepage, /START WITH A PATHETIC PEA SHOOTER/);
  assert.doesNotMatch(html, /weapon-rules|YOUR GUN EARNS ITS WAY OUT OF THE GUTTER/);
  assert.doesNotMatch(css, /\.weapon-rules|\.weapon-rule-steps/);
});

test("compact lobby renders the full character choice before JavaScript loads on every platform", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("../../games/game-03/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../games/game-03/lobby.css", import.meta.url), "utf8"),
  ]);
  const initialCharacterCards = html.match(/class="skin-card(?: selected)?"/g) || [];
  assert.equal(initialCharacterCards.length, 6);
  assert.match(html, /data-skin-preview src="\.\/assets\/characters\/moon-blob-01\/moon-blob-01\.mobile\.webp"/);
  assert.match(html, /class="map-card selected"[\s\S]*LUNAR LIABILITY/);
  assert.match(css, /\.lobby-grid \{[^}]*grid-template-columns:minmax\(0,1\.02fr\) minmax\(390px,\.98fr\)/);
  assert.match(css, /\.selector-panel \{ grid-column:1; grid-row:2;/);
  assert.match(css, /\.skin-rail \{ grid-column:2; grid-row:2; display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.skin-card strong,\.skin-card small \{ display:none; \}/);
  assert.match(css, /\.skin-card img \{ width:68px; height:68px;/);
  assert.match(html, /aria-label="Select Major Disappointment" title="Major Disappointment"/);
  assert.match(css, /\.selector-panel>div:first-child \{ grid-column:1\/-1; display:flex;/);
  assert.match(css, /\.selector-panel>div:first-child h2 \{ margin:0; white-space:nowrap; \}/);
  assert.match(css, /\.roster-panel \{ grid-column:2; grid-row:1\/3;/);
  assert.doesNotMatch(css, /@media\(max-width:520px\)[\s\S]*\.selector-panel\{[^}]*min-height:520px/);
});

test("localhost previews connect to the IPv4-bound local Worker", async () => {
  const game = await readFile(new URL("../../games/game-03/game.js", import.meta.url), "utf8");
  assert.match(game, /location\.hostname === "localhost" \? "127\.0\.0\.1" : location\.hostname/);
  assert.match(game, /ws:\/\/\$\{workerHostname\}:8787/);
  assert.match(game, /parameters\.get\("local"\) === "1" \|\| debugMode \|\| location\.port === "8081"/);
});

test("temporary Worker reloads keep active gameplay out of the lobby", async () => {
  const game = await readFile(new URL("../../games/game-03/game.js", import.meta.url), "utf8");
  assert.match(game, /resumeAfterReconnect = interruptedGameplay && state !== "failed"/);
  assert.match(game, /if \(resumeAfterReconnect\) \{\s*applicationState = "PLAYING";\s*lobby\.hide\(\)/);
  assert.match(game, /resumeAfterReconnect && !joined && applicationState !== "JOINING"/);
});

test("lobby visibly separates waiting players from players already in the arena", async () => {
  const html = await readFile(new URL("../../games/game-03/index.html", import.meta.url), "utf8");
  assert.match(html, /data-lobby-waiting-roster/);
  assert.match(html, /data-lobby-player-count/);
  assert.match(html, /WAITING IN LOBBY/);
  assert.match(html, /data-lobby-roster/);
  assert.match(html, /FIGHTING RIGHT NOW/);
});

test("map cards switch selection in place and defer navigation until joining", async () => {
  const [lobby, game] = await Promise.all([
    readFile(new URL("../../games/game-03/lobby.js", import.meta.url), "utf8"),
    readFile(new URL("../../games/game-03/game.js", import.meta.url), "utf8"),
  ]);
  assert.match(lobby, /this\.selectMap\(map\.id\)/);
  assert.match(lobby, /this\.selectedMapId = map\.id;[\s\S]*this\.renderMapCards\(\);[\s\S]*this\.renderStatus\(\)/);
  assert.match(game, /history\.replaceState\(null, "", destination\)/);
  assert.match(game, /if \(lobby\.selectedMapId !== selectedMap\.id\) \{[\s\S]*navigateToMap\(lobby\.selectedMapId, true\)/);
  assert.doesNotMatch(game, /onMapSelected\(mapId\) \{\s*navigateToMap/);
  assert.doesNotMatch(game, /onMapSelected\(mapId\) \{[\s\S]*loadDustyOrbitAssets/);
});

test("cross-map auto-join keeps the lobby hidden throughout the necessary map load", async () => {
  const game = await readFile(new URL("../../games/game-03/game.js", import.meta.url), "utf8");
  assert.match(game, /if \(autoJoin\) \{[\s\S]*lobby\.hide\(\);[\s\S]*loading\.classList\.remove\("done"\)/);
  assert.match(game, /if \(autoJoinRequested\) \{\s*lobby\.hide\(\);/);
  assert.match(game, /autoJoinRequested && state === "connecting"[\s\S]*lobby\.hide\(\)/);
  assert.match(game, /autoJoinRequested \|\| applicationState === "JOINING"[\s\S]*lobby\.hide\(\)/);
});

test("homepage and lobby use one game-wide presence channel for counts and invitations", async () => {
  const [homePresence, game, worker] = await Promise.all([
    readFile(new URL("../../js/dusty-presence.js", import.meta.url), "utf8"),
    readFile(new URL("../../games/game-03/game.js", import.meta.url), "utf8"),
    readFile(new URL("../src/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(homePresence, /presenceEndpoint\(presenceBase\)/);
  assert.match(game, /url: presenceEndpoint\(arenaEndpoint\)/);
  assert.match(game, /lobby\.setOnlinePlayers\(message\.onlinePlayers\)/);
  assert.match(worker, /url\.pathname === "\/presence\/ws"/);
  assert.match(worker, /nebula-murderball-presence-v1/);
});

test("map editor exposes collision point insertion and placed object deletion", async () => {
  const [html, editor] = await Promise.all([
    readFile(new URL("../../games/game-03/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../games/game-03/collision-editor.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="collisionEditorAddPoint"[^>]*>ADD POINT/);
  assert.match(html, /id="collisionEditorDeleteObject"[^>]*>DELETE OBJECT/);
  assert.match(html, /id="collisionEditorProjectilePassthrough"[^>]*type="checkbox"/);
  assert.match(html, /LET SHOTS PASS THROUGH/);
  assert.match(editor, /Delete only this placed object from the map/);
  assert.match(editor, /removeEnvironmentInstance/);
  assert.match(editor, /insertCollisionPoint/);
  assert.match(editor, /blocksProjectiles = !Boolean\(enabled\)/);
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

test("random weapon reveals use compact straight dud, common, and legendary cards", async () => {
  const [html, game] = await Promise.all([
    readFile(new URL("../../games/game-03/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../games/game-03/game.js", import.meta.url), "utf8"),
  ]);
  assert.match(game, /function showWeaponReveal\(weapon\)/);
  assert.match(game, /\["DUD", "AVERAGE", "LEGENDARY"\]/);
  assert.match(game, /rating === "AVERAGE" \? "COMMON" : rating/);
  assert.match(game, /★ LEGENDARY ★/);
  assert.match(game, /replaceChildren\(grade, title\)/);
  assert.match(game, /`WEAPON: \$\{equippedWeaponName\}`/);
  assert.doesNotMatch(game, /FALLBACK T/);
  assert.match(html, /\.arcade-callout\.weapon-reveal\.show \{ transform:translate\(-50%,0\) scale\(1\) rotate\(0\); \}/);
  assert.match(html, /\.weapon-reveal-name \{[^}]*clamp\(13px,2vw,20px\)/);
  assert.match(html, /\.arcade-callout\.rating-dud/);
  assert.match(html, /\.arcade-callout\.rating-average/);
  assert.match(html, /\.arcade-callout\.rating-legendary/);
  assert.match(html, /@keyframes legendary-reveal/);
});
