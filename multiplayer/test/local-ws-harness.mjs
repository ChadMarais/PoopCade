// Package-free Nebula Murderball wire-test harness. Production uses the Durable
// Object in src/dusty-arena.ts.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { DustyOrbitSimulation, DUSTY_FIXED_DT, DUSTY_SNAPSHOT_RATE, DUSTY_TICK_RATE, DUSTY_WEAPON } from "../src/dusty-simulation.ts";
import { parseClientMessage, safeGuestName } from "../src/protocol.ts";

const PORT = Number(process.env.POOPCADE_ARENA_PORT || 8787);
const simulation = new DustyOrbitSimulation();
const clients = new Map();

function frame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  const header = Buffer.alloc(4);
  header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function send(socket, value) {
  if (!socket.destroyed && socket.writable) socket.write(frame(value));
}

function decode(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = Boolean(buffer[1] & 0x80);
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) { if (buffer.length < 4) return null; length = buffer.readUInt16BE(2); offset = 4; }
  if (length === 127) return { consumed: buffer.length, opcode: 8, text: "" };
  const maskBytes = masked ? 4 : 0;
  if (buffer.length < offset + maskBytes + length) return null;
  const payload = Buffer.from(buffer.subarray(offset + maskBytes, offset + maskBytes + length));
  if (masked) for (let index = 0; index < payload.length; index++) payload[index] ^= buffer[offset + index % 4];
  return { consumed: offset + maskBytes + length, opcode, text: payload.toString("utf8") };
}

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ ok: true, harness: true }));
    return;
  }
  response.writeHead(426); response.end("Expected WebSocket upgrade.");
});

server.on("upgrade", (request, socket) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const sessionId = url.searchParams.get("session") || "";
  if (!/^[-0-9a-f]{36}$/i.test(sessionId) || !url.pathname.match(/^\/arena\/dusty-orbit-001\/ws$/)) { socket.destroy(); return; }
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") { socket.destroy(); return; }
  const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "\r\n"].join("\r\n"));
  const name = safeGuestName(url.searchParams.get("name"));
  for (const [other, session] of clients) if (session.playerId === sessionId) other.destroy();
  const player = simulation.addPlayer(sessionId, name, Date.now());
  clients.set(socket, { playerId: sessionId, buffer: Buffer.alloc(0) });
  send(socket, { type: "welcome", playerId: sessionId, arenaId: "dusty-orbit-001", player, weapons: [DUSTY_WEAPON], rates: { tick: DUSTY_TICK_RATE, snapshot: DUSTY_SNAPSHOT_RATE, interpolationMs: 100 } });
  send(socket, simulation.snapshot(sessionId));

  socket.on("data", (chunk) => {
    const session = clients.get(socket);
    if (!session) return;
    session.buffer = Buffer.concat([session.buffer, chunk]);
    while (session.buffer.length) {
      const decoded = decode(session.buffer);
      if (!decoded) break;
      session.buffer = session.buffer.subarray(decoded.consumed);
      if (decoded.opcode === 8) { socket.end(); break; }
      if (decoded.opcode !== 1) continue;
      const message = parseClientMessage(decoded.text);
      if (!message) continue;
      const now = Date.now();
      simulation.noteMessage(session.playerId, now);
      if (message.type === "input") simulation.applyInput(session.playerId, message, now);
      if (message.type === "hello") simulation.addPlayer(session.playerId, message.name, now);
      if (message.type === "ping") send(socket, { type: "pong", nonce: message.nonce, serverTime: now, tick: simulation.tick });
    }
  });
  socket.on("close", () => {
    const session = clients.get(socket);
    clients.delete(socket);
    if (session && ![...clients.values()].some((other) => other.playerId === session.playerId)) simulation.markDisconnected(session.playerId, Date.now());
  });
  socket.on("error", () => socket.destroy());
});

let snapshotCounter = 0;
const loop = setInterval(() => {
  const now = Date.now();
  simulation.step(DUSTY_FIXED_DT, now);
  for (const event of simulation.drainEvents()) for (const socket of clients.keys()) send(socket, event);
  if (++snapshotCounter % Math.round(DUSTY_TICK_RATE / DUSTY_SNAPSHOT_RATE) === 0) {
    for (const [socket, session] of clients) send(socket, simulation.snapshot(session.playerId, now));
  }
}, 1000 / DUSTY_TICK_RATE);

server.listen(PORT, "127.0.0.1", () => process.stdout.write(`Poopcade wire harness listening on http://127.0.0.1:${PORT}\n`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { clearInterval(loop); server.close(() => process.exit(0)); });
