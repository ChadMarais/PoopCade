import { createPolygonBroadphase, moveCircleWithSliding } from "./collision-geometry.js?v=20260817-5";
import { CollisionEditor } from "./collision-editor.js?v=20260817-17";
import { loadDustyOrbitAssets } from "./assets.js?v=20260817-7";
import { PRODUCTION_ARENA_WSS } from "./config.js?v=20260812";
import { MAP_CATALOG, mapCatalogEntry } from "./maps/catalog.js?v=20260817-4";
import { DustyOrbitMultiplayerRenderer } from "./renderer.js?v=20260817-10";
import { InputController } from "./input.js?v=20260817-1";
import { claimSessionIdentity, resolvePoopcadePlayerIdentity } from "./identity.js?v=20260813-2";
import { ArenaNetwork } from "./network.js?v=20260817-1";
import { consumeFixedStep, convergeVisualPosition } from "./timing.js?v=20260813-2";
import { DustyLobby } from "./lobby.js?v=20260817-4";
import { presenceEndpoint, RECRUITMENT_HREF } from "./presence.js?v=20260817-1";
import { DustyOrbitHighscoreTracker } from "./highscore.js?v=20260813-2";
import { DustyOrbitAudio } from "./audio.js?v=20260817-5";
import { makePanelDraggable } from "./draggable-panel.js?v=20260814-4";

const INPUT_RATE = 30;
const INPUT_DT = 1 / INPUT_RATE;
const PLAYER_RADIUS = 17;
const FALLBACK_PLAYER_SPEED = 165;
const parameters = new URLSearchParams(location.search);
const selectedMap = mapCatalogEntry(parameters.get("map"));
const selectedMapDefinition = await import(`${selectedMap.moduleUrl}?v=20260817-4`);
const ARENA_ID = selectedMap.arenaId;
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
  // A plain static preview should remain playable without requiring Wrangler.
  // Local Worker development is opt-in so an absent port 8787 cannot strand
  // the lobby in a permanent retry loop.
  // Debug/map-authoring sessions must use the matching local authoritative
  // simulation. Pointing new map geometry at the older production Worker
  // makes prediction stop at an object while reconciliation pulls the player
  // through it, and production cannot activate newly authored stations.
  const localWorkerRequested = parameters.get("local") === "1" || debugMode || location.port === "8081";
  if (local && localWorkerRequested) {
    const workerHostname = location.hostname === "localhost" ? "127.0.0.1" : location.hostname;
    return `ws://${workerHostname}:8787/arena/${ARENA_ID}/ws${parameters.get("debug") === "1" ? "?debug=1" : ""}`;
  }
  const productionBase = PRODUCTION_ARENA_WSS.trim().replace(/\/$/, "");
  return /^wss:\/\/[^/]+$/i.test(productionBase) ? `${productionBase}/arena/${ARENA_ID}/ws` : "";
}

const identity = await claimSessionIdentity();
const { sessionId, guestName } = identity;
const poopcadeIdentity = await resolvePoopcadePlayerIdentity(guestName);
const { playerName, accessToken, authenticated } = poopcadeIdentity;
const scoreApi = authenticated ? await import("/js/poopcade-api.js").catch(() => null) : null;
const guestAnalytics = authenticated ? null : await import("/js/guest-analytics.js").catch(() => null);
const canvas = document.querySelector("#world");
const loading = document.querySelector("#loading");
const loadingBar = document.querySelector("#loadingBar");
const loadingText = document.querySelector("#loadingText");
const connection = document.querySelector("#connection");
const debugHud = document.querySelector("#debugHud");
const events = document.querySelector("#events");
const arcadeCallout = document.querySelector("#arcadeCallout");
const gameplayHud = document.querySelector("#gameplayHud");
const mobileFireLabel = document.querySelector("#mobileFireButton .mobile-fire-label");
const mobileNukeButton = document.querySelector("#mobileNukeButton");
const leaveGame = document.querySelector("#leaveGame");
const titlePanel = document.querySelector(".title");
titlePanel.hidden = debugMode;
gameplayHud.hidden = debugMode;
if (parameters.has("devtest")) {
  parameters.delete("devtest");
  const remaining = parameters.toString();
  history.replaceState(null, "", `${location.pathname}${remaining ? `?${remaining}` : ""}${location.hash}`);
}
document.querySelector("#homeLink").href = "/";
document.querySelector("[data-lobby-home]").href = "/";
titlePanel.append(leaveGame);
debugHud.hidden = !debugCollision;
if (debugMode) makePanelDraggable(debugHud);
const arenaEndpoint = endpoint();
if (!arenaEndpoint) {
  loadingText.textContent = "Production multiplayer endpoint is not configured.";
  connection.textContent = "CONFIG REQUIRED";
  throw new Error("Set PRODUCTION_ARENA_WSS in games/game-03/config.js before production deployment.");
}
document.querySelector("[data-current-map-name]").textContent = selectedMap.name;
const assets = await loadDustyOrbitAssets(selectedMapDefinition, (message, amount) => { loadingText.textContent = message; loadingBar.style.width = `${amount * 100}%`; });
assets.movementBroadphase = createPolygonBroadphase(assets.polygons);
assets.boundaryBroadphase = createPolygonBroadphase(assets.boundaryPolygons);
assets.projectileBroadphase = createPolygonBroadphase(assets.projectilePolygons);
function preloadCharacterSkin(skinId) { void assets.ensureCharacterSkin(skinId).catch(() => {}); }
loadingBar.style.width = "100%";
const focusSatellite = parameters.get("focus") === "satellite-east" ? assets.satellites[1] : assets.satellites[0];
const debugFocus = debugCollision
  ? parameters.get("focus") === "center"
    ? { x: assets.world.width / 2, y: assets.world.height / 2 }
    : parameters.get("focus")?.startsWith("satellite") ? focusSatellite : null
  : null;
const renderer = new DustyOrbitMultiplayerRenderer(canvas, assets, debugCollision, debugFocus);
const audio = new DustyOrbitAudio({
  getListener: () => visualPredicted || predicted || latestSnapshot?.players?.find((player) => player.id === localId),
  world: assets.world,
});
const unlockAudio = () => { void audio.unlock(); };
window.addEventListener("pointerdown", unlockAudio, { capture: true, passive: true });
window.addEventListener("touchstart", unlockAudio, { capture: true, passive: true });
window.addEventListener("keydown", unlockAudio, { capture: true });
canvas.addEventListener("dusty-orbit:weapon-fired", (event) => audio.weaponFired(event.detail));
canvas.addEventListener("dusty-orbit:nuke-audio-cue", (event) => { if (event.detail?.cue === "detonation") audio.nuke(event.detail); });
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
  mode: document.querySelector("#collisionEditorMode"),
  projectilePassthrough: document.querySelector("#collisionEditorProjectilePassthrough"),
  importInput: document.querySelector("#collisionEditorImportInput"),
  importButton: document.querySelector("#collisionEditorImport"),
  toggle: document.querySelector("#collisionEditorToggle"),
  copy: document.querySelector("#collisionEditorCopy"),
  save: document.querySelector("#collisionEditorSave"),
  reset: document.querySelector("#collisionEditorReset"),
  remove: document.querySelector("#collisionEditorDelete"),
  addPoint: document.querySelector("#collisionEditorAddPoint"),
  deleteObject: document.querySelector("#collisionEditorDeleteObject"),
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
  collisionEditor.setActive(true);
  makePanelDraggable(collisionEditor.panel, collisionEditor.panel.querySelector(".collision-editor-header"));
}

let connectionState = "connecting";
let applicationState = "LOBBY";
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
let fireProtocol = null;
let localGeneratedWeapon = null;
let localGeneratedWeaponState = null;
let gameplay = { baseMovementSpeed: FALLBACK_PLAYER_SPEED, speedMultiplier: 2, nukeRequirement: 10 };
let latestAim = { x: 1, y: 0 };
let reconciliationError = 0;
let maximumReconciliationError = 0;
const eventLines = [];
let nukeQueuedUntil = 0;
let localSpeedBoostUntil = 0;
let network;
let presenceNetwork;
let autoJoinRequested = parameters.get("autojoin") === "1";
let resumeAfterReconnect = false;
let highscoreStatus = authenticated ? "READY" : "SIGN IN TO SAVE";
const recruitmentToast = document.querySelector("[data-recruitment-toast]");
const recruitmentCopy = recruitmentToast.querySelector("[data-recruitment-copy]");
let recruitmentToastTimer = 0;
function showRecruitment(message) {
  if (typeof message?.message !== "string") return;
  recruitmentToast.href = typeof message.href === "string" ? message.href : RECRUITMENT_HREF;
  recruitmentCopy.textContent = message.message;
  recruitmentToast.hidden = false;
  recruitmentToast.classList.remove("show");
  void recruitmentToast.offsetWidth;
  recruitmentToast.classList.add("show");
  clearTimeout(recruitmentToastTimer);
  recruitmentToastTimer = setTimeout(() => { recruitmentToast.classList.remove("show"); recruitmentToast.hidden = true; }, 12_000);
}
const highscoreTracker = new DustyOrbitHighscoreTracker({
  authenticated,
  submit: scoreApi?.submitDustyOrbitRun,
  recordGuest: guestAnalytics?.recordRun,
  onStatus(status) { highscoreStatus = status; },
});

function joinSelectedMap(skinId) {
  if (lobby.selectedMapId !== selectedMap.id) {
    navigateToMap(lobby.selectedMapId, true);
    return;
  }
  applicationState = "JOINING";
  if (!network.send({ type: "join", name: playerName, skinId, ...(accessToken ? { accessToken } : {}) })) {
    applicationState = "DISCONNECTED";
    lobby.setApplicationState(applicationState);
  }
}
function navigateToMap(mapId, autoJoin = false) {
  const destination = new URL(location.href);
  destination.searchParams.set("map", mapId);
  if (autoJoin) {
    destination.searchParams.set("autojoin", "1");
    lobby.hide();
    loadingText.textContent = "SWITCHING ARENA · JOINING NEBULA MURDERBALL…";
    loading.classList.remove("done");
  }
  else destination.searchParams.delete("autojoin");
  location.assign(destination);
}
const lobby = new DustyLobby(document.querySelector("#lobby"), {
  playerName,
  authenticated,
  maps: MAP_CATALOG,
  selectedMapId: selectedMap.id,
  onJoin: joinSelectedMap,
  onRetry() { network.connect(true); },
  onSkinSelected(skinId) { preloadCharacterSkin(skinId); },
  onRecruit() { return presenceNetwork?.send({ type: "recruit", mapId: lobby.selectedMapId }) === true; },
  onMapSelected(mapId) {
    const destination = new URL(location.href);
    destination.searchParams.set("map", mapId);
    destination.searchParams.delete("autojoin");
    history.replaceState(null, "", destination);
  },
  onQuickJoin(mapId, skinId) {
    if (mapId === selectedMap.id) joinSelectedMap(skinId);
    else navigateToMap(mapId, true);
  },
});
if (autoJoinRequested) {
  lobby.hide();
  loadingText.textContent = "SWITCHING ARENA · JOINING NEBULA MURDERBALL…";
} else {
  lobby.show();
  loading.classList.add("done");
}

function mapDirectoryEndpoint() {
  const url = new URL(arenaEndpoint);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/maps";
  url.search = "";
  return url.href;
}
async function refreshMapDirectory() {
  try {
    const response = await fetch(mapDirectoryEndpoint(), { cache: "no-store" });
    if (!response.ok) return;
    const directory = await response.json();
    lobby.updateMaps(directory.maps);
  } catch {}
}
void refreshMapDirectory();
const mapDirectoryTimer = setInterval(refreshMapDirectory, 10_000);
addEventListener("pagehide", () => clearInterval(mapDirectoryTimer), { once: true });

function addEvent(text) { eventLines.unshift(text); eventLines.splice(6); events.textContent = eventLines.join("\n"); }
let arcadeCalloutTimer = 0;
function showArcadeCallout(text) {
  clearTimeout(arcadeCalloutTimer);
  arcadeCallout.classList.remove("weapon-reveal", "rating-dud", "rating-average", "rating-legendary");
  arcadeCallout.textContent = text;
  arcadeCallout.classList.remove("show");
  requestAnimationFrame(() => arcadeCallout.classList.add("show"));
  arcadeCalloutTimer = setTimeout(() => arcadeCallout.classList.remove("show"), 2400);
}
function showWeaponReveal(weapon) {
  clearTimeout(arcadeCalloutTimer);
  const rating = ["DUD", "AVERAGE", "LEGENDARY"].includes(String(weapon?.rarity)) ? String(weapon.rarity) : "AVERAGE";
  const displayRating = rating === "AVERAGE" ? "COMMON" : rating;
  const name = typeof weapon?.name === "string" && weapon.name ? weapon.name : "MYSTERY GUN";
  const title = document.createElement("strong");
  title.className = "weapon-reveal-name";
  title.textContent = name;
  const grade = document.createElement("span");
  grade.className = "weapon-reveal-rating";
  grade.textContent = rating === "LEGENDARY" ? "★ LEGENDARY ★" : displayRating;
  arcadeCallout.replaceChildren(grade, title);
  arcadeCallout.classList.remove("show", "rating-dud", "rating-average", "rating-legendary");
  arcadeCallout.classList.add("weapon-reveal", `rating-${rating.toLowerCase()}`);
  requestAnimationFrame(() => arcadeCallout.classList.add("show"));
  arcadeCalloutTimer = setTimeout(() => arcadeCallout.classList.remove("show"), rating === "LEGENDARY" ? 4200 : 3000);
}

network = new ArenaNetwork({
  url: arenaEndpoint, sessionId, name: playerName,
  onState(state, detail) {
    const interruptedGameplay = joined || applicationState === "PLAYING" || resumeAfterReconnect;
    connectionState = state;
    lobby.setConnectionState(state, detail);
    connection.textContent = state === "online" ? "● ONLINE" : `${state.toUpperCase()}${detail ? ` · ${detail}` : ""}`;
    connection.classList.toggle("online", state === "online");
    if (state !== "online") {
      resumeAfterReconnect = interruptedGameplay && state !== "failed";
      joined = false;
      fireProtocol = null;
      input.reset();
      pending = [];
      renderer.clearLocalShotHistory();
      sendAccumulator = 0;
      inputStepTimes.length = 0;
      localSpeedBoostUntil = 0;
      if (resumeAfterReconnect) {
        applicationState = "PLAYING";
        lobby.hide();
      } else if (autoJoinRequested && state === "connecting") {
        applicationState = "JOINING";
        lobby.setApplicationState(applicationState);
        lobby.hide();
      } else {
        if (autoJoinRequested) {
          autoJoinRequested = false;
          loading.classList.add("done");
        }
        highscoreTracker.reset();
        applicationState = state === "connecting" ? "CONNECTING" : "DISCONNECTED";
        lobby.setApplicationState(applicationState);
        lobby.show();
      }
    } else if (!joined) {
      if (resumeAfterReconnect) {
        applicationState = "PLAYING";
        lobby.hide();
      } else if (autoJoinRequested || applicationState === "JOINING") {
        applicationState = "JOINING";
        lobby.setApplicationState(applicationState);
        lobby.hide();
      } else {
        applicationState = "LOBBY";
        lobby.setApplicationState(applicationState);
        lobby.show();
      }
    }
    // A TCP/WebSocket open is not yet an arena join. Waiting for welcome
    // prevents pre-handshake input from racing the server's restored sequence.
    input.enabled = state === "online" && joined && !document.hidden;
    if (!loading.classList.contains("done")) {
      if (state === "online") loadingText.textContent = "CONNECTED · JOINING NEBULA MURDERBALL…";
      else if (state === "connecting") loadingText.textContent = "CONNECTING TO LOCAL MULTIPLAYER…";
      else loadingText.textContent = `${state === "failed" ? "MULTIPLAYER UNAVAILABLE" : "CONNECTION LOST · RETRYING"}${detail ? ` · ${detail}` : ""}`;
    }
  },
  onMessage(message) {
    if (message.type === "lobby_state") {
      lobby.update(message);
      if (resumeAfterReconnect && !joined && applicationState !== "JOINING") {
        joinSelectedMap(lobby.selectedSkinId);
        return;
      }
      if (autoJoinRequested && message.full) {
        autoJoinRequested = false;
        const cleanUrl = new URL(location.href);
        cleanUrl.searchParams.delete("autojoin");
        history.replaceState(null, "", cleanUrl);
        loading.classList.add("done");
        lobby.show();
      } else if (autoJoinRequested && !joined) {
        autoJoinRequested = false;
        const cleanUrl = new URL(location.href);
        cleanUrl.searchParams.delete("autojoin");
        history.replaceState(null, "", cleanUrl);
        joinSelectedMap(lobby.selectedSkinId);
      }
      if (!joined && applicationState !== "JOINING") {
        applicationState = message.full ? "FULL" : "LOBBY";
        lobby.setApplicationState(applicationState);
      }
      return;
    }
    if (message.type === "join_rejected") {
      resumeAfterReconnect = false;
      joined = false;
      applicationState = message.reason === "ARENA_FULL" ? "FULL" : "LOBBY";
      lobby.setApplicationState(applicationState);
      loading.classList.add("done");
      lobby.show();
      return;
    }
    if (message.type === "leave_confirmed") { completeLeaveToLobby(); return; }
    if (message.type === "recruitment_status") { lobby.recruitmentStatus(message); return; }
    if (message.type === "recruitment") { showRecruitment(message); return; }
    if (message.type === "welcome") {
      if (leavePending) { network.send({ type: "leave" }); return; }
      preloadCharacterSkin(message.player?.skinId);
      localId = message.playerId;
      serverRates = message.rates || serverRates;
      fireProtocol = message.fireProtocol === "intent-v1" ? "intent-v1" : null;
      weaponDefinitions = Array.isArray(message.weapons) && message.weapons.length ? message.weapons : weaponDefinitions;
      localGeneratedWeapon = null;
      localGeneratedWeaponState = null;
      gameplay = { ...gameplay, ...(message.gameplay || {}) };
      seq = Number.isSafeInteger(message.player?.lastInputSeq) ? message.player.lastInputSeq : 0;
      pending = [];
      renderer.clearLocalShotHistory(message.player?.lastFireIntentId);
      sendAccumulator = 0;
      inputStepTimes.length = 0;
      localSpeedBoostUntil = 0;
      input.reset();
      if (finitePoint(message.player)) {
        resetPredictionTo(message.player);
        renderer.prewarmStaticWorldAt(message.player);
      }
      joined = true;
      resumeAfterReconnect = false;
      applicationState = "PLAYING";
      lobby.setApplicationState(applicationState);
      lobby.hide();
      input.enabled = !document.hidden;
      addEvent(`JOINED ${message.arenaId} AS ${playerName}`);
      loading.classList.add("done");
      document.documentElement.classList.remove("arena-transition");
      canvas.focus({ preventScroll: true });
      return;
    }
    if (message.type === "snapshot") {
      for (const player of message.players || []) preloadCharacterSkin(player.skinId);
      latestSnapshot = message;
      const localPlayer = message.players?.find((item) => item.id === localId);
      localGeneratedWeapon = localPlayer?.randomWeapon && message.you?.weapon?.generated ? message.you.weapon : null;
      localGeneratedWeaponState = localGeneratedWeapon ? message.you?.weaponState : null;
      highscoreTracker.observe(message.players?.find((item) => item.id === localId));
      reconcile(message); return;
    }
    if (message.type === "shot") {
      const localShot = message.playerId === localId;
      if (localShot) input.acknowledgeFire();
      renderer.confirmShot(message, localShot);
    }
    if (message.type === "impact") { network.discardProjectile(message.projectileId); renderer.impact(message); }
    if (message.type === "shield_hit") { renderer.shieldHit(message); addEvent(message.playerId === localId ? "SHIELD ABSORBED A HIT" : "SHIELD HIT"); }
    if (message.type === "teleport") {
      renderer.teleport(message);
      audio.teleport(message);
      if (message.playerId === localId && finitePoint(message)) resetPredictionTo(message);
    }
    if (message.type === "mole_burrowed") renderer.moleBurrowed(message);
    if (message.type === "mole_emerged") renderer.moleEmerged(message);
    if (message.type === "fart_cloud") renderer.fartCloud(message, message.ownerId === localId);
    if (message.type === "mole_blocked" && message.playerId === localId) { renderer.blocked(); addEvent("EMERGENCE BLOCKED · MOVE OFF THE ROCK"); }
    if (message.type === "powerup_collected") {
      audio.powerupCollected(message.powerup, message);
      if (message.playerId === localId) {
        if (message.powerup === "speed") localSpeedBoostUntil = performance.now() + Math.max(0, Number(gameplay.speedDurationMs) || 0);
        addEvent(`PICKED UP ${String(message.powerup).toUpperCase()}`);
      }
    }
    if (message.type === "station_heal") {
      audio.powerupCollected("health", message);
      if (message.playerId === localId) addEvent(`HEALING STATION · +1 HP · ${message.hp}/3`);
    }
    if (message.type === "weapon_generation_started" && message.playerId === localId) addEvent("RANDOM WEAPON GENERATOR · CREATING WEAPON · 5.0s");
    if (message.type === "weapon_generation_cancelled" && message.playerId === localId) addEvent("WEAPON GENERATION CANCELLED · STAY CLOSE");
    if (message.type === "fire_intent_rejected" && message.playerId === localId) {
      renderer.rejectLocalFireIntent(message.fireIntentId);
      return;
    }
    if (message.type === "weapon_generated" && message.playerId === localId) {
      const weapon = message.weapon || {};
      localGeneratedWeapon = weapon;
      localGeneratedWeaponState = message.weaponState || null;
      renderer.resetLocalFirePrediction();
      const callout = `${weapon.name || "GENERATED"} · ${weapon.rarity || "AVERAGE"} WEAPON`;
      showWeaponReveal(weapon);
      addEvent(`${callout} · GENERATOR COOLING DOWN 10s`);
    }
    if (message.type === "nuke_warning") { renderer.nukeWarning(message); if (message.ownerId === localId) nukeQueuedUntil = 0; addEvent("NUKE INCOMING"); }
    if (message.type === "nuke_detonated") renderer.nukeDetonated(message);
    if (message.type === "player_hit") { renderer.playerHit(message.playerId); addEvent(`${message.playerId === localId ? "YOU" : "PLAYER"} HIT · ${message.hp} HP`); }
    if (message.type === "kill") addEvent(`${message.killerName} ELIMINATED ${message.victimName}`);
    if (message.type === "collision_kill" && Array.isArray(message.playerIds) && message.playerIds.includes(localId)) {
      const callout = String(message.callout || "DEMOLITION DERBY · INSURANCE DENIED");
      showArcadeCallout(callout);
      addEvent(callout);
    }
    if (message.type === "death") {
      renderer.death(message);
      audio.death(message);
      if (message.victimId === localId) {
        localSpeedBoostUntil = 0;
        localGeneratedWeapon = null;
        localGeneratedWeaponState = null;
        renderer.resetLocalFirePrediction();
        addEvent(message.randomWeaponLost ? `RANDOM WEAPON LOST · RESTORING T${message.restoredWeaponTier}` : "YOU ARE DOWN · RESPAWNING IN 2s");
      }
    }
    if (message.type === "respawn") {
      renderer.respawn(message);
      if (message.playerId === localId) { resetPredictionTo(message); addEvent("RESPAWNED · 2s PROTECTION"); }
    }
    if (message.type === "player_joined") addEvent(`${message.player.name} JOINED`);
    if (message.type === "player_left") addEvent(`${message.player.name} LEFT`);
  },
});

presenceNetwork = new ArenaNetwork({
  url: presenceEndpoint(arenaEndpoint),
  sessionId,
  name: playerName,
  presence: "dusty",
  onState(state) { lobby.setRecruitmentConnectionState(state); },
  onMessage(message) {
    if (message.type === "lobby_state") { lobby.setOnlinePlayers(message.onlinePlayers); return; }
    if (message.type === "recruitment_status") { lobby.recruitmentStatus(message); return; }
    if (message.type === "recruitment") showRecruitment(message);
  },
});

function applyMovement(position, sample, duration, player) {
  if (!finitePoint(position) || !player?.alive) return position;
  const elapsed = Number.isFinite(duration) ? Math.max(0, Math.min(.1, duration)) : 0;
  const baseSpeed = Number.isFinite(gameplay.baseMovementSpeed) ? gameplay.baseMovementSpeed : FALLBACK_PLAYER_SPEED;
  const speed = baseSpeed * (turboActive(player) ? gameplay.speedMultiplier : 1);
  const predictionPolygons = player.moleMode ? assets.boundaryPolygons : assets.polygons;
  const predictionBroadphase = player.moleMode ? assets.boundaryBroadphase : assets.movementBroadphase;
  const next = moveCircleWithSliding(position, { x: finiteAxis(sample?.moveX) * speed * elapsed, y: finiteAxis(sample?.moveY) * speed * elapsed }, PLAYER_RADIUS, predictionPolygons, predictionBroadphase);
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

function currentWeaponDefinition(player) {
  if (localGeneratedWeapon) return localGeneratedWeapon;
  if (latestSnapshot?.you?.weapon) return latestSnapshot.you.weapon;
  if (player?.randomWeapon?.cooldownMs) return player.randomWeapon;
  return weaponDefinitions.find((item) => item.tier === player?.weaponTier) || weaponDefinitions[0];
}

function sendInput(sample, player) {
  const interpolationMs = Number.isFinite(serverRates.interpolationMs) ? serverRates.interpolationMs : 100;
  const viewAt = Math.max(0, Math.round(Date.now() - network.clockOffsetMs - interpolationMs));
  const message = { type: "input", seq: ++seq, moveX: finiteAxis(sample.moveX), moveY: finiteAxis(sample.moveY), aimX: finiteAxis(sample.aimX, 1), aimY: finiteAxis(sample.aimY), fire: Boolean(sample.fire), nuke: performance.now() < nukeQueuedUntil, viewAt };
  if (fireProtocol === "intent-v1") {
    message.fireMode = "intent-v1";
    message.fireIntents = renderer.prepareLocalInput(message, player, currentWeaponDefinition(player), {
      localNow: performance.now(),
      serverNow: Date.now() - network.clockOffsetMs,
      speedMultiplier: turboActive(player) ? gameplay.speedMultiplier : 1,
      weaponState: localGeneratedWeaponState || latestSnapshot?.you?.weaponState,
    });
  } else renderer.captureLocalInputPose(message);
  if (!network.sendInput(message)) {
    if (fireProtocol === "intent-v1") renderer.rollbackLocalInput(message.seq);
    return null;
  }
  if (fireProtocol === "intent-v1") {
    renderer.commitLocalInput(message.seq);
    // Clear a released mouse/touch tap as soon as its one trigger intent is
    // actually on the wire. A physically held pointer remains armed, so true
    // autofire continues without turning an 800 ms tap buffer into a burst.
    if (message.fireIntents.length) input.acknowledgeFire();
  }
  pending.push(message);
  if (pending.length > 90) pending.shift();
  return message;
}

function updateHud(snapshot) {
  const player = snapshot?.players?.find((item) => item.id === localId);
  const satellitePositions = assets.satellites.map((satellite) => `${satellite.id}: ${satellite.x},${satellite.y}`).join("  ·  ");
  const inputVisual = input.getVisualState();
  const remotes = (snapshot?.players || []).filter((item) => item.id !== localId);
  const remoteSummary = remotes.length
    ? remotes.map((item) => `${item.name} @ ${item.x.toFixed(0)},${item.y.toFixed(0)} AIM ${Math.atan2(item.aimY, item.aimX).toFixed(2)} HP${item.hp} T${item.weaponTier} S${item.killScore}`).join(" · ")
    : "NONE";
  const rendererDebug = renderer.getDebugState(localId);
  const weaponDebug = rendererDebug.weapon;
  const launchDebug = rendererDebug.lastLocalLaunch;
  const nukeDebug = rendererDebug.nuke;
  const weaponDebugLines = weaponDebug ? [
    `WEAPON: T${weaponDebug.tier} ${weaponDebug.id.toUpperCase()} · ROT ${(weaponDebug.rotation * 180 / Math.PI).toFixed(1)}°`,
    `PIVOT: ${weaponDebug.pivot.x.toFixed(2)},${weaponDebug.pivot.y.toFixed(2)} · ATTACH ${weaponDebug.attachmentWorld.x.toFixed(1)},${weaponDebug.attachmentWorld.y.toFixed(1)}`,
    `MUZZLE: ${weaponDebug.muzzleWorld.x.toFixed(1)},${weaponDebug.muzzleWorld.y.toFixed(1)}`,
  ] : ["WEAPON: HIDDEN"];
  if (launchDebug) weaponDebugLines.push(
    `LAST LAUNCH: ${launchDebug.muzzleWorld.x.toFixed(1)},${launchDebug.muzzleWorld.y.toFixed(1)} · FIRST-FRAME ERROR: ${launchDebug.firstRenderError?.toFixed(3) ?? "PENDING"}`,
  );
  const nukeDebugLines = nukeDebug ? [
    `NUKE STATE: ${nukeDebug.state}`,
    `NUKE X,Y: ${nukeDebug.x.toFixed(1)}, ${nukeDebug.y.toFixed(1)} / RADIUS: ${nukeDebug.radius.toFixed(1)}`,
    `NUKE EFFECT: ${nukeDebug.elapsed.toFixed(0)}ms / PARTICLES: ${nukeDebug.particles}`,
  ] : ["NUKE STATE: IDLE"];
  debugHud.textContent = [
    `CONNECTION: ${connectionState.toUpperCase()}  ·  ARENA: ${ARENA_ID}`,
    `LOCAL ID: ${localId.slice(0, 8)}…  ·  NAME: ${playerName}`,
    `PLAYERS: ${snapshot?.players?.length ?? 0}  ·  PING: ${network.rtt.toFixed(1)}ms`,
    `RATES: INPUT ${Math.min(INPUT_RATE, inputStepTimes.length)}/s · SNAP ${network.snapshotRate}/s · SERVER ${serverRates.tick}/${serverRates.snapshot}`,
    `TICK: ${snapshot?.tick ?? "—"}  ·  POS: ${player ? `${player.x.toFixed(1)}, ${player.y.toFixed(1)}` : "—"}`,
    `SATELLITES: ${satellitePositions || "—"}`,
    `SATELLITE CONNECTED: ${player?.satelliteConnected ? "YES" : "NO"}  ·  CONNECT DISTANCE: ${assets.satelliteConnection.connectTolerance}`,
    `NEAREST SATELLITE: ${snapshot?.you?.nearestSatelliteId || "—"}  ·  DISTANCE: ${Number.isFinite(snapshot?.you?.satelliteDistance) ? snapshot.you.satelliteDistance.toFixed(1) : "—"}`,
    `RADAR SOURCE: ${snapshot?.you?.radarSource || "NONE"}`,
    `AIM: ${latestAim.x.toFixed(2)}, ${latestAim.y.toFixed(2)}  ·  HP: ${player?.hp ?? "—"}/3  ·  KILLS: ${player?.kills ?? 0}`,
    ...weaponDebugLines,
    ...nukeDebugLines,
    `MOUSE: ${inputVisual.mouseCanvasX.toFixed(0)}, ${inputVisual.mouseCanvasY.toFixed(0)}  ·  MODE: ${inputVisual.mode.toUpperCase()}`,
    `REMOTE: ${remoteSummary}`,
    `PROJECTILES: ${snapshot?.projectiles?.length ?? 0}  ·  INPUT SEQ/ACK: ${seq}/${snapshot?.you?.ack ?? 0}`,
    `FIRE: ${inputVisual.fire ? "HELD/QUEUED" : "READY"}`,
    `PENDING: ${pending.length}  ·  CORRECTION: ${reconciliationError.toFixed(2)} (MAX ${maximumReconciliationError.toFixed(2)})`,
    `QUALITY: RENDER ${rendererDebug.quality.render.toFixed(2)} · EFFECTS ${rendererDebug.quality.effects.toFixed(2)} · FRAME ${rendererDebug.quality.frameMs.toFixed(1)}ms`,
    `FPS: ${fps}  ·  COLLISION: ${debugCollision ? "ON" : "OFF"}`,
  ].join("\n");

  const weapon = weaponDefinitions.find((item) => item.tier === player?.weaponTier) || weaponDefinitions[0];
  const effects = [];
  if (player?.spyRemaining > 0) effects.push(`SPY ${(player.spyRemaining / 1000).toFixed(1)}s`);
  if (player?.satelliteConnected) effects.push("UPLINK: ACTIVE");
  if (player?.healingStationConnected) {
    effects.push(player.healingInProgress
      ? `HEALING IN PROGRESS: +1 HP IN ${(Math.max(0, player.healingRemaining) / 1000).toFixed(1)}s`
      : "HEALING STATION: CONNECTED · HEALTH FULL");
  }
  if (player?.weaponGenerationInProgress) effects.push(`CREATING RANDOM WEAPON: ${(Math.max(0, player.weaponGenerationRemaining) / 1000).toFixed(1)}s · STAY CLOSE`);
  if (player?.speedRemaining > 0) effects.push(`SPEED ${(player.speedRemaining / 1000).toFixed(1)}s`);
  if (player?.moleMode) effects.push(`MOLE ${(player.moleRemaining / 1000).toFixed(1)}s${player.emergeBlocked ? " · BLOCKED" : ""}`);
  const equippedWeaponName = player?.randomWeapon?.name || weapon?.name || "PEA SHOOTER";
  gameplayHud.textContent = [
    `HP: ${"●".repeat(Math.max(0, player?.hp || 0))}${"○".repeat(Math.max(0, 3 - (player?.hp || 0)))}`,
    `SHIELD: ${player?.shieldHits ? "YES" : "NO"}`,
    `WEAPON: ${equippedWeaponName}`,
    `SCORE: ${player?.killScore ?? 0}`,
    `TOTAL PLAYERS: ${snapshot?.totalPlayers ?? snapshot?.players?.length ?? 0}`,
    `HIGHSCORE: ${highscoreStatus}`,
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
  let frameSample = null;
  let framePlayer = null;
  let sendFrameInput = false;
  if (connectionState === "online" && joined && !document.hidden && snapshot) {
    const player = latestSnapshot?.players?.find((item) => item.id === localId);
    framePlayer = player;
    if (!finitePoint(predicted) && finitePoint(player)) predicted = { x: player.x, y: player.y };
    input.setAimOrigin(renderer.getDebugState().playerScreen);
    const sample = input.sample(now);
    frameSample = sample;
    latestAim = { x: sample.aimX, y: sample.aimY };
    // Preserve the fractional remainder across frames. Resetting it to zero
    // made 72–80 Hz displays emit only 24–27 movement steps per second, which
    // was especially visible as pulsing motion during turbo boost.
    const timing = consumeFixedStep(sendAccumulator, delta, INPUT_DT);
    sendAccumulator = timing.remainder;
    if (timing.consumed) {
      predicted = applyMovement(predicted, sample, INPUT_DT, player);
      sendFrameInput = true;
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
  if (applicationState === "PLAYING") renderer.render(
    snapshot || latestSnapshot,
    localId,
    visualPredicted || predicted,
    delta,
    input.getVisualState(),
    sendFrameInput && frameSample ? () => {
      // drawPlayer() has produced the exact current muzzle before this callback;
      // prediction, transmission, flash, and the projectile now share one pose.
      if (sendInput(frameSample, framePlayer)) inputStepTimes.push(now);
    } : null,
  );
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
let leavePending = false;
function completeLeaveToLobby() {
  joined = false;
  resumeAfterReconnect = false;
  applicationState = "LOBBY";
  input.reset();
  input.enabled = false;
  pending = [];
  renderer.clearLocalShotHistory();
  predicted = null;
  visualPredicted = null;
  latestSnapshot = null;
  clearTimeout(arcadeCalloutTimer);
  arcadeCallout.classList.remove("show");
  lobby.setApplicationState(applicationState);
  lobby.show();
  leavePending = false;
  leaveGame.disabled = false;
  leaveGame.textContent = "LOBBY";
}
leaveGame.addEventListener("click", () => {
  if (!joined || !confirm("Leave the arena and return to the lobby?")) return;
  if (leavePending) return;
  leavePending = true;
  leaveGame.disabled = true;
  leaveGame.textContent = "LEAVING…";
  input.reset();
  input.enabled = false;
  const finalPlayer = latestSnapshot?.players?.find((item) => item.id === localId);
  if (!network.send({ type: "leave" })) {
    leavePending = false;
    leaveGame.disabled = false;
    leaveGame.textContent = "LOBBY";
    input.enabled = connectionState === "online" && joined && !document.hidden;
    return;
  }
  if (authenticated && finalPlayer) {
    highscoreStatus = "FINAL SAVE...";
    void Promise.race([
      highscoreTracker.flush(finalPlayer),
      new Promise((resolve) => setTimeout(() => resolve(false), 4_000)),
    ]).then((saved) => { if (!saved) highscoreStatus = "SERVER SAVE PENDING"; });
  }
});
document.addEventListener("visibilitychange", () => { input.reset(); input.enabled = connectionState === "online" && joined && !document.hidden; network.setActive(!document.hidden); if (!document.hidden) previousFrame = performance.now(); });
addEventListener("beforeunload", () => { identity.release(); network.close(); presenceNetwork.close(); });

window.__DUSTY_ORBIT_MULTIPLAYER__ = { network, presenceNetwork, renderer, input, collisionEditor, lobby, getState: () => ({ applicationState, connectionState, joined, localId, playerName, authenticated, latestSnapshot, predicted, visualPredicted, predictionOffset: { ...predictionOffset }, pending: [...pending], seq, reconciliationError, maximumReconciliationError, input: input.getVisualState() }) };
network.connect(true);
presenceNetwork.connect(true);
requestAnimationFrame(frame);
