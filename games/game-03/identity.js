const CHANNEL_NAME = "dusty-orbit-session-claims-v1";
const DEFAULT_CLAIM_WAIT_MS = 80;

export function createGuestName(cryptoApi = globalThis.crypto) {
  return `Guest-${String(cryptoApi.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, "0")}`;
}

function stored(storage, key, create) {
  let value = storage.getItem(key);
  if (!value) { value = create(); storage.setItem(key, value); }
  return value;
}

/**
 * sessionStorage survives refresh, but browsers are allowed to clone it into
 * duplicated/opener tabs. Claiming the ID among live tabs prevents two
 * sockets from ever controlling the same authoritative player.
 */
export async function claimSessionIdentity({
  storage = globalThis.sessionStorage,
  BroadcastChannelClass = globalThis.BroadcastChannel,
  cryptoApi = globalThis.crypto,
  waitMs = DEFAULT_CLAIM_WAIT_MS,
} = {}) {
  const identity = {
    sessionId: stored(storage, "dusty_orbit_mp_session", () => cryptoApi.randomUUID()),
    guestName: stored(storage, "dusty_orbit_mp_name", () => createGuestName(cryptoApi)),
  };
  if (typeof BroadcastChannelClass !== "function") return { ...identity, release() {} };

  const tabId = cryptoApi.randomUUID();
  let conflict = false;
  let channel;
  try { channel = new BroadcastChannelClass(CHANNEL_NAME); }
  catch { return { ...identity, release() {} }; }

  channel.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.tabId === tabId) return;
    if (message.type === "probe" && message.sessionId === identity.sessionId) {
      channel.postMessage({ type: "claimed", sessionId: identity.sessionId, tabId, targetTabId: message.tabId });
    } else if (message.type === "claimed" && message.targetTabId === tabId && message.sessionId === identity.sessionId) {
      conflict = true;
    }
  });

  // A simultaneous pair can both discover the clone. Regenerating each side
  // is safe because UUIDs remain distinct; retry once to close the race.
  for (let attempt = 0; attempt < 2; attempt++) {
    conflict = false;
    channel.postMessage({ type: "probe", sessionId: identity.sessionId, tabId });
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    if (!conflict) break;
    identity.sessionId = cryptoApi.randomUUID();
    identity.guestName = createGuestName(cryptoApi);
    storage.setItem("dusty_orbit_mp_session", identity.sessionId);
    storage.setItem("dusty_orbit_mp_name", identity.guestName);
  }

  return { ...identity, release() { channel.close(); } };
}
