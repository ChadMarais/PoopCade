import assert from "node:assert/strict";
import WebSocket from "ws";

const endpoint = process.env.DUSTY_LOBBY_WS || "ws://127.0.0.1:8787/arena/dusty-orbit-001/ws";

function client(index) {
  const sessionId = crypto.randomUUID();
  const name = `Guest-${String(7000 + index).padStart(4, "0")}`;
  const socket = new WebSocket(`${endpoint}?session=${sessionId}&name=${name}`);
  const messages = [];
  const waiters = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    messages.push(message);
    for (let waiterIndex = waiters.length - 1; waiterIndex >= 0; waiterIndex--) {
      if (!waiters[waiterIndex].predicate(message)) continue;
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  });
  const waitFor = (predicate, timeoutMs = 5000, afterIndex = 0) => {
    const existing = messages.slice(afterIndex).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for lobby message for ${name}.`)), timeoutMs);
      waiters.push({ predicate, resolve, timer });
    });
  };
  const opened = new Promise((resolve, reject) => {
    socket.once("open", () => { socket.send(JSON.stringify({ type: "hello", sessionId, name })); resolve(); });
    socket.once("error", reject);
  });
  return { socket, sessionId, name, opened, waitFor, messages };
}

const clients = Array.from({ length: 16 }, (_, index) => client(index + 1));

try {
  await Promise.all(clients.map((item) => item.opened));
  await Promise.all(clients.map((item) => item.waitFor((message) => message.type === "lobby_state")));
  assert.ok(clients.every((item) => item.messages.some((message) => message.type === "lobby_state")));

  const productionSkins = ["moon-blob-01", "ivory-dart-01", "mint-tank-01", "void-orb-01"];
  for (const [index, item] of clients.slice(0, 14).entries()) {
    item.socket.send(JSON.stringify({ type: "join", name: item.name, skinId: productionSkins[index % productionSkins.length] }));
    await item.waitFor((message) => message.type === "welcome");
  }

  const aim = { x: .28, y: -.96 };
  const shotCursor = clients[0].messages.length;
  clients[0].socket.send(JSON.stringify({ type: "input", seq: 1, moveX: 0, moveY: 0, aimX: aim.x, aimY: aim.y, fire: true, nuke: false }));
  const shot = await clients[0].waitFor((message) => message.type === "shot" && message.playerId === clients[0].sessionId, 5000, shotCursor);
  const shotSpeed = Math.hypot(shot.projectile.vx, shot.projectile.vy);
  assert.ok(Math.abs(shot.projectile.vx / shotSpeed - aim.x) < .0001);
  assert.ok(Math.abs(shot.projectile.vy / shotSpeed - aim.y) < .0001);
  assert.equal(shot.projectile.inputSeq, 1);
  clients[0].socket.send(JSON.stringify({ type: "input", seq: 2, moveX: 0, moveY: 0, aimX: aim.x, aimY: aim.y, fire: false, nuke: false }));

  const finalists = clients.slice(14);
  for (const item of finalists) item.socket.send(JSON.stringify({ type: "join", name: item.name, skinId: "moon-blob-01" }));
  const results = await Promise.all(finalists.map((item) => item.waitFor((message) => message.type === "welcome" || message.type === "join_rejected")));
  assert.deepEqual(results.map((message) => message.type === "welcome" ? "JOINED" : message.reason).sort(), ["ARENA_FULL", "JOINED"]);
  assert.equal(Math.max(...finalists.flatMap((item) => item.messages.filter((message) => message.type === "lobby_state").map((message) => message.activePlayers))), 15);

  const rejected = finalists[results.findIndex((message) => message.type === "join_rejected")];
  const leaveCursor = rejected.messages.length;
  const departedCursor = clients[0].messages.length;
  clients[0].socket.send(JSON.stringify({ type: "leave" }));
  await clients[0].waitFor((message) => message.type === "leave_confirmed", 5000, departedCursor);
  await rejected.waitFor((message) => message.type === "lobby_state" && message.activePlayers === 14, 5000, leaveCursor);
  const helloCursor = clients[0].messages.length;
  clients[0].socket.send(JSON.stringify({ type: "hello", sessionId: clients[0].sessionId, name: clients[0].name }));
  await clients[0].waitFor((message) => message.type === "lobby_state", 5000, helloCursor);
  assert.equal(clients[0].messages.slice(helloCursor).some((message) => message.type === "welcome"), false);
  const replacementCursor = rejected.messages.length;
  rejected.socket.send(JSON.stringify({ type: "join", name: rejected.name, skinId: "unknown-but-valid-id" }));
  const replacement = await rejected.waitFor((message) => message.type === "welcome", 5000, replacementCursor);
  assert.equal(replacement.player.skinId, "moon-blob-01");
  console.log("Lobby wire QA passed: exact live aim, 16 lobby spectators, 15-player cap, authoritative leave-to-lobby, final-slot race, and skin fallback.");
} finally {
  for (const item of clients) {
    if (item.socket.readyState === WebSocket.OPEN) item.socket.send(JSON.stringify({ type: "leave" }));
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  for (const item of clients) item.socket.close();
}
