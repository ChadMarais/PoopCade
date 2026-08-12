const RETRY_DELAYS = [800, 1500, 2500];
const SNAPSHOT_BUFFER_MS = 100;

function mix(a, b, amount) { return a + (b - a) * amount; }

export class ArenaNetwork {
  constructor({ url, sessionId, name, onState, onMessage }) {
    this.url = url;
    this.sessionId = sessionId;
    this.name = name;
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
    this.pingTimer = null;
    this.reconnectTimer = null;
  }

  connect(resetRetries = true) {
    if (resetRetries) this.retry = 0;
    this.manualClose = false;
    this.clearTimers();
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
      this.onState("online");
      this.send({ type: "hello", sessionId: this.sessionId, name: this.name });
      this.startPing();
    });
    socket.addEventListener("message", (event) => {
      if (socket !== this.socket || typeof event.data !== "string") return;
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
    if (!this.socket || this.socket.readyState >= WebSocket.CLOSING) this.connect(true);
  }

  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.active) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  sendInput(input) { return this.send(input); }

  startPing() {
    this.pingTimer = setInterval(() => {
      if (this.active) this.send({ type: "ping", nonce: performance.now().toFixed(3) });
    }, 2000);
  }

  recordSnapshot(snapshot) {
    const now = performance.now();
    this.lastSnapshotAt = now;
    this.snapshotTimes.push(now);
    this.snapshotTimes = this.snapshotTimes.filter((time) => now - time <= 1000);
    this.snapshotRate = this.snapshotTimes.length;
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 30) this.snapshots.shift();
  }

  interpolatedSnapshot(now = Date.now(), localPlayerId = null) {
    const latest = this.snapshots.at(-1);
    if (!latest) return null;
    const target = now - SNAPSHOT_BUFFER_MS;
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
    const extrapolationMs = Math.max(0, Math.min(100, target - newer.t));
    const interpolatedProjectiles = (newer.projectiles || []).filter((projectile) => projectile.ownerId !== localPlayerId).map((projectile) => {
      const before = (older.projectiles || []).find((item) => item.id === projectile.id);
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
        if (!before) return player;
        const aimX = mix(before.aimX ?? player.aimX ?? 1, player.aimX ?? 1, amount);
        const aimY = mix(before.aimY ?? player.aimY ?? 0, player.aimY ?? 0, amount);
        const aimLength = Math.hypot(aimX, aimY) || 1;
        return { ...player, x: mix(before.x, player.x, amount), y: mix(before.y, player.y, amount), aimX: aimX / aimLength, aimY: aimY / aimLength };
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
}
