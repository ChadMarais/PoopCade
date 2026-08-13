import { DurableObject } from "cloudflare:workers";
import { DUSTY_CANONICAL_COLLISION, DUSTY_MAP } from "./dusty-map.ts";
import { MAX_INPUT_MESSAGES_PER_SECOND, parseClientMessage, safeGuestName, safePlayerName, encode } from "./protocol.ts";
import {
  DustyOrbitSimulation,
  DUSTY_FIXED_DT,
  DUSTY_MAX_PLAYERS,
  DUSTY_SNAPSHOT_RATE,
  DUSTY_TICK_RATE,
} from "./dusty-simulation.ts";
import { DUSTY_GAMEPLAY, DUSTY_WEAPONS } from "./dusty-gameplay.ts";
import { submitDustyOrbitFinalScore, type DustyFinalScorePlayer } from "./dusty-score.ts";
import { validCharacterSkinId } from "../../games/game-03/character-skins.js";

type Env = { SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string };
type SessionRole = "lobby" | "active";
type Session = {
  playerId: string;
  name: string;
  skinId: string;
  joinedAt: number;
  role: SessionRole;
  debug: boolean;
  joinPending: boolean;
  windowStartedAt: number;
  messageCount: number;
  invalidCount: number;
  accessToken?: string;
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DustyOrbitArena extends DurableObject<Env> {
  private readonly simulation = new DustyOrbitSimulation();
  private readonly sessions = new Map<WebSocket, Session>();
  private readonly scoreTokens = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Partial<Session> | null;
      if (!attachment?.playerId || !UUID_PATTERN.test(attachment.playerId)) continue;
      const role: SessionRole = attachment.role === "active" ? "active" : "lobby";
      const session: Session = {
        playerId: attachment.playerId,
        name: safePlayerName(attachment.name),
        skinId: validCharacterSkinId(attachment.skinId),
        joinedAt: Number.isFinite(attachment.joinedAt) ? Number(attachment.joinedAt) : 0,
        role,
        debug: attachment.debug === true,
        joinPending: false,
        windowStartedAt: now,
        messageCount: 0,
        invalidCount: 0,
        ...(typeof attachment.accessToken === "string" ? { accessToken: attachment.accessToken } : {}),
      };
      this.sessions.set(socket, session);
      if (session.accessToken) this.scoreTokens.set(session.playerId, session.accessToken);
      if (role !== "active") continue;
      try {
        const player = this.simulation.addPlayer(session.playerId, session.name, now, { skinId: session.skinId, joinedAt: session.joinedAt || now });
        session.joinedAt = player.joinedAt;
      } catch {
        session.role = "lobby";
        socket.serializeAttachment(session);
      }
    }
    if (this.simulation.players.size) this.startLoop();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket upgrade.", { status: 426 });
    const url = new URL(request.url);
    const playerId = url.searchParams.get("session") ?? "";
    const debug = (url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.searchParams.get("debug") === "1";
    if (!UUID_PATTERN.test(playerId)) return new Response("A valid session UUID is required.", { status: 400 });

    let resumedAccessToken = this.scoreTokens.get(playerId);
    for (const [existingSocket, existing] of this.sessions) {
      if (existing.playerId !== playerId) continue;
      resumedAccessToken = existing.accessToken;
      this.sessions.delete(existingSocket);
      if (existing.role === "active") this.simulation.markDisconnected(existing.playerId, Date.now());
      try { existingSocket.close(4001, "Reconnected"); } catch {}
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const session: Session = {
      playerId,
      name: "Guest-0000",
      skinId: validCharacterSkinId(null),
      joinedAt: 0,
      role: "lobby",
      debug,
      joinPending: false,
      windowStartedAt: Date.now(),
      messageCount: 0,
      invalidCount: 0,
      ...(resumedAccessToken ? { accessToken: resumedAccessToken } : {}),
    };
    server.serializeAttachment(session);
    this.ctx.acceptWebSocket(server, [playerId]);
    this.sessions.set(server, session);
    this.sendLobbyState(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const session = this.sessions.get(socket);
    if (!session) { socket.close(1008, "Unknown session"); return; }
    const now = Date.now();
    if (now - session.windowStartedAt >= 1000) { session.windowStartedAt = now; session.messageCount = 0; }
    session.messageCount++;
    if (session.messageCount > MAX_INPUT_MESSAGES_PER_SECOND) {
      socket.close(1008, "Input rate exceeded");
      if (session.role === "active") this.simulation.markDisconnected(session.playerId, now);
      return;
    }
    const message = parseClientMessage(raw);
    if (!message) { session.invalidCount++; if (session.invalidCount >= 5) socket.close(1008, "Malformed messages"); return; }
    session.invalidCount = Math.max(0, session.invalidCount - 1);

    if (message.type === "hello") {
      if (message.sessionId !== session.playerId) { socket.close(1008, "Session mismatch"); return; }
      const existing = this.simulation.players.get(session.playerId);
      if (!existing) {
        session.name = safeGuestName(message.name);
        socket.serializeAttachment(session);
        this.sendLobbyState(socket);
        return;
      }
      session.name = existing.name;
      session.skinId = existing.skinId;
      session.joinedAt = existing.joinedAt;
      session.role = "active";
      this.simulation.prepareConnection(session.playerId, now);
      socket.serializeAttachment(session);
      this.sendWelcome(socket, session);
      socket.send(encode(this.simulation.snapshot(session.playerId, now)));
      this.broadcastLobbyState();
      return;
    }

    if (message.type === "join") {
      if (session.role === "active") { this.sendWelcome(socket, session); return; }
      if (session.joinPending) return;
      session.joinPending = true;
      try {
        const authenticatedName = message.accessToken ? await this.resolveAuthenticatedName(message.accessToken) : null;
        const name = authenticatedName ?? safeGuestName(message.name);
        const skinId = validCharacterSkinId(message.skinId);
        let player;
        try {
          player = this.simulation.addPlayer(session.playerId, name, Date.now(), { skinId });
        } catch {
          socket.send(encode({ type: "join_rejected", reason: "ARENA_FULL", activePlayers: this.simulation.players.size, maxPlayers: DUSTY_MAX_PLAYERS }));
          this.sendLobbyState(socket);
          return;
        }
        session.name = player.name;
        session.skinId = player.skinId;
        session.joinedAt = player.joinedAt;
        session.role = "active";
        session.accessToken = authenticatedName && message.accessToken ? message.accessToken : undefined;
        if (session.accessToken) this.scoreTokens.set(session.playerId, session.accessToken);
        else this.scoreTokens.delete(session.playerId);
        this.simulation.prepareConnection(session.playerId, Date.now());
        socket.serializeAttachment(session);
        this.startLoop();
        this.sendWelcome(socket, session);
        socket.send(encode(this.simulation.snapshot(session.playerId)));
        this.flushEvents();
        this.broadcastLobbyState();
      } finally {
        session.joinPending = false;
      }
      return;
    }

    if (message.type === "leave") {
      const player = session.role === "active" ? this.simulation.players.get(session.playerId) : null;
      if (player) {
        this.persistFinalScore(this.scoreTokens.get(session.playerId) ?? session.accessToken, player, now);
        this.simulation.removePlayer(session.playerId);
      }
      this.scoreTokens.delete(session.playerId);
      session.role = "lobby";
      session.joinedAt = 0;
      session.joinPending = false;
      session.accessToken = undefined;
      socket.serializeAttachment(session);
      this.flushEvents();
      this.sendLobbyState(socket);
      if (!this.simulation.players.size) this.stopLoop();
      return;
    }

    if (message.type === "ping") { socket.send(encode({ type: "pong", nonce: message.nonce, serverTime: now, tick: this.simulation.tick })); return; }
    if (session.role !== "active") return;
    this.simulation.noteMessage(session.playerId, now);
    if (message.type === "debug_powerup") { if (session.debug) this.simulation.debugGrantPowerup(session.playerId, message.powerup, now); return; }
    if (message.type === "debug_nuke") { if (session.debug) this.simulation.debugArmNuke(session.playerId); return; }
    this.simulation.applyInput(session.playerId, message, now);
  }

  webSocketClose(socket: WebSocket): void { this.disconnectSocket(socket); }
  webSocketError(socket: WebSocket): void { this.disconnectSocket(socket); }

  private async resolveAuthenticatedName(accessToken: string): Promise<string | null> {
    const base = this.env.SUPABASE_URL?.replace(/\/$/, "");
    const key = this.env.SUPABASE_PUBLISHABLE_KEY;
    if (!base || !key) return null;
    try {
      const response = await fetch(`${base}/rest/v1/rpc/get_my_profile`, {
        method: "POST",
        headers: { apikey: key, authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) return null;
      const data = await response.json() as Array<{ display_name?: unknown }> | { display_name?: unknown };
      const profile = Array.isArray(data) ? data[0] : data;
      return profile ? safePlayerName(profile.display_name, "") : null;
    } catch {
      return null;
    }
  }

  private sendWelcome(socket: WebSocket, session: Session): void {
    const player = this.simulation.players.get(session.playerId);
    if (!player) return;
    socket.send(encode({
      type: "welcome",
      playerId: player.id,
      arenaId: DUSTY_MAP.id,
      map: DUSTY_MAP,
      collision: DUSTY_CANONICAL_COLLISION,
      rates: { tick: DUSTY_TICK_RATE, snapshot: DUSTY_SNAPSHOT_RATE, interpolationMs: 100 },
      weapons: DUSTY_WEAPONS,
      gameplay: DUSTY_GAMEPLAY,
      player: { id: player.id, x: player.x, y: player.y, lastInputSeq: player.lastInputSeq, skinId: player.skinId, joinedAt: player.joinedAt },
      maxPlayers: DUSTY_MAX_PLAYERS,
    }));
  }

  private persistFinalScore(accessToken: string | undefined, player: DustyFinalScorePlayer, endedAt: number): void {
    if (!accessToken) return;
    const finalPlayer = {
      id: player.id,
      killScore: player.killScore,
      kills: player.kills,
      deaths: player.deaths,
      joinedAt: player.joinedAt,
    };
    this.ctx.waitUntil(submitDustyOrbitFinalScore({
      env: this.env,
      accessToken,
      player: finalPlayer,
      endedAt,
    }).catch(() => ({ submitted: false })));
  }

  private disconnectSocket(socket: WebSocket): void {
    const session = this.sessions.get(socket);
    if (!session) return;
    this.sessions.delete(socket);
    if (session.role !== "active") return;
    for (const current of this.sessions.values()) if (current.playerId === session.playerId && current.role === "active") return;
    this.simulation.markDisconnected(session.playerId, Date.now());
  }

  private startLoop(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      this.simulation.step(DUSTY_FIXED_DT, now);
      this.flushEvents();
      if (this.simulation.tick % Math.max(1, Math.round(DUSTY_TICK_RATE / DUSTY_SNAPSHOT_RATE)) === 0) this.broadcastSnapshots(now);
      if (!this.simulation.players.size) this.stopLoop();
    }, 1000 / DUSTY_TICK_RATE);
  }

  private stopLoop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private broadcastSnapshots(now: number): void {
    for (const [socket, session] of this.sessions) {
      if (session.role !== "active" || socket.readyState !== 1 || !this.simulation.players.has(session.playerId)) continue;
      try { socket.send(encode(this.simulation.snapshot(session.playerId, now))); } catch {}
    }
  }

  private flushEvents(): void {
    let rosterChanged = false;
    for (const event of this.simulation.drainEvents()) {
      if (["player_joined", "player_left", "kill", "death"].includes(String(event.type))) rosterChanged = true;
      if (event.type === "stale" && typeof event.playerId === "string") {
        if (event.player && typeof event.player === "object") {
          this.persistFinalScore(this.scoreTokens.get(event.playerId), event.player as DustyFinalScorePlayer, Number(event.endedAt) || Date.now());
        }
        this.scoreTokens.delete(event.playerId);
        for (const [socket, session] of this.sessions) {
          if (session.playerId !== event.playerId || session.role !== "active") continue;
          session.role = "lobby";
          session.joinedAt = 0;
          session.accessToken = undefined;
          socket.serializeAttachment(session);
          try { socket.close(4002, "Inactive"); } catch {}
        }
        continue;
      }
      this.broadcastGameplay(event);
    }
    if (rosterChanged) this.broadcastLobbyState();
  }

  private sendLobbyState(socket: WebSocket): void {
    if (socket.readyState !== 1) return;
    try { socket.send(encode(this.simulation.lobbyState())); } catch {}
  }

  private broadcastLobbyState(): void {
    const encoded = encode(this.simulation.lobbyState());
    for (const socket of this.sessions.keys()) {
      if (socket.readyState !== 1) continue;
      try { socket.send(encoded); } catch {}
    }
  }

  private broadcastGameplay(message: unknown): void {
    const encoded = encode(message);
    for (const [socket, session] of this.sessions) {
      if (session.role !== "active" || socket.readyState !== 1) continue;
      try { socket.send(encoded); } catch {}
    }
  }
}
