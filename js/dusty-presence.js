import { PRODUCTION_ARENA_WSS } from "/games/game-03/config.js?v=20260812";
import { claimSessionIdentity, resolvePoopcadePlayerIdentity } from "/games/game-03/identity.js?v=20260813-2";
import { ArenaNetwork } from "/games/game-03/network.js?v=20260814-2";
import { RECRUITMENT_HREF, normalizedOnlinePlayers } from "/games/game-03/presence.js?v=20260814";

const ARENA_ID = "dusty-orbit-001";
const counters = [...document.querySelectorAll("[data-dusty-online-value]")];
const counterShells = [...document.querySelectorAll("[data-dusty-online]")];
const toast = document.querySelector("[data-dusty-recruitment-toast]");
const toastCopy = toast?.querySelector("[data-dusty-recruitment-copy]");
let toastTimer = 0;

function setCount(value, state = "online") {
  const count = normalizedOnlinePlayers(value);
  counters.forEach((element) => { element.textContent = state === "online" ? String(count) : "—"; });
  counterShells.forEach((element) => { element.dataset.state = state; });
}

function showRecruitment(message) {
  if (!toast || !toastCopy || typeof message?.message !== "string") return;
  toast.href = typeof message.href === "string" ? message.href : RECRUITMENT_HREF;
  toastCopy.textContent = message.message;
  toast.hidden = false;
  toast.classList.remove("show");
  void toast.offsetWidth;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove("show"); toast.hidden = true; }, 12_000);
}

const productionBase = PRODUCTION_ARENA_WSS.trim().replace(/\/$/, "");
const endpoint = /^wss:\/\/[^/]+$/i.test(productionBase) ? `${productionBase}/arena/${ARENA_ID}/ws` : "";
if (!endpoint) {
  setCount(0, "unavailable");
} else {
  const identity = await claimSessionIdentity();
  const profile = await resolvePoopcadePlayerIdentity(identity.guestName);
  const network = new ArenaNetwork({
    url: endpoint,
    sessionId: identity.sessionId,
    name: profile.playerName,
    presence: "home",
    onState(state) { if (["lost", "failed"].includes(state)) setCount(0, "unavailable"); },
    onMessage(message) {
      if (message.type === "lobby_state") setCount(message.onlinePlayers);
      if (message.type === "recruitment") showRecruitment(message);
    },
  });
  network.connect();
  addEventListener("pagehide", () => { network.close(); identity.release(); }, { once: true });
}
