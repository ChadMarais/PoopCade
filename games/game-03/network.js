const RETRY_DELAYS = [800, 1500, 2500];
const SNAPSHOT_BUFFER_MS = 100;
const MAX_EXTRAPOLATION_MS = 100;
const POSITION_DISCONTINUITY = 120;
export const CONNECTION_STALE_MS = 8000;

function mix(a, b, amount) { return a + (b - a) * amount; }
function mixAngle(before, after, amount) {
  let difference = after - before;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;
  return before + difference * amount;
}

export class ArenaNetwork {
  constructor({ url, sessionId, name, presence = "dusty", onState, onMessage }) {
    this.url = url;
    this.sessionId = sessionId;
    this.name = name;
    this.presence = presence === "home" ? "home" : "dusty";
    this.onState = onState;
    this.onMessage = onMessage;
    this.socket = null;
    this.manualClose = false;
    this.active = true;
    this.retry = 0;
    this.snapshots = [];
    this.snapshotTimes = [];
    this.rtt = 0;
    this.lastSnapshotAt = 0;
    this.snapshotRate = 0;
    this.clockOffsets = [];
    this.clockOffsetMs = 0;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.lastMessageAt = 0;
  }

  connect(resetRetries = true) {
    if (resetRetries) this.retry = 0;
    this.manualClose = false;
    this.clearTimers();
    this.resetSnapshotStream();
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close(4001, "Reconnect");
    this.onState("connecting");
    const endpoint = new URL(this.url);
    endpoint.searchParams.set("session", this.sessionId);
    endpoint.searchParams.set("name", this.name);
    const socket = new WebSocket(endpoint);
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (socket !== this.socket) return;
      this.retry = 0;
      this.lastMessageAt = performance.now();
      this.onState("online");
      this.send({ type: "hello", sessionId: this.sessionId, name: this.name, presence: this.presence });
      this.startPing();
    });
    socket.addEventListener("message", (event) => {
      if (socket !== this.socket || typeof event.data !== "string") return;
      this.lastMessageAt = performance.now();
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message.type !== "string") return;
      if (message.type === "snapshot") this.recordSnapshot(message);
      if (message.type === "pong" && Number.isFinite(Number(message.nonce))) this.rtt = Math.max(0, performance.now() - Number(message.nonce));
      this.onMessage(message);
    });
    socket.addEventListener("close", (event) => {
      if (socket !== this.socket) return;
      this.clearTimers();
      this.onState("lost", event.reason || "The arena connection closed.");
      if (!this.manualClose && this.active) this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      if (socket === this.socket) this.onState("lost", "The arcade server could not be reached.");
    });
  }

  scheduleReconnect() {
    if (this.retry >= RETRY_DELAYS.length) { this.onState("failed", "Automatic reconnects were exhausted."); return; }
    if (this.reconnectTimer) return;
    const delay = RETRY_DELAYS[this.retry++];
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.active) this.connect(false);
    }, delay);
  }

  setActive(active) {
    this.active = active;
    if (!active) return;
    if (!this.socket || this.socket.readyState >= WebSocket.CLOSING || this.connectionIsStale()) this.connect(true);
  }

  connectionIsStale(now = performance.now()) {
    return this.socket?.readyState === WebSocket.OPEN && this.lastMessageAt > 0 && now - this.lastMessageAt > CONNECTION_STALE_MS;
  }

  restartConnection(detail) {
    if (this.manualClose || !this.active) return;
    const staleSocket = this.socket;
    this.socket = null;
    this.clearTimers();
    try { staleSocket?.close(4002, "Transport stalled"); } catch {}
    this.onState("lost", detail);
    this.connect(false);
  }

  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.active) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      this.restartConnection("The arena connection stopped responding.");
      return false;
    }
  }

  sendInput(input) { return this.send(input); }

  startPing() {
    this.pingTimer = setInterval(() => {
      if (!this.active) return;
      if (this.connectionIsStale()) {
        this.restartConnection("The arena connection stopped responding.");
        return;
      }
      this.send({ type: "ping", nonce: performance.now().toFixed(3) });
    }, 2000);
  }

  recordSnapshot(snapshot) {
    const now = performance.now();
    const epochNow = Date.now();
    const estimatedOneWayMs = this.rtt > 0 ? Math.min(250, this.rtt / 2) : 50;
    Object.defineProperties(snapshot, {
      clientReceivedAt: { value: now, enumerable: false },
      predictionCutoffAt: { value: now - estimatedOneWayMs, enumerable: false },
    });
    this.lastSnapshotAt = now;
    this.snapshotTimes.push(now);
    while (this.snapshotTimes.length && now - this.snapshotTimes[0] > 1000) this.snapshotTimes.shift();
    this.snapshotRate = this.snapshotTimes.length;
    if (Number.isFinite(snapshot.t)) {
      this.clockOffsets.push(epochNow - snapshot.t);
      if (this.clockOffsets.length > 60) this.clockOffsets.shift();
      // The lowest recent receive offset is the least network-delayed sample
      // and therefore the best inexpensive estimate of server clock offset.
      this.clockOffsetMs = Math.min(...this.clockOffsets);
    }
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 30) this.snapshots.shift();
  }

  discardProjectile(projectileId) {
    if (!Number.isSafeInteger(projectileId)) return;
    // Impact events lead the next authoritative snapshot, while rendering is
    // intentionally 100 ms behind for interpolation. Remove the dead round
    // from that buffered history immediately so it cannot be replayed beyond
    // the impact point after the hit has already registered.
    for (const snapshot of this.snapshots) {
      if (!Array.isArray(snapshot.projectiles)) continue;
      snapshot.projectiles = snapshot.projectiles.filter((projectile) => projectile.id !== projectileId);
    }
  }

  interpolatedSnapshot(now = Date.now(), localPlayerId = null) {
    const latest = this.snapshots.at(-1);
    if (!latest) return null;
    const target = now - this.clockOffsetMs - SNAPSHOT_BUFFER_MS;
    let older = this.snapshots[0];
    let newer = latest;
    for (let index = 1; index < this.snapshots.length; index++) {
      if (this.snapshots[index].t >= target) {
        older = this.snapshots[index - 1];
        newer = this.snapshots[index];
        break;
      }
      older = this.snapshots[index];
    }
    const span = Math.max(1, newer.t - older.t);
    const amount = Math.max(0, Math.min(1, (target - older.t) / span));
    const previous = new Map((older.players || []).map((player) => [player.id, player]));
    const extrapolationMs = Math.max(0, Math.min(MAX_EXTRAPOLATION_MS, target - newer.t));
    const previousProjectiles = new Map((older.projectiles || []).map((projectile) => [projectile.id, projectile]));
    const interpolatedProjectiles = (newer.projectiles || []).filter((projectile) => projectile.ownerId !== localPlayerId).map((projectile) => {
      const before = previousProjectiles.get(projectile.id);
      let x;
      let y;
      if (before) {
        x = mix(before.x, projectile.x, amount);
        y = mix(before.y, projectile.y, amount);
      } else {
        const availableHistoryMs = Number.isFinite(projectile.spawnedAt)
          ? Math.max(0, newer.t - projectile.spawnedAt)
          : 0;
        const rewindMs = Math.max(0, Math.min(100, newer.t - target, availableHistoryMs));
        x = projectile.x - (projectile.vx || 0) * rewindMs / 1000;
        y = projectile.y - (projectile.vy || 0) * rewindMs / 1000;
      }
      if (extrapolationMs) {
        x += (projectile.vx || 0) * extrapolationMs / 1000;
        y += (projectile.vy || 0) * extrapolationMs / 1000;
      }
      return { ...projectile, x, y };
    });
    // The local player's confirmed shots are animated continuously from their
    // shot events. Never reintroduce them from 15 Hz snapshots: doing so would
    // snap their presentation back to a server sample on every update.
    return {
      ...latest,
      players: (newer.players || []).map((player) => {
        const before = previous.get(player.id);
        if (player.id === localPlayerId) return player;
        const discontinuity = before && (before.alive !== player.alive || Math.hypot(player.x - before.x, player.y - before.y) > POSITION_DISCONTINUITY);
        let x = player.x;
        let y = player.y;
        let aimX = player.aimX ?? 1;
        let aimY = player.aimY ?? 0;
        if (before && !discontinuity && target <= newer.t) {
          x = mix(before.x, player.x, amount);
          y = mix(before.y, player.y, amount);
          const beforeAngle = Math.atan2(before.aimY ?? 0, before.aimX ?? 1);
          const afterAngle = Math.atan2(player.aimY ?? 0, player.aimX ?? 1);
          const angle = mixAngle(beforeAngle, afterAngle, amount);
          aimX = Math.cos(angle);
          aimY = Math.sin(angle);
        } else if (!discontinuity && extrapolationMs && player.alive) {
          x += (player.vx || 0) * extrapolationMs / 1000;
          y += (player.vy || 0) * extrapolationMs / 1000;
        }
        return { ...player, x, y, aimX, aimY };
      }),
      projectiles: interpolatedProjectiles,
    };
  }

  close() {
    this.manualClose = true;
    this.clearTimers();
    this.socket?.close(1000, "Client closed");
  }

  clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
  }

  resetSnapshotStream() {
    this.snapshots = [];
    this.snapshotTimes = [];
    this.snapshotRate = 0;
    this.clockOffsets = [];
    this.clockOffsetMs = 0;
    this.lastMessageAt = 0;
  }
}
