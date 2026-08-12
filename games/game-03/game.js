import { moveCircleWithSliding } from "./collision-geometry.js?v=20260812";
import { loadDustyOrbitAssets } from "./assets.js?v=20260812";
import { PRODUCTION_ARENA_WSS } from "./config.js?v=20260812";
import { DustyOrbitMultiplayerRenderer } from "./renderer.js?v=20260812-2";
import { InputController } from "./input.js?v=20260812";
import { ArenaNetwork } from "./network.js?v=20260812";

const INPUT_RATE = 30;
const INPUT_DT = 1 / INPUT_RATE;
const PLAYER_RADIUS = 17;
const PLAYER_SPEED = 165;
const ARENA_ID = "dusty-orbit-001";
const parameters = new URLSearchParams(location.search);
let debugCollision = parameters.get("debug") === "1";
document.documentElement.classList.toggle("mobile-preview", parameters.get("mobile") === "1");

function finitePoint(value) { return Boolean(value) && Number.isFinite(value.x) && Number.isFinite(value.y); }
function finiteAxis(value, fallback = 0) { return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : fallback; }
function sessionValue(key, create) { let value = sessionStorage.getItem(key); if (!value) { value = create(); sessionStorage.setItem(key, value); } return value; }
function localFrontendHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" ||
    /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
}
function localServerOverride(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return "";
    if (!url.host || url.username || url.password || url.search || url.hash) return "";
    const arenaPath = `/arena/${ARENA_ID}/ws`;
    const suppliedPath = url.pathname.replace(/\/+$/, "");
    if (suppliedPath && suppliedPath !== arenaPath) return "";
    url.pathname = arenaPath;
    return url.href;
  } catch {
    return "";
  }
}
function endpoint() {
  const explicit = parameters.get("server");
  const local = localFrontendHost(location.hostname);
  if (local && explicit) return localServerOverride(explicit);
  if (local) return `ws://${location.hostname}:8787/arena/${ARENA_ID}/ws`;
  const productionBase = PRODUCTION_ARENA_WSS.trim().replace(/\/$/, "");
  return /^wss:\/\/[^/]+$/i.test(productionBase) ? `${productionBase}/arena/${ARENA_ID}/ws` : "";
}

const sessionId = sessionValue("dusty_orbit_mp_session", () => crypto.randomUUID());
const guestName = sessionValue("dusty_orbit_mp_name", () => `Guest-${String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, "0")}`);
const canvas = document.querySelector("#world");
const loading = document.querySelector("#loading");
const loadingBar = document.querySelector("#loadingBar");
const loadingText = document.querySelector("#loadingText");
const connection = document.querySelector("#connection");
const debugHud = document.querySelector("#debugHud");
const events = document.querySelector("#events");
const devtest = parameters.get("devtest") === "true";
document.querySelector("#homeLink").href = devtest ? "/?devtest=true" : "/";
document.querySelector("#devBadge").hidden = !devtest;
debugHud.hidden = !debugCollision;
const arenaEndpoint = endpoint();
if (!arenaEndpoint) {
  loadingText.textContent = "Production multiplayer endpoint is not configured.";
  connection.textContent = "CONFIG REQUIRED";
  throw new Error("Set PRODUCTION_ARENA_WSS in games/game-03/config.js before production deployment.");
}
const assets = await loadDustyOrbitAssets((message, amount) => { loadingText.textContent = message; loadingBar.style.width = `${amount * 100}%`; });
loadingBar.style.width = "100%";
const renderer = new DustyOrbitMultiplayerRenderer(canvas, assets, debugCollision);
const input = new InputController(canvas, null, null, {
  movementSurface: canvas,
  movementGuide: document.querySelector("#mobileMoveGuide"),
  fireButton: document.querySelector("#mobileFireButton"),
});

let connectionState = "connecting";
let localId = sessionId;
let latestSnapshot = null;
let predicted = null;
let visualPredicted = null;
const predictionOffset = { x: 0, y: 0 };
let pending = [];
let seq = 0;
let sendAccumulator = 0;
let previousFrame = performance.now();
let fps = 0;
let fpsFrames = 0;
let fpsWindow = performance.now();
let serverRates = { tick: 30, snapshot: 15, interpolationMs: 100 };
let latestAim = { x: 1, y: 0 };
let reconciliationError = 0;
let maximumReconciliationError = 0;
const eventLines = [];

function addEvent(text) { eventLines.unshift(text); eventLines.splice(6); events.textContent = eventLines.join("\n"); }

const network = new ArenaNetwork({
  url: arenaEndpoint, sessionId, name: guestName,
  onState(state, detail) {
    connectionState = state;
    connection.textContent = state === "online" ? "● ONLINE" : `${state.toUpperCase()}${detail ? ` · ${detail}` : ""}`;
    connection.classList.toggle("online", state === "online");
    input.enabled = state === "online" && !document.hidden;
    if (!loading.classList.contains("done")) {
      if (state === "online") loadingText.textContent = "CONNECTED · JOINING DUSTY ORBIT…";
      else if (state === "connecting") loadingText.textContent = "CONNECTING TO LOCAL MULTIPLAYER…";
      else loadingText.textContent = `${state === "failed" ? "MULTIPLAYER UNAVAILABLE" : "CONNECTION LOST · RETRYING"}${detail ? ` · ${detail}` : ""}`;
    }
  },
  onMessage(message) {
    if (message.type === "welcome") {
      localId = message.playerId;
      serverRates = message.rates || serverRates;
      if (Number.isSafeInteger(message.player?.lastInputSeq)) seq = Math.max(seq, message.player.lastInputSeq);
      if (finitePoint(message.player)) predicted = { x: message.player.x, y: message.player.y };
      addEvent(`JOINED ${message.arenaId} AS ${guestName}`);
      loading.classList.add("done");
      canvas.focus({ preventScroll: true });
      return;
    }
    if (message.type === "snapshot") { latestSnapshot = message; reconcile(message); return; }
    if (message.type === "shot" && message.playerId === localId) {
      input.acknowledgeFire();
      renderer.confirmLocalShot(message, visualPredicted || predicted);
    }
    if (message.type === "impact") renderer.impact(message);
    if (message.type === "player_hit") { renderer.playerHit(message.playerId); addEvent(`${message.playerId === localId ? "YOU" : "PLAYER"} HIT · ${message.hp} HP`); }
    if (message.type === "kill") addEvent(`${message.killerName} ELIMINATED ${message.victimName}`);
    if (message.type === "death" && message.victimId === localId) addEvent("YOU ARE DOWN · RESPAWNING IN 2s");
    if (message.type === "respawn" && message.playerId === localId) addEvent("RESPAWNED · 2s PROTECTION");
    if (message.type === "player_joined") addEvent(`${message.player.name} JOINED`);
    if (message.type === "player_left") addEvent(`${message.player.name} LEFT`);
  },
});

function applyMovement(position, sample, duration, player) {
  if (!finitePoint(position) || !player?.alive) return position;
  const elapsed = Number.isFinite(duration) ? Math.max(0, Math.min(.1, duration)) : 0;
  const next = moveCircleWithSliding(position, { x: finiteAxis(sample?.moveX) * PLAYER_SPEED * elapsed, y: finiteAxis(sample?.moveY) * PLAYER_SPEED * elapsed }, PLAYER_RADIUS, assets.polygons);
  return {
    x: Math.max(PLAYER_RADIUS, Math.min(assets.world.width - PLAYER_RADIUS, next.x)),
    y: Math.max(PLAYER_RADIUS, Math.min(assets.world.height - PLAYER_RADIUS, next.y)),
  };
}

function reconcile(snapshot) {
  const authoritative = snapshot.players?.find((player) => player.id === localId);
  if (!finitePoint(authoritative)) return;
  const ack = Number.isSafeInteger(snapshot.you?.ack) ? snapshot.you.ack : 0;
  seq = Math.max(seq, ack);
  pending = pending.filter((entry) => entry.seq > ack);
  let replayed = { x: authoritative.x, y: authoritative.y };
  for (const entry of pending) replayed = applyMovement(replayed, entry, INPUT_DT, authoritative);
  if (!finitePoint(predicted)) predicted = replayed;
  else {
    const correctionX = predicted.x - replayed.x;
    const correctionY = predicted.y - replayed.y;
    const error = Math.hypot(correctionX, correctionY);
    reconciliationError = error;
    maximumReconciliationError = Math.max(maximumReconciliationError, error);
    if (error > 80) {
      predictionOffset.x = 0;
      predictionOffset.y = 0;
    } else {
      predictionOffset.x += correctionX;
      predictionOffset.y += correctionY;
    }
    predicted = replayed;
  }
}

function sendInput(sample) {
  const message = { type: "input", seq: ++seq, moveX: finiteAxis(sample.moveX), moveY: finiteAxis(sample.moveY), aimX: finiteAxis(sample.aimX, 1), aimY: finiteAxis(sample.aimY), fire: Boolean(sample.fire) };
  if (!network.sendInput(message)) return;
  pending.push(message);
  if (pending.length > 90) pending.shift();
}

function updateHud(snapshot) {
  const player = snapshot?.players?.find((item) => item.id === localId);
  const inputVisual = input.getVisualState();
  const remotes = (snapshot?.players || []).filter((item) => item.id !== localId);
  const remoteSummary = remotes.length
    ? remotes.map((item) => `${item.name} @ ${item.x.toFixed(0)},${item.y.toFixed(0)} AIM ${Math.atan2(item.aimY, item.aimX).toFixed(2)} HP${item.hp}`).join(" · ")
    : "NONE";
  debugHud.textContent = [
    `CONNECTION: ${connectionState.toUpperCase()}  ·  ARENA: ${ARENA_ID}`,
    `LOCAL ID: ${localId.slice(0, 8)}…  ·  NAME: ${guestName}`,
    `PLAYERS: ${snapshot?.players?.length ?? 0}  ·  PING: ${network.rtt.toFixed(1)}ms`,
    `RATES: INPUT ${INPUT_RATE}/s · SNAP ${network.snapshotRate}/s · SERVER ${serverRates.tick}/${serverRates.snapshot}`,
    `TICK: ${snapshot?.tick ?? "—"}  ·  POS: ${player ? `${player.x.toFixed(1)}, ${player.y.toFixed(1)}` : "—"}`,
    `AIM: ${latestAim.x.toFixed(2)}, ${latestAim.y.toFixed(2)}  ·  HP: ${player?.hp ?? "—"}/3  ·  KILLS: ${player?.kills ?? 0}`,
    `MOUSE: ${inputVisual.mouseCanvasX.toFixed(0)}, ${inputVisual.mouseCanvasY.toFixed(0)}  ·  MODE: ${inputVisual.mode.toUpperCase()}`,
    `REMOTE: ${remoteSummary}`,
    `PROJECTILES: ${snapshot?.projectiles?.length ?? 0}  ·  INPUT SEQ/ACK: ${seq}/${snapshot?.you?.ack ?? 0}`,
    `FIRE: ${inputVisual.fire ? "HELD/QUEUED" : "READY"}`,
    `PENDING: ${pending.length}  ·  CORRECTION: ${reconciliationError.toFixed(2)} (MAX ${maximumReconciliationError.toFixed(2)})`,
    `FPS: ${fps}  ·  COLLISION: ${debugCollision ? "ON" : "OFF"}`,
  ].join("\n");
}

function frame(now) {
  const delta = Math.min(.05, Math.max(0, (now - previousFrame) / 1000));
  previousFrame = now;
  const snapshot = network.interpolatedSnapshot(Date.now(), localId);
  if (connectionState === "online" && !document.hidden && snapshot) {
    const player = latestSnapshot?.players?.find((item) => item.id === localId);
    if (!finitePoint(predicted) && finitePoint(player)) predicted = { x: player.x, y: player.y };
    input.setAimOrigin(renderer.getDebugState().playerScreen);
    const sample = input.sample(now);
    latestAim = { x: sample.aimX, y: sample.aimY };
    sendAccumulator += delta;
    while (sendAccumulator >= INPUT_DT) {
      predicted = applyMovement(predicted, sample, INPUT_DT, player);
      sendInput(sample);
      sendAccumulator -= INPUT_DT;
    }
    // Keep committed prediction on the server's fixed 30 Hz interval. The
    // fractional remainder is visual-only so collision and replay stay stable.
    const projected = applyMovement(predicted, sample, sendAccumulator, player);
    const offsetDecay = Math.exp(-delta * 14);
    predictionOffset.x *= offsetDecay;
    predictionOffset.y *= offsetDecay;
    if (Math.hypot(predictionOffset.x, predictionOffset.y) < .01) {
      predictionOffset.x = 0;
      predictionOffset.y = 0;
    }
    visualPredicted = {
      x: Math.max(PLAYER_RADIUS, Math.min(assets.world.width - PLAYER_RADIUS, projected.x + predictionOffset.x)),
      y: Math.max(PLAYER_RADIUS, Math.min(assets.world.height - PLAYER_RADIUS, projected.y + predictionOffset.y)),
    };
  }
  renderer.render(snapshot || latestSnapshot, localId, visualPredicted || predicted, delta, input.getVisualState());
  fpsFrames++;
  if (now - fpsWindow >= 500) { fps = Math.round(fpsFrames * 1000 / (now - fpsWindow)); fpsFrames = 0; fpsWindow = now; updateHud(latestSnapshot); }
  requestAnimationFrame(frame);
}

addEventListener("keydown", (event) => {
  if (event.code !== "KeyC") return;
  debugCollision = !debugCollision;
  renderer.debug = debugCollision;
  debugHud.hidden = !debugCollision;
});
document.addEventListener("visibilitychange", () => { input.reset(); input.enabled = connectionState === "online" && !document.hidden; network.setActive(!document.hidden); if (!document.hidden) previousFrame = performance.now(); });
addEventListener("beforeunload", () => network.close());

window.__DUSTY_ORBIT_MULTIPLAYER__ = { network, renderer, input, getState: () => ({ connectionState, localId, guestName, latestSnapshot, predicted, visualPredicted, predictionOffset: { ...predictionOffset }, pending: [...pending], seq, reconciliationError, maximumReconciliationError, input: input.getVisualState() }) };
network.connect(true);
requestAnimationFrame(frame);
