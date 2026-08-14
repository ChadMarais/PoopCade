import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CHARACTER_SKINS, DEFAULT_CHARACTER_SKIN_ID, characterSkinById, enabledCharacterSkins, validCharacterSkinId } from "../../games/game-03/character-skins.js";
import { DustyOrbitSimulation, DUSTY_MAX_PLAYERS, DUSTY_RESPAWN_MS } from "../src/dusty-simulation.ts";
import { parseClientMessage } from "../src/protocol.ts";
import { summarizeDustyPresence } from "../src/dusty-presence.ts";

function id(index: number): string {
  return `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

test("canonical registry exposes all six production skins and accepts future definitions without UI-specific code", () => {
  assert.equal(DEFAULT_CHARACTER_SKIN_ID, "moon-blob-01");
  assert.equal(characterSkinById("moon-blob-01")?.displayName, "PURPLE NURPLE");
  assert.equal(characterSkinById("ivory-dart-01")?.displayName, "SIR PRICKS-A-LOT");
  assert.equal(characterSkinById("mint-tank-01")?.displayName, "MAJOR DISAPPOINTMENT");
  assert.equal(characterSkinById("void-orb-01")?.displayName, "THE PROBE-LEM");
  assert.equal(characterSkinById("guac-norris-01")?.displayName, "GUAC NORRIS");
  assert.equal(characterSkinById("boopert-einstein-01")?.displayName, "BOOPERT EINSTEIN");
  assert.equal(validCharacterSkinId("invented-by-client"), "moon-blob-01");
  const future = { ...CHARACTER_SKINS[0], id: "future-skin-02", displayName: "FUTURE TEST", enabled: true };
  assert.deepEqual(enabledCharacterSkins([...CHARACTER_SKINS, future]).map((skin) => skin.id), ["moon-blob-01", "ivory-dart-01", "mint-tank-01", "void-orb-01", "guac-norris-01", "boopert-einstein-01", "future-skin-02"]);
  for (const skin of CHARACTER_SKINS) assert.equal(existsSync(resolve("..", "games", "game-03", skin.sprite.replace(/^\.\//, ""))), true, `${skin.id} sprite is missing`);
});

test("join protocol accepts profile identities and cosmetic choice but rejects malformed IDs", () => {
  const message = parseClientMessage(JSON.stringify({ type: "join", name: "Orbit Pilot", skinId: "moon-blob-01", accessToken: "x".repeat(40) }));
  assert.deepEqual(message, { type: "join", name: "Orbit Pilot", skinId: "moon-blob-01", accessToken: "x".repeat(40) });
  assert.equal(parseClientMessage(JSON.stringify({ type: "join", name: "Orbit Pilot", skinId: "../../bad" })), null);
});

test("hello distinguishes homepage presence from players genuinely waiting in Dusty Orbit", () => {
  const sessionId = id(1);
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "hello", name: "Guest-0001", sessionId })), { type: "hello", name: "Guest-0001", sessionId, presence: "unknown" });
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "hello", name: "Guest-0001", sessionId, presence: "home" })), { type: "hello", name: "Guest-0001", sessionId, presence: "home" });
  assert.equal(parseClientMessage(JSON.stringify({ type: "hello", name: "Guest-0001", sessionId, presence: "moon" })), null);
});

test("presence summary separates waiting lobby players from homepage and active sessions", () => {
  const summary = summarizeDustyPresence([
    { playerId: id(1), name: "Homepage", role: "lobby", surface: "home", connectedAt: 900 },
    { playerId: id(2), name: "Waiting Two", role: "lobby", surface: "dusty", connectedAt: 1200 },
    { playerId: id(3), name: "In Game", role: "active", surface: "dusty", connectedAt: 1000 },
    { playerId: id(4), name: "Waiting One", role: "lobby", surface: "dusty", connectedAt: 1100 },
  ] as const);
  assert.equal(summary.onlinePlayers, 4);
  assert.deepEqual(summary.lobbyPlayers, [
    { id: id(4), name: "Waiting One", waitingSince: 1100 },
    { id: id(2), name: "Waiting Two", waitingSince: 1200 },
  ]);
});

test("lobby spectators can request one non-intrusive recruitment broadcast", () => {
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "recruit" })), { type: "recruit" });
});

test("input protocol carries a finite visual timeline for bounded hit rewind", () => {
  const input = { type: "input", seq: 9, moveX: 0, moveY: 0, aimX: 1, aimY: 0, fire: true, viewAt: 12_345 };
  assert.deepEqual(parseClientMessage(JSON.stringify(input)), { ...input, nuke: false });
  const invalid = parseClientMessage(JSON.stringify({ ...input, viewAt: "yesterday" })) as Record<string, unknown>;
  assert.equal("viewAt" in invalid, false);
});

test("authoritative capacity accepts 15 active players, rejects player 16, then releases a deliberate leave", () => {
  const simulation = new DustyOrbitSimulation(() => .5);
  assert.equal(DUSTY_MAX_PLAYERS, 15);
  for (let index = 1; index <= 15; index++) simulation.addPlayer(id(index), `Guest-${String(index).padStart(4, "0")}`, 1000 + index);
  assert.equal(simulation.players.size, 15);
  assert.equal((simulation.lobbyState(2000) as any).full, true);
  assert.throws(() => simulation.addPlayer(id(16), "Guest-0016", 2000), /arena-full/);
  simulation.removePlayer(id(4));
  assert.equal(simulation.players.size, 14);
  const replacement = simulation.addPlayer(id(16), "Guest-0016", 3000);
  assert.equal(replacement.joinedAt, 3000);
  assert.equal(simulation.players.size, 15);
});

test("two final-slot attempts produce one admission and one ARENA_FULL result", () => {
  const simulation = new DustyOrbitSimulation(() => .5);
  for (let index = 1; index <= 14; index++) simulation.addPlayer(id(index), `Guest-${String(index).padStart(4, "0")}`, 1000);
  const results = [15, 16].map((index) => {
    try { simulation.addPlayer(id(index), `Guest-${String(index).padStart(4, "0")}`, 2000); return "JOINED"; }
    catch (error) { return error instanceof Error && error.message === "arena-full" ? "ARENA_FULL" : "ERROR"; }
  });
  assert.deepEqual(results.sort(), ["ARENA_FULL", "JOINED"]);
  assert.equal(simulation.players.size, 15);
});

test("joinedAt starts on admission, survives reconnect/death/respawn, and resets after a full leave", () => {
  const simulation = new DustyOrbitSimulation(() => .5);
  const player = simulation.addPlayer(id(1), "Guest-0001", 1000, { skinId: "moon-blob-01" });
  const attacker = simulation.addPlayer(id(2), "Guest-0002", 1000);
  simulation.markDisconnected(player.id, 1500);
  simulation.addPlayer(player.id, player.name, 2000, { skinId: player.skinId });
  assert.equal(player.joinedAt, 1000);
  (simulation as any).killPlayer(player, attacker.id, 2500, "projectile");
  assert.equal(player.joinedAt, 1000);
  simulation.step(undefined, 2500 + DUSTY_RESPAWN_MS);
  assert.equal(player.joinedAt, 1000);
  simulation.removePlayer(player.id);
  const rejoined = simulation.addPlayer(player.id, player.name, 9000, { skinId: player.skinId });
  assert.equal(rejoined.joinedAt, 9000);
});

test("inactivity removal emits the authoritative final score for persistence", () => {
  const simulation = new DustyOrbitSimulation(() => .5);
  const player = simulation.addPlayer(id(1), "Profile Pilot", 1000);
  player.killScore = 4;
  player.kills = 7;
  player.deaths = 3;
  simulation.markDisconnected(player.id, 2000);
  simulation.step(undefined, 7000);

  const stale = simulation.drainEvents().find((event) => event.type === "stale") as any;
  assert.deepEqual(stale, {
    type: "stale",
    playerId: player.id,
    endedAt: 7000,
    player: { id: player.id, killScore: 4, kills: 7, deaths: 3, joinedAt: 1000 },
  });
  assert.equal(simulation.players.has(player.id), false);
});

test("lobby roster carries live non-negative scores, skin IDs, join times, and deterministic ranking", () => {
  const simulation = new DustyOrbitSimulation(() => .5);
  const first = simulation.addPlayer(id(1), "Profile Pilot", 1000, { skinId: "moon-blob-01" });
  const second = simulation.addPlayer(id(2), "Guest-0002", 1500, { skinId: "made-up" });
  first.killScore = -3;
  second.killScore = 4;
  second.kills = 7;
  const state = simulation.lobbyState(5000) as any;
  assert.equal(state.activePlayers, 2);
  assert.deepEqual(state.players.map((player: any) => player.id), [second.id, first.id]);
  assert.deepEqual(state.players[0], { id: second.id, name: second.name, skinId: "moon-blob-01", killScore: 4, kills: 7, joinedAt: 1500 });
  assert.equal(state.players[1].killScore, 0);
  first.killScore = 6;
  assert.equal((simulation.lobbyState(5100) as any).players[0].killScore, 6);
  assert.equal((simulation.snapshot(first.id, 5100) as any).players.find((player: any) => player.id === first.id).skinId, "moon-blob-01");
});

test("each new production skin survives authoritative admission, lobby state, and gameplay snapshots", () => {
  const simulation = new DustyOrbitSimulation(() => .5);
  const skinIds = ["ivory-dart-01", "mint-tank-01", "void-orb-01", "guac-norris-01", "boopert-einstein-01"];
  for (const [index, skinId] of skinIds.entries()) {
    const player = simulation.addPlayer(id(index + 1), `Guest-${String(index + 1).padStart(4, "0")}`, 1000 + index, { skinId });
    assert.equal(player.skinId, skinId);
    assert.equal((simulation.snapshot(player.id, 2000) as any).players.find((item: any) => item.id === player.id).skinId, skinId);
  }
  assert.deepEqual((simulation.lobbyState(2000) as any).players.map((player: any) => player.skinId), skinIds);
});
