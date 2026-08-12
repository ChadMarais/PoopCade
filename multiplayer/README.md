# Poopcade Arena — Dusty Orbit multiplayer

This is the logically separate Cloudflare Worker for Poopcade Game 03. It owns the authoritative `dusty-orbit-001` arena through the `DustyOrbitArena` Durable Object. It has not been deployed yet and does not yet have a confirmed production hostname.

## Local launch

From `C:\Projects\Poopcade\multiplayer`:

```powershell
npm.cmd install
npm.cmd run dev
```

In a second terminal, serve the repository root:

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/games/game-03/` in two tabs. Each tab gets a session-scoped guest identity and joins the same local Durable Object.

`npm.cmd run test:wire` starts a package-free protocol/rendering harness on port 8787. It is only a local QA fallback when Wrangler is unavailable; it is not the production server and does not replace validating the Durable Object with `npm.cmd run dev`.

For a phone on the same trusted LAN, run `npm.cmd run dev:lan`, serve the static site with `--bind 0.0.0.0`, and open `http://YOUR-LAN-IP:8080/games/game-03/?devtest=true`. The frontend automatically uses `ws://YOUR-LAN-IP:8787/arena/dusty-orbit-001/ws`. Windows Firewall may require temporary private-network access. This plain-HTTP workflow is local development only.

Before production deployment, set the confirmed secure Worker origin in `games/game-03/config.js`. The value must be the `wss://` origin only; the frontend appends `/arena/dusty-orbit-001/ws`.

The health check is `GET /health` and returns JSON shaped as `{ "ok": true, "worker": "poopcade-arena", "map": "dusty-orbit-001" }` with `Cache-Control: no-store`.

## Runtime behavior

- Server simulation: 30 Hz.
- Snapshot broadcast: 15 Hz.
- Client input intent: 30 Hz while visible and connected.
- Input is neutralized after 300 ms without a fresh input message.
- Disconnected players remain stationary for a 5-second reconnect grace period, then leave.
- Otherwise-stale connections are removed after 15 seconds.
- The active tick stops when the arena is empty, allowing the Durable Object to hibernate.

The client supplies only `Guest-XXXX` identities in this slice. A production pass must verify Poopcade access tokens server-side before trusting signed-in display names.
