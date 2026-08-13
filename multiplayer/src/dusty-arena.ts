import { DurableObject } from "cloudflare:workers";
import { DUSTY_CANONICAL_COLLISION, DUSTY_MAP } from "./dusty-map.ts";
import { MAX_INPUT_MESSAGES_PER_SECOND, parseClientMessage, safeGuestName, encode } from "./protocol.ts";
import {
  DustyOrbitSimulation,
  DUSTY_FIXED_DT,
  DUSTY_MAX_PLAYERS,
  DUSTY_SNAPSHOT_RATE,
  DUSTY_TICK_RATE,
} from "./dusty-simulation.ts";
import { DUSTY_GAMEPLAY, DUSTY_WEAPONS } from "./dusty-gameplay.ts";

type Env = Record<string, never>;
type Session = { playerId: string; name: string; debug: boolean; windowStartedAt: number; messageCount: number; invalidCount: number };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DustyOrbitArena extends DurableObject<Env> {
  private readonly simulation = new DustyOrbitSimulation();
  private readonly sessions = new Map<WebSocket, Session>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Partial<Session> | null;
      if (!attachment?.playerId || !UUID_PATTERN.test(attachment.playerId)) continue;
      const session: Session = { playerId: attachment.playerId, name: safeGuestName(attachment.name), debug: attachment.debug === true, windowStartedAt: now, messageCount: 0, invalidCount: 0 };
      this.sessions.set(socket, session);
      try { this.simulation.addPlayer(session.playerId, session.name, now); } catch { socket.close(1013, "Arena full"); }
    }
    if (this.sessions.size) this.startLoop();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket upgrade.", { status: 426 });
    const url = new URL(request.url);
    const playerId = url.searchParams.get("session") ?? "";
    const name = safeGuestName(url.searchParams.get("name"));
    const debug = (url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.searchParams.get("debug") === "1";
    if (!UUID_PATTERN.test(playerId)) return new Response("A valid session UUID is required.", { status: 400 });

    for (const [existingSocket, session] of this.sessions) {
      if (session.playerId !== playerId) continue;
      this.sessions.delete(existingSocket);
      try { existingSocket.close(4001, "Reconnected"); } catch {}
    }

    const now = Date.now();
    let player;
    try { player = this.simulation.addPlayer(playerId, name, now); }
    catch { return new Response("Arena full.", { status: 503 }); }
    this.simulation.prepareConnection(playerId, now);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const session: Session = { playerId, name, debug, windowStartedAt: now, messageCount: 0, invalidCount: 0 };
    server.serializeAttachment(session);
    this.ctx.acceptWebSocket(server, [playerId]);
    this.sessions.set(server, session);
    this.startLoop();

    server.send(encode({
      type: "welcome", playerId,
      arenaId: url.pathname.split("/").filter(Boolean).at(-2) ?? DUSTY_MAP.id,
      map: DUSTY_MAP,
      collision: DUSTY_CANONICAL_COLLISION,
      rates: { tick: DUSTY_TICK_RATE, snapshot: DUSTY_SNAPSHOT_RATE, interpolationMs: 100 },
      weapons: DUSTY_WEAPONS, gameplay: DUSTY_GAMEPLAY,
      player: { id: player.id, x: player.x, y: player.y, lastInputSeq: player.lastInputSeq }, maxPlayers: DUSTY_MAX_PLAYERS,
    }));
    server.send(encode(this.simulation.snapshot(playerId)));
    this.flushEvents();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
    const session = this.sessions.get(socket);
    if (!session) { socket.close(1008, "Unknown session"); return; }
    const now = Date.now();
    if (now - session.windowStartedAt >= 1000) { session.windowStartedAt = now; session.messageCount = 0; }
    session.messageCount++;
    if (session.messageCount > MAX_INPUT_MESSAGES_PER_SECOND) { socket.close(1008, "Input rate exceeded"); this.simulation.markDisconnected(session.playerId, now); return; }
    const message = parseClientMessage(raw);
    if (!message) { session.invalidCount++; if (session.invalidCount >= 5) socket.close(1008, "Malformed messages"); return; }
    session.invalidCount = Math.max(0, session.invalidCount - 1);
    this.simulation.noteMessage(session.playerId, now);
    if (message.type === "hello") {
      if (message.sessionId !== session.playerId) { socket.close(1008, "Session mismatch"); return; }
      session.name = message.name;
      this.simulation.addPlayer(session.playerId, session.name, now);
      socket.serializeAttachment(session);
      return;
    }
    if (message.type === "ping") { socket.send(encode({ type: "pong", nonce: message.nonce, serverTime: now, tick: this.simulation.tick })); return; }
    if (message.type === "debug_powerup") { if (session.debug) this.simulation.debugGrantPowerup(session.playerId, message.powerup, now); return; }
    if (message.type === "debug_nuke") { if (session.debug) this.simulation.debugArmNuke(session.playerId); return; }
    this.simulation.applyInput(session.playerId, message, now);
  }

  webSocketClose(socket: WebSocket): void { this.disconnectSocket(socket); }
  webSocketError(socket: WebSocket): void { this.disconnectSocket(socket); }

  private disconnectSocket(socket: WebSocket): void {
    const session = this.sessions.get(socket);
    if (!session) return;
    this.sessions.delete(socket);
    for (const current of this.sessions.values()) if (current.playerId === session.playerId) return;
    this.simulation.markDisconnected(session.playerId, Date.now());
  }

  private startLoop(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      this.simulation.step(DUSTY_FIXED_DT, now);
      this.flushEvents();
      if (this.simulation.tick % Math.max(1, Math.round(DUSTY_TICK_RATE / DUSTY_SNAPSHOT_RATE)) === 0) this.broadcastSnapshots(now);
      if (!this.sessions.size && !this.simulation.players.size) this.stopLoop();
    }, 1000 / DUSTY_TICK_RATE);
  }

  private stopLoop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private broadcastSnapshots(now: number): void {
    for (const [socket, session] of this.sessions) {
      if (socket.readyState !== 1) continue;
      try { socket.send(encode(this.simulation.snapshot(session.playerId, now))); } catch {}
    }
  }

  private flushEvents(): void {
    for (const event of this.simulation.drainEvents()) {
      if (event.type === "stale" && typeof event.playerId === "string") {
        for (const [socket, session] of this.sessions) {
          if (session.playerId !== event.playerId) continue;
          this.sessions.delete(socket);
          try { socket.close(4002, "Inactive"); } catch {}
        }
        continue;
      }
      this.broadcast(event);
    }
  }

  private broadcast(message: unknown): void {
    const encoded = encode(message);
    for (const socket of this.sessions.keys()) {
      if (socket.readyState !== 1) continue;
      try { socket.send(encoded); } catch {}
    }
  }
}
