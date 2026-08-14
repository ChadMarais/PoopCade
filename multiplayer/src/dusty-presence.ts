export type DustyPresenceSurface = "unknown" | "home" | "dusty";

export type DustyPresenceSession = {
  playerId: string;
  name: string;
  role: "lobby" | "active";
  surface: DustyPresenceSurface;
  connectedAt: number;
};

export function summarizeDustyPresence(sessions: Iterable<DustyPresenceSession>): {
  onlinePlayers: number;
  lobbyPlayers: Array<{ id: string; name: string; waitingSince: number }>;
} {
  const online = new Set<string>();
  const waiting = new Map<string, { id: string; name: string; waitingSince: number }>();
  for (const session of sessions) {
    online.add(session.playerId);
    if (session.role !== "lobby" || session.surface !== "dusty") continue;
    waiting.set(session.playerId, {
      id: session.playerId,
      name: session.name,
      waitingSince: Math.max(0, Number(session.connectedAt) || 0),
    });
  }
  return {
    onlinePlayers: online.size,
    lobbyPlayers: [...waiting.values()].sort((a, b) => a.waitingSince - b.waitingSince || a.id.localeCompare(b.id)),
  };
}
