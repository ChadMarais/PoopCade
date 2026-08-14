import assert from "node:assert/strict";
import test from "node:test";
import { claimSessionIdentity, resolvePoopcadePlayerIdentity } from "../../games/game-03/identity.js";

class MemoryStorage {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

class FakeBroadcastChannel {
  static channels = new Set();
  constructor() { this.listeners = []; FakeBroadcastChannel.channels.add(this); }
  addEventListener(type, listener) { if (type === "message") this.listeners.push(listener); }
  postMessage(data) {
    for (const channel of FakeBroadcastChannel.channels) if (channel !== this) {
      queueMicrotask(() => channel.listeners.forEach((listener) => listener({ data })));
    }
  }
  close() { FakeBroadcastChannel.channels.delete(this); }
}

function cryptoSequence(prefix) {
  let value = 0;
  return {
    randomUUID() { return `${prefix}-${++value}`; },
    getRandomValues(array) { array[0] = ++value; return array; },
  };
}

test("a cloned live tab rotates its authoritative player identity", async () => {
  FakeBroadcastChannel.channels.clear();
  const originalStorage = new MemoryStorage({ dusty_orbit_mp_session: "shared-session", dusty_orbit_mp_name: "Guest-1111" });
  const cloneStorage = new MemoryStorage({ dusty_orbit_mp_session: "shared-session", dusty_orbit_mp_name: "Guest-1111" });
  const original = await claimSessionIdentity({ storage: originalStorage, BroadcastChannelClass: FakeBroadcastChannel, cryptoApi: cryptoSequence("original"), waitMs: 1 });
  const clone = await claimSessionIdentity({ storage: cloneStorage, BroadcastChannelClass: FakeBroadcastChannel, cryptoApi: cryptoSequence("clone"), waitMs: 1 });
  assert.equal(original.sessionId, "shared-session");
  assert.notEqual(clone.sessionId, original.sessionId);
  assert.notEqual(clone.guestName, original.guestName);
  assert.equal(cloneStorage.getItem("dusty_orbit_mp_session"), clone.sessionId);
  original.release(); clone.release();
});

test("refresh continuity is preserved when no other live tab owns the session", async () => {
  FakeBroadcastChannel.channels.clear();
  const storage = new MemoryStorage({ dusty_orbit_mp_session: "refresh-session", dusty_orbit_mp_name: "Guest-2222" });
  const identity = await claimSessionIdentity({ storage, BroadcastChannelClass: FakeBroadcastChannel, cryptoApi: cryptoSequence("refresh"), waitMs: 1 });
  assert.equal(identity.sessionId, "refresh-session"); assert.equal(identity.guestName, "Guest-2222");
  identity.release();
});

test("signed-in Nebula Murderball players use the existing Poopcade profile instead of a guest name", async () => {
  const identity = await resolvePoopcadePlayerIdentity("Guest-1234", {
    async getSession() { return { user: { id: "profile-1" }, access_token: "verified-access-token" }; },
    async getMyProfile() { return { display_name: "Orbit Veteran" }; },
  });
  assert.deepEqual(identity, { playerName: "Orbit Veteran", accessToken: "verified-access-token", authenticated: true });
});

test("Nebula Murderball keeps the guest fallback when no Poopcade session exists", async () => {
  const identity = await resolvePoopcadePlayerIdentity("Guest-4321", {
    async getSession() { return null; },
    async getMyProfile() { throw new Error("should not be called"); },
  });
  assert.deepEqual(identity, { playerName: "Guest-4321", accessToken: null, authenticated: false });
});
