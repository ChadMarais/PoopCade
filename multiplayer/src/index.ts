import type { DustyOrbitArena } from "./dusty-arena.ts";

export { DustyOrbitArena } from "./dusty-arena.ts";

interface Env {
  DUSTY_ARENAS: DurableObjectNamespace<DustyOrbitArena>;
}

function originAllowed(origin: string | null): boolean {
  if (origin === null) return true;
  if (origin === "https://poopcade.com") return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" ||
      /^10\./.test(url.hostname) || /^192\.168\./.test(url.hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname);
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, worker: "poopcade-arena", map: "dusty-orbit-001" }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const match = url.pathname.match(/^\/arena\/([a-z0-9-]{1,48})\/ws$/);
    if (!match) return new Response("Not found.", { status: 404 });
    if (!originAllowed(request.headers.get("Origin"))) return new Response("Origin not allowed.", { status: 403 });
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }

    if (match[1] !== "dusty-orbit-001") return new Response("Unknown arena.", { status: 404 });
    return env.DUSTY_ARENAS.getByName(match[1]).fetch(request);
  },
};
