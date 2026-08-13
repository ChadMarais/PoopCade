import { moveCircleWithSliding } from "./collision-geometry.js?v=20260813";
import { CollisionEditor } from "./collision-editor.js?v=20260813-8";
import { loadDustyOrbitAssets } from "./assets.js?v=20260813-8";
import { PRODUCTION_ARENA_WSS } from "./config.js?v=20260812";
import { DustyOrbitMultiplayerRenderer } from "./renderer.js?v=20260813-14";
import { InputController } from "./input.js?v=20260813-2";
import { claimSessionIdentity } from "./identity.js?v=20260813";
import { ArenaNetwork } from "./network.js?v=20260813";
import { consumeFixedStep, convergeVisualPosition } from "./timing.js?v=20260813-2";

const INPUT_RATE = 30;
const INPUT_DT = 1 / INPUT_RATE;
const PLAYER_RADIUS = 17;
const FALLBACK_PLAYER_SPEED = 165;
const ARENA_ID = "dusty-orbit-001";
const parameters = new URLSearchParams(location.search);
const debugMode = parameters.get("debug") === "1";
let debugCollision = debugMode;
document.documentElement.classList.toggle("mobile-preview", parameters.get("mobile") === "1");

function finitePoint(value) { return Boolean(value) && Number.isFinite(value.x) && Number.isFinite(value.y); }
function finiteAxis(value, fallback = 0) { return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : fallback; }
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
  if (local) return `ws://${location.hostname}:8787/arena/${ARENA_ID}/ws${parameters.get("debug") === "1" ? "?debug=1" : ""}`;
  const productionBase = PRODUCTION_ARENA_WSS.trim().replace(/\/$/, "");
  return /^wss:\/\/[^/]+$/i.test(productionBase) ? `${productionBase}/arena/${ARENA_ID}/ws` : "";
}

const identity = await claimSessionIdentity();
const { sessionId, guestName } = identity;
const canvas = document.querySelector("#world");
const loading = document.querySelector("#loading");
const loadingBar = document.querySelector("#loadingBar");
const loadingText = document.querySelector("#loadingText");
const connection = document.querySelector("#connection");
const debugHud = document.querySelector("#debugHud");
const events = document.querySelector("#events");
const gameplayHud = document.querySelector("#gameplayHud");
const mobileFireLabel = document.querySelector("#mobileFireButton .mobile-fire-label");
const mobileNukeButton = document.querySelector("#mobileNukeButton");
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
const focusSatellite = parameters.get("focus") === "satellite-east" ? assets.satellites[1] : assets.satellites[0];
const debugFocus = debugCollision && parameters.get("focus")?.startsWith("satellite") ? focusSatellite : null;
const renderer = new DustyOrbitMultiplayerRenderer(canvas, assets, debugCollision, debugFocus);
const input = new InputController(canvas, null, null, {
  movementSurface: canvas,
  movementGuide: document.querySelector("#mobileMoveGuide"),
  fireButton: document.querySelector("#mobileFireButton"),
});
const collisionEditor = debugMode ? new CollisionEditor({
  canvas,
  assets,
  renderer,
  input,
  panel: document.querySelector("#collisionEditor"),
  select: document.querySelector("#collisionEditorObject"),
  toggle: document.querySelector("#collisionEditorToggle"),
  copy: document.querySelector("#collisionEditorCopy"),
  save: document.querySelector("#collisionEditorSave"),
  reset: document.querySelector("#collisionEditorReset"),
  remove: document.querySelector("#collisionEditorDelete"),
  status: document.querySelector("#collisionEditorStatus"),
  persistence: document.querySelector("#collisionEditorPersistence"),
  onActivate() {
    debugCollision = true;
    renderer.debug = true;
    debugHud.hidden = false;
  },
}) : null;
if (collisionEditor) {
  renderer.collisionEditor = collisionEditor;
  collisionEditor.setVisible(true);
}

let connectionState = "connecting";
let joined = false;
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
const inputStepTimes = [];
let serverRates = { tick: 30, snapshot: 15, interpolationMs: 100 };
let weaponDefinitions = [{ tier: 1, name: "PEA SHOOTER" }];
let gameplay = { baseMovementSpeed: FALLBACK_PLAYER_SPEED, speedMultiplier: 2, nukeRequirement: 10 };
let latestAim = { x: 1, y: 0 };
let reconciliationError = 0;
let maximumReconciliationError = 0;
const eventLines = [];
let nukeQueuedUntil = 0;
let localSpeedBoostUntil = 0;

function addEvent(text) { eventLines.unshift(text); eventLines.splice(6); events.textContent = eventLines.join("\n"); }

const network = new ArenaNetwork({
  url: arenaEndpoint, sessionId, name: guestName,
  onState(state, detail) {
    connectionState = state;
    connection.textContent = state === "online" ? "● ONLINE" : `${state.toUpperCase()}${detail ? ` · ${detail}` : ""}`;
    connection.classList.toggle("online", state === "online");
    if (state !== "online") {
      joined = false;
      input.reset();
      pending = [];
      sendAccumulator = 0;
      inputStepTimes.length = 0;
      localSpeedBoostUntil = 0;
    }
    // A TCP/WebSocket open is not yet an arena join. Waiting for welcome
    // prevents pre-handshake input from racing the server's restored sequence.
    input.enabled = state === "online" && joined && !document.hidden;
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
      weaponDefinitions = Array.isArray(message.weapons) && message.weapons.length ? message.weapons : weaponDefinitions;
      gameplay = { ...gameplay, ...(message.gameplay || {}) };
      seq = Number.isSafeInteger(message.player?.lastInputSeq) ? message.player.lastInputSeq : 0;
      pending = [];
      sendAccumulator = 0;
      inputStepTimes.length = 0;
      localSpeedBoostUntil = 0;
      input.reset();
      if (finitePoint(message.player)) resetPredictionTo(message.player);
      joined = true;
      input.enabled = !document.hidden;
      addEvent(`JOINED ${message.arenaId} AS ${guestName}`);
      loading.classList.add("done");
      canvas.focus({ preventScroll: true });
      return;
    }
    if (message.type === "snapshot") { latestSnapshot = message; reconcile(message); return; }
    if (message.type === "shot") {
      const localShot = message.playerId === localId;
      if (localShot) input.acknowledgeFire();
      renderer.confirmShot(message, localShot);
    }
    if (message.type === "impact") renderer.impact(message);
    if (message.type === "shield_hit") { renderer.shieldHit(message); addEvent(message.playerId === localId ? "SHIELD ABSORBED A HIT" : "SHIELD HIT"); }
    if (message.type === "teleport") {
      renderer.teleport(message);
      if (message.playerId === localId && finitePoint(message)) resetPredictionTo(message);
    }
    if (message.type === "mole_burrowed") renderer.moleBurrowed(message);
    if (message.type === "mole_emerged") renderer.moleEmerged(message);
    if (message.type === "fart_cloud") renderer.fartCloud(message, message.ownerId === localId);
    if (message.type === "mole_blocked" && message.playerId === localId) { renderer.blocked(); addEvent("EMERGENCE BLOCKED · MOVE OFF THE ROCK"); }
    if (message.type === "powerup_collected" && message.playerId === localId) {
      if (message.powerup === "speed") localSpeedBoostUntil = performance.now() + Math.max(0, Number(gameplay.speedDurationMs) || 0);
      addEvent(`PICKED UP ${String(message.powerup).toUpperCase()}`);
    }
    if (message.type === "nuke_warning") { renderer.nukeWarning(message); if (message.ownerId === localId) nukeQueuedUntil = 0; addEvent("NUKE INCOMING"); }
    if (message.type === "nuke_detonated") renderer.nukeDetonated(message);
    if (message.type === "player_hit") { renderer.playerHit(message.playerId); addEvent(`${message.playerId === localId ? "YOU" : "PLAYER"} HIT · ${message.hp} HP`); }
    if (message.type === "kill") addEvent(`${message.killerName} ELIMINATED ${message.victimName}`);
    if (message.type === "death") {
      renderer.death(message);
      if (message.victimId === localId) { localSpeedBoostUntil = 0; addEvent("YOU ARE DOWN · RESPAWNING IN 2s"); }
    }
    if (message.type === "respawn") {
      renderer.respawn(message);
      if (message.playerId === localId) { resetPredictionTo(message); addEvent("RESPAWNED · 2s PROTECTION"); }
    }
    if (message.type === "player_joined") addEvent(`${message.player.name} JOINED`);
    if (message.type === "player_left") addEvent(`${message.player.name} LEFT`);
  },
});

function applyMovement(position, sample, duration, player) {
  if (!finitePoint(position) || !player?.alive) return position;
  const elapsed = Number.isFinite(duration) ? Math.max(0, Math.min(.1, duration)) : 0;
  const baseSpeed = Number.isFinite(gameplay.baseMovementSpeed) ? gameplay.baseMovementSpeed : FALLBACK_PLAYER_SPEED;
  const speed = baseSpeed * (turboActive(player) ? gameplay.speedMultiplier : 1);
  const next = moveCircleWithSliding(position, { x: finiteAxis(sample?.moveX) * speed * elapsed, y: finiteAxis(sample?.moveY) * speed * elapsed }, PLAYER_RADIUS, player.moleMode ? [] : assets.polygons);
  return {
    x: Math.max(PLAYER_RADIUS, Math.min(assets.world.width - PLAYER_RADIUS, next.x)),
    y: Math.max(PLAYER_RADIUS, Math.min(assets.world.height - PLAYER_RADIUS, next.y)),
  };
}

function turboActive(player) { return player?.speedRemaining > 0 || performance.now() < localSpeedBoostUntil; }

function resetPredictionTo(position) {
  predicted = { x: position.x, y: position.y };
  visualPredicted = { ...predicted };
  predictionOffset.x = 0; predictionOffset.y = 0;
  pending = [];
  reconciliationError = 0;
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
  const message = { type: "input", seq: ++seq, moveX: finiteAxis(sample.moveX), moveY: finiteAxis(sample.moveY), aimX: finiteAxis(sample.aimX, 1), aimY: finiteAxis(sample.aimY), fire: Boolean(sample.fire), nuke: performance.now() < nukeQueuedUntil };
  if (!network.sendInput(message)) return;
  pending.push(message);
  if (pending.length > 90) pending.shift();
}

function updateHud(snapshot) {
  const player = snapshot?.players?.find((item) => item.id === localId);
  const satellitePositions = assets.satellites.map((satellite) => `${satellite.id}: ${satellite.x},${satellite.y}`).join("  ·  ");
  const inputVisual = input.getVisualState();
  const remotes = (snapshot?.players || []).filter((item) => item.id !== localId);
  const remoteSummary = remotes.length
    ? remotes.map((item) => `${item.name} @ ${item.x.toFixed(0)},${item.y.toFixed(0)} AIM ${Math.atan2(item.aimY, item.aimX).toFixed(2)} HP${item.hp} T${item.weaponTier} S${item.killScore}`).join(" · ")
    : "NONE";
  const weaponDebug = renderer.getDebugState(localId).weapon;
  const weaponDebugLines = weaponDebug ? [
    `WEAPON: T${weaponDebug.tier} ${weaponDebug.id.toUpperCase()} · ROT ${(weaponDebug.rotation * 180 / Math.PI).toFixed(1)}°`,
    `PIVOT: ${weaponDebug.pivot.x.toFixed(2)},${weaponDebug.pivot.y.toFixed(2)} · ATTACH ${weaponDebug.attachmentWorld.x.toFixed(1)},${weaponDebug.attachmentWorld.y.toFixed(1)}`,
    `MUZZLE: ${weaponDebug.muzzleWorld.x.toFixed(1)},${weaponDebug.muzzleWorld.y.toFixed(1)}`,
  ] : ["WEAPON: HIDDEN"];
  debugHud.textContent = [
    `CONNECTION: ${connectionState.toUpperCase()}  ·  ARENA: ${ARENA_ID}`,
    `LOCAL ID: ${localId.slice(0, 8)}…  ·  NAME: ${guestName}`,
    `PLAYERS: ${snapshot?.players?.length ?? 0}  ·  PING: ${network.rtt.toFixed(1)}ms`,
    `RATES: INPUT ${Math.min(INPUT_RATE, inputStepTimes.length)}/s · SNAP ${network.snapshotRate}/s · SERVER ${serverRates.tick}/${serverRates.snapshot}`,
    `TICK: ${snapshot?.tick ?? "—"}  ·  POS: ${player ? `${player.x.toFixed(1)}, ${player.y.toFixed(1)}` : "—"}`,
    `SATELLITES: ${satellitePositions || "—"}`,
    `SATELLITE CONNECTED: ${player?.satelliteConnected ? "YES" : "NO"}  ·  CONNECT DISTANCE: ${assets.satelliteConnection.connectTolerance}`,
    `NEAREST SATELLITE: ${snapshot?.you?.nearestSatelliteId || "—"}  ·  DISTANCE: ${Number.isFinite(snapshot?.you?.satelliteDistance) ? snapshot.you.satelliteDistance.toFixed(1) : "—"}`,
    `RADAR SOURCE: ${snapshot?.you?.radarSource || "NONE"}`,
    `AIM: ${latestAim.x.toFixed(2)}, ${latestAim.y.toFixed(2)}  ·  HP: ${player?.hp ?? "—"}/3  ·  KILLS: ${player?.kills ?? 0}`,
    ...weaponDebugLines,
    `MOUSE: ${inputVisual.mouseCanvasX.toFixed(0)}, ${inputVisual.mouseCanvasY.toFixed(0)}  ·  MODE: ${inputVisual.mode.toUpperCase()}`,
    `REMOTE: ${remoteSummary}`,
    `PROJECTILES: ${snapshot?.projectiles?.length ?? 0}  ·  INPUT SEQ/ACK: ${seq}/${snapshot?.you?.ack ?? 0}`,
    `FIRE: ${inputVisual.fire ? "HELD/QUEUED" : "READY"}`,
    `PENDING: ${pending.length}  ·  CORRECTION: ${reconciliationError.toFixed(2)} (MAX ${maximumReconciliationError.toFixed(2)})`,
    `FPS: ${fps}  ·  COLLISION: ${debugCollision ? "ON" : "OFF"}`,
  ].join("\n");

  const weapon = weaponDefinitions.find((item) => item.tier === player?.weaponTier) || weaponDefinitions[0];
  const effects = [];
  if (player?.spyRemaining > 0) effects.push(`SPY ${(player.spyRemaining / 1000).toFixed(1)}s`);
  if (player?.satelliteConnected) effects.push("UPLINK: ACTIVE");
  if (player?.speedRemaining > 0) effects.push(`SPEED ${(player.speedRemaining / 1000).toFixed(1)}s`);
  if (player?.moleMode) effects.push(`MOLE ${(player.moleRemaining / 1000).toFixed(1)}s${player.emergeBlocked ? " · BLOCKED" : ""}`);
  gameplayHud.textContent = [
    `HP: ${"●".repeat(Math.max(0, player?.hp || 0))}${"○".repeat(Math.max(0, 3 - (player?.hp || 0)))}`,
    `SHIELD: ${player?.shieldHits ? "YES" : "NO"}`,
    `WEAPON: T${player?.weaponTier || 1} ${weapon?.name || "PEA SHOOTER"}`,
    `SCORE: ${player?.killScore ?? 0}`,
    `NUKE: ${player?.nukeReady ? "READY" : `${player?.nukeProgress ?? 0}/${gameplay.nukeRequirement}`}`,
    ...effects,
  ].join("\n");
  mobileNukeButton.disabled = !player?.nukeReady;
  mobileFireLabel.textContent = player?.moleMode ? "EMERGE" : "FIRE";
}

function frame(now) {
  const delta = Math.min(.05, Math.max(0, (now - previousFrame) / 1000));
  previousFrame = now;
  const snapshot = network.interpolatedSnapshot(Date.now(), localId);
  if (connectionState === "online" && joined && !document.hidden && snapshot) {
    const player = latestSnapshot?.players?.find((item) => item.id === localId);
    if (!finitePoint(predicted) && finitePoint(player)) predicted = { x: player.x, y: player.y };
    input.setAimOrigin(renderer.getDebugState().playerScreen);
    const sample = input.sample(now);
    latestAim = { x: sample.aimX, y: sample.aimY };
    // Preserve the fractional remainder across frames. Resetting it to zero
    // made 72–80 Hz displays emit only 24–27 movement steps per second, which
    // was especially visible as pulsing motion during turbo boost.
    const timing = consumeFixedStep(sendAccumulator, delta, INPUT_DT);
    sendAccumulator = timing.remainder;
    if (timing.consumed) {
      predicted = applyMovement(predicted, sample, INPUT_DT, player);
      sendInput(sample);
      inputStepTimes.push(now);
    }
    while (inputStepTimes.length && now - inputStepTimes[0] > 1000) inputStepTimes.shift();
    // Keep committed prediction on the server's fixed 30 Hz interval. The
    // fractional remainder is visual-only so collision and replay stay stable.
    const projected = applyMovement(predicted, sample, sendAccumulator, player);
    // Turbo magnifies small reconciliation deltas. Ease those corrections
    // over a slightly longer window so speed remains fast without micro-snaps.
    const correctionRate = turboActive(player) ? 7 : 10;
    const offsetDecay = Math.exp(-delta * correctionRate);
    predictionOffset.x *= offsetDecay;
    predictionOffset.y *= offsetDecay;
    if (Math.hypot(predictionOffset.x, predictionOffset.y) < .01) {
      predictionOffset.x = 0;
      predictionOffset.y = 0;
    }
    const visualTarget = {
      x: Math.max(PLAYER_RADIUS, Math.min(assets.world.width - PLAYER_RADIUS, projected.x + predictionOffset.x)),
      y: Math.max(PLAYER_RADIUS, Math.min(assets.world.height - PLAYER_RADIUS, projected.y + predictionOffset.y)),
    };
    // Render from a frame-by-frame integration of immediate input. The fixed
    // 30 Hz prediction remains authoritative for networking and replay, while
    // this continuous path prevents a newly pressed strafe key from appearing
    // to have moved the player for the entire preceding simulation slice.
    const visualIntegrated = applyMovement(visualPredicted || visualTarget, sample, delta, player);
    visualPredicted = convergeVisualPosition(visualIntegrated, visualTarget, delta, turboActive(player) ? 6 : 8);
  }
  renderer.render(snapshot || latestSnapshot, localId, visualPredicted || predicted, delta, input.getVisualState());
  fpsFrames++;
  if (now - fpsWindow >= 500) { fps = Math.round(fpsFrames * 1000 / (now - fpsWindow)); fpsFrames = 0; fpsWindow = now; updateHud(latestSnapshot); }
  requestAnimationFrame(frame);
}

addEventListener("keydown", (event) => {
  const debugPowerups = { Digit1: "spy", Digit2: "speed", Digit3: "health", Digit4: "shield", Digit5: "teleport", Digit6: "mole", Digit7: "fart" };
  if (debugCollision && !event.repeat && debugPowerups[event.code]) {
    event.preventDefault(); network.send({ type: "debug_powerup", powerup: debugPowerups[event.code] }); return;
  }
  if (debugCollision && !event.repeat && event.code === "KeyU") {
    event.preventDefault(); network.send({ type: "debug_nuke" }); return;
  }
  if (event.code === "KeyN" && !event.repeat) {
    event.preventDefault();
    const player = latestSnapshot?.players?.find((item) => item.id === localId);
    if (player?.nukeReady) nukeQueuedUntil = performance.now() + 800;
    return;
  }
  if (event.code === "KeyC") {
    debugCollision = !debugCollision;
    renderer.debug = debugCollision;
    debugHud.hidden = !debugCollision;
    if (!debugCollision) collisionEditor?.setActive(false);
  }
});
mobileNukeButton.addEventListener("pointerdown", (event) => {
  event.preventDefault(); event.stopPropagation();
  if (!mobileNukeButton.disabled) nukeQueuedUntil = performance.now() + 800;
});
document.addEventListener("visibilitychange", () => { input.reset(); input.enabled = connectionState === "online" && joined && !document.hidden; network.setActive(!document.hidden); if (!document.hidden) previousFrame = performance.now(); });
addEventListener("beforeunload", () => { identity.release(); network.close(); });

window.__DUSTY_ORBIT_MULTIPLAYER__ = { network, renderer, input, collisionEditor, getState: () => ({ connectionState, joined, localId, guestName, latestSnapshot, predicted, visualPredicted, predictionOffset: { ...predictionOffset }, pending: [...pending], seq, reconciliationError, maximumReconciliationError, input: input.getVisualState() }) };
network.connect(true);
requestAnimationFrame(frame);
