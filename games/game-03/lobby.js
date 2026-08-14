import { CHARACTER_SKINS, DEFAULT_CHARACTER_SKIN_ID, characterSkinById, enabledCharacterSkins } from "./character-skins.js?v=20260813";
import { RECRUITMENT_COOLDOWN_MS, normalizedOnlinePlayers, recruitmentCooldownRemaining } from "./presence.js?v=20260814";

const STORAGE_KEY = "poopcade.game03.skin";
const RECRUIT_STORAGE_KEY = "poopcade.game03.recruit-retry-at";

function score(value) {
  const number = Math.max(0, Number(value) || 0);
  return number > 0 ? `+${number}` : String(number);
}

export function formatSessionDuration(joinedAt, now = Date.now()) {
  const total = Math.max(0, Math.floor((now - Number(joinedAt || now)) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function initialSkinId(storage = globalThis.localStorage, registry = CHARACTER_SKINS) {
  let stored = "";
  try { stored = storage?.getItem(STORAGE_KEY) || ""; } catch {}
  return characterSkinById(stored, registry)?.id ?? enabledCharacterSkins(registry)[0]?.id ?? DEFAULT_CHARACTER_SKIN_ID;
}

export class DustyLobby {
  constructor(root, { playerName, authenticated, onJoin, onRetry, onSkinSelected, onRecruit }) {
    this.root = root;
    this.onJoin = onJoin;
    this.onRetry = onRetry;
    this.onSkinSelected = onSkinSelected;
    this.onRecruit = onRecruit;
    this.selectedSkinId = initialSkinId();
    this.state = "LOBBY";
    this.connectionState = "connecting";
    this.connectionDetail = "";
    this.lobbyState = { players: [], lobbyPlayers: [], activePlayers: 0, maxPlayers: 15, full: false, serverTime: Date.now() };
    this.clockOffset = 0;
    this.name = root.querySelector("[data-lobby-player-name]");
    this.name.textContent = playerName;
    root.querySelector("[data-lobby-identity]").textContent = authenticated ? "POOPCADE PROFILE" : "GUEST PILOT";
    this.cards = root.querySelector("[data-skin-cards]");
    this.preview = root.querySelector("[data-skin-preview]");
    this.previewName = root.querySelector("[data-preview-name]");
    this.previewDescription = root.querySelector("[data-preview-description]");
    this.roster = root.querySelector("[data-lobby-roster]");
    this.waitingRoster = root.querySelector("[data-lobby-waiting-roster]");
    this.waitingCount = root.querySelector("[data-lobby-player-count]");
    this.arenaCount = root.querySelector("[data-arena-player-count]");
    this.count = root.querySelector("[data-player-count]");
    this.onlineCount = root.querySelector("[data-online-count]");
    this.status = root.querySelector("[data-arena-status]");
    this.statusCopy = root.querySelector("[data-arena-status-copy]");
    this.join = root.querySelector("[data-join-arena]");
    this.recruit = root.querySelector("[data-recruit-players]");
    try { this.recruitRetryAt = Number(localStorage.getItem(RECRUIT_STORAGE_KEY)) || 0; } catch { this.recruitRetryAt = 0; }
    addEventListener("storage", (event) => {
      if (event.key !== RECRUIT_STORAGE_KEY) return;
      this.recruitRetryAt = Number(event.newValue) || 0;
      this.updateRecruitButton();
    });
    this.recruit.addEventListener("click", () => {
      if (this.recruit.disabled || this.onRecruit?.() === false) return;
      this.setRecruitRetryAt(Date.now() + RECRUITMENT_COOLDOWN_MS);
    });
    this.join.addEventListener("click", () => {
      if (["lost", "failed"].includes(this.connectionState)) {
        this.setConnectionState("connecting");
        this.onRetry?.();
        return;
      }
      if (this.join.disabled) return;
      this.setApplicationState("JOINING");
      this.onJoin(this.selectedSkinId);
    });
    this.renderSkinCards();
    this.selectSkin(this.selectedSkinId);
    this.timer = setInterval(() => { this.updateDurations(); this.updateRecruitButton(); }, 1000);
  }

  renderSkinCards() {
    this.cards.replaceChildren();
    for (const skin of enabledCharacterSkins()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "skin-card";
      button.dataset.skinId = skin.id;
      button.setAttribute("aria-label", `Select ${skin.displayName}`);
      const image = document.createElement("img");
      image.src = skin.sprite;
      image.alt = "";
      image.loading = skin.id === this.selectedSkinId ? "eager" : "lazy";
      image.style.setProperty("--card-scale", String(skin.visual.lobbyScale || 1));
      const copy = document.createElement("span");
      copy.innerHTML = `<strong>${skin.displayName}</strong><small>${skin.description}</small>`;
      button.append(image, copy);
      button.addEventListener("click", () => this.selectSkin(skin.id));
      this.cards.append(button);
    }
  }

  selectSkin(id) {
    const skin = characterSkinById(id) || characterSkinById(DEFAULT_CHARACTER_SKIN_ID);
    if (!skin) return;
    this.selectedSkinId = skin.id;
    try { localStorage.setItem(STORAGE_KEY, skin.id); } catch {}
    this.cards.querySelectorAll("[data-skin-id]").forEach((card) => {
      const selected = card.dataset.skinId === skin.id;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    });
    this.preview.src = skin.sprite;
    this.preview.alt = skin.displayName;
    this.preview.style.setProperty("--preview-scale", String(skin.visual.lobbyScale || 1));
    this.previewName.textContent = skin.displayName;
    this.previewDescription.textContent = skin.description;
    this.onSkinSelected?.(skin.id);
  }

  setConnectionState(state, detail = "") {
    this.connectionState = state;
    this.connectionDetail = detail;
    this.renderStatus();
  }

  setApplicationState(state) {
    this.state = state;
    this.renderStatus();
  }

  update(state) {
    this.lobbyState = state;
    if (Number.isFinite(state.serverTime)) this.clockOffset = Date.now() - state.serverTime;
    this.count.textContent = `${state.activePlayers} / ${state.maxPlayers}`;
    this.waitingCount.textContent = String(state.lobbyPlayers?.length || 0);
    this.arenaCount.textContent = String(state.activePlayers || 0);
    this.onlineCount.textContent = String(normalizedOnlinePlayers(state.onlinePlayers));
    this.waitingRoster.replaceChildren();
    if (!state.lobbyPlayers?.length) {
      this.waitingRoster.append(this.emptyRoster("No one waiting yet. Be the bait."));
    } else {
      for (const player of state.lobbyPlayers) this.waitingRoster.append(this.waitingPlayerCard(player));
    }
    this.roster.replaceChildren();
    if (!state.players?.length) {
      this.roster.append(this.emptyRoster("Arena empty. Start something regrettable."));
    } else {
      for (const player of state.players) this.roster.append(this.playerCard(player));
    }
    this.renderStatus();
  }

  emptyRoster(message) {
    const empty = document.createElement("p");
    empty.className = "roster-empty";
    empty.textContent = message;
    return empty;
  }

  waitingPlayerCard(player) {
    const article = document.createElement("article");
    article.className = "waiting-player";
    article.dataset.waitingSince = String(player.waitingSince || 0);
    const name = document.createElement("strong");
    name.textContent = player.name;
    const time = document.createElement("span");
    time.dataset.waitingTime = "";
    time.textContent = `READY ${formatSessionDuration(player.waitingSince, Date.now() - this.clockOffset)}`;
    article.append(name, time);
    return article;
  }

  playerCard(player) {
    const skin = characterSkinById(player.skinId) || characterSkinById(DEFAULT_CHARACTER_SKIN_ID);
    const article = document.createElement("article");
    article.className = "roster-player";
    article.dataset.joinedAt = String(player.joinedAt);
    const image = document.createElement("img");
    image.src = skin.sprite;
    image.alt = "";
    image.loading = "lazy";
    const identity = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = player.name;
    const character = document.createElement("small");
    character.textContent = skin.displayName;
    identity.append(name, character);
    const scoreBlock = document.createElement("div");
    scoreBlock.className = "roster-stat";
    scoreBlock.innerHTML = `<span>SCORE</span><strong>${score(player.killScore)}</strong>`;
    const time = document.createElement("div");
    time.className = "roster-stat";
    time.innerHTML = `<span>SESSION</span><strong data-session-time>${formatSessionDuration(player.joinedAt, Date.now() - this.clockOffset)}</strong>`;
    article.append(image, identity, scoreBlock, time);
    return article;
  }

  updateDurations() {
    const serverNow = Date.now() - this.clockOffset;
    this.roster.querySelectorAll("[data-joined-at]").forEach((row) => {
      const output = row.querySelector("[data-session-time]");
      if (output) output.textContent = formatSessionDuration(Number(row.dataset.joinedAt), serverNow);
    });
    this.waitingRoster.querySelectorAll("[data-waiting-since]").forEach((row) => {
      const output = row.querySelector("[data-waiting-time]");
      if (output) output.textContent = `READY ${formatSessionDuration(Number(row.dataset.waitingSince), serverNow)}`;
    });
  }

  setRecruitRetryAt(retryAt) {
    this.recruitRetryAt = Number(retryAt) || 0;
    try { localStorage.setItem(RECRUIT_STORAGE_KEY, String(this.recruitRetryAt)); } catch {}
    this.updateRecruitButton();
  }

  recruitmentStatus(message) {
    if (Number.isFinite(message?.retryAt)) this.setRecruitRetryAt(message.retryAt);
  }

  updateRecruitButton() {
    const remaining = recruitmentCooldownRemaining(this.recruitRetryAt);
    const offline = this.connectionState !== "online";
    this.recruit.disabled = offline || remaining > 0;
    this.recruit.textContent = remaining > 0
      ? `AIRLOCK RATTLED · AGAIN IN ${remaining}s`
      : offline ? "FINDING OTHER BAD INFLUENCES…" : "RATTLE THE AIRLOCK · FIND PLAYERS";
  }

  renderStatus() {
    const full = Boolean(this.lobbyState.full);
    const connecting = this.connectionState === "connecting";
    const disconnected = ["lost", "failed"].includes(this.connectionState) || this.state === "DISCONNECTED";
    this.root.dataset.state = connecting ? "CONNECTING" : disconnected ? "DISCONNECTED" : full ? "FULL" : this.state;
    if (connecting) {
      this.status.textContent = "CONNECTING";
      this.statusCopy.textContent = "Contacting the questionable authorities…";
      this.join.textContent = "CONNECTING…";
      this.join.disabled = true;
    } else if (disconnected) {
      this.status.textContent = "CONNECTION LOST";
      this.statusCopy.textContent = this.connectionDetail || "The arena wandered off. Give it another shove.";
      this.join.textContent = "RETRY CONNECTION";
      this.join.disabled = false;
    } else if (full) {
      this.status.textContent = "ARENA FULL";
      this.statusCopy.textContent = "Apparently everyone had the same terrible idea.";
      this.join.textContent = "ARENA FULL";
      this.join.disabled = true;
    } else if (this.state === "JOINING") {
      this.status.textContent = "DUSTY ORBIT // LIVE";
      this.statusCopy.textContent = "Negotiating one questionable life choice…";
      this.join.textContent = "JOINING…";
      this.join.disabled = true;
    } else {
      this.status.textContent = "DUSTY ORBIT // LIVE";
      this.statusCopy.textContent = "One arena. Zero adult supervision.";
      this.join.textContent = "JOIN THE CHAOS";
      this.join.disabled = false;
    }
    this.updateRecruitButton();
  }

  show() { this.root.hidden = false; document.documentElement.classList.add("lobby-visible"); }
  hide() { this.root.hidden = true; document.documentElement.classList.remove("lobby-visible"); }
}
