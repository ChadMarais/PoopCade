# Poopcade Arena — Nebula Murderball multiplayer

This is the logically separate Cloudflare Worker for Poopcade Game 03. It owns one Durable Object arena per registered map. The first map is **LUNAR LIABILITY** (`lunar-liability`), backed by the stable `dusty-orbit-001` arena ID.

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

Open `http://127.0.0.1:8080/games/game-03/?local=1` in two tabs. The `local=1` flag explicitly selects the Worker on port 8787. Without it, a static local preview uses the production Worker and remains playable even when Wrangler is not running. Each tab opens as a lightweight lobby spectator and only consumes an active arena slot after `JOIN THE CHAOS` is confirmed by the Durable Object.

`npm.cmd run test:wire` starts a package-free protocol/rendering harness on port 8787. It is only a local QA fallback when Wrangler is unavailable; it is not the production server and does not replace validating the Durable Object with `npm.cmd run dev`.

For a phone on the same trusted LAN, run `npm.cmd run dev:lan`, serve the static site with `--bind 0.0.0.0`, and open `http://YOUR-LAN-IP:8080/games/game-03/?local=1`. The frontend then uses `ws://YOUR-LAN-IP:8787/arena/dusty-orbit-001/ws`. Windows Firewall may require temporary private-network access. This plain-HTTP workflow is local development only.

Before production deployment, set the confirmed secure Worker origin in `games/game-03/config.js`. The value must be the `wss://` origin only; the frontend appends the selected map's `/arena/{arenaId}/ws` path.

The health check is `GET /health`. `GET /maps` returns the file catalog merged with live occupancy from each map's Durable Object. Both responses use `Cache-Control: no-store`.

Map packages live in `games/game-03/maps/{map-id}/`. A package owns its terrain, map-object definitions and images, placements, world bounds, spawn points, metadata, 15-player limit, and arena ID. Shared characters, weapons, powerups, effects, and sounds stay outside map packages. Register each new package in `games/game-03/maps/catalog.js`, then add its authoritative runtime to `src/dusty-map.ts` when the new map is built.

## Runtime behavior

- Server simulation: 30 Hz.
- Snapshot broadcast: 15 Hz.
- Client input intent: 30 Hz while visible and connected.
- Input is neutralized after 300 ms without a fresh input message.
- Disconnected players remain stationary for a 5-second reconnect grace period, then leave.
- Otherwise-stale connections are removed after 15 seconds.
- The active tick stops when the arena is empty, allowing the Durable Object to hibernate.
- The arena admits at most 15 active players. Lobby spectators do not count toward that cap.
- Active players carry authoritative `skinId` and `joinedAt` values. A reconnect inside the existing grace session keeps `joinedAt`; an explicit leave resets it for the next admission.
- Lobby roster packets contain current-session names, skins, signed `killScore`, kills, and join timestamps, and are broadcast on join, leave, kill, and death.

Gameplay balance is centralized in `src/dusty-gameplay.ts`. The authoritative tick order is input/effect expiry, movement and static collision, pickup collection and weapon actions, player crashes, nukes, projectile movement and damage, cloud expiry, Threat Leader selection, then recipient-specific snapshot creation. Above-ground player crashes block overlap and cost both unprotected pilots one health per impact window; crash kills emit a shared arcade callout for both pilots. Mole and fart-cloud stealth is enforced by omitting hidden remote players from each recipient's snapshot, and Mole also excludes the underground player from nuke victims; these are not renderer-only flags.

With the local frontend opened using `?debug=1`, number keys 1–7 grant Spy, Speed, Health, Shield, Teleport, Mole, and Fart respectively, while `U` arms a nuke. These messages are accepted only by a WebSocket connected to a `localhost` or `127.0.0.1` Worker URL that also requested debug mode; production hosts reject them.

The same debug URL exposes the static map editor. Start `node tools/dusty-dev-server.mjs` from the repository root and open `http://localhost:8081/games/game-03/?debug=1` for Lunar Liability or add `&map=hell-moon` for Hell Moon. **Import Object Image** accepts PNG or WebP artwork, places it at the current camera centre, writes its image and JSON definition into the selected map's `objects/imported/` directory, and registers it in both the browser map and multiplayer Worker. The imported object opens in **Collision Shape** mode with a rectangular polygon; drag points, Shift-click an edge or use **Add Point** to add a vertex. Solid objects block both players and projectiles by default. Enable **Let Shots Pass Through** for below-ground obstacles such as lava ditches; this keeps movement blocked while saving `blocksProjectiles: false` so the authoritative Worker lets shots cross the polygon. Use **Save Collision** to persist both the shape and this behavior. **Delete Object** removes a selected imported object and cleans up its artwork and collision definition after confirmation; built-in map objects are protected.

Signed-in clients resolve their existing Poopcade profile through `get_my_profile()` and send the current access token only with the join request. The Worker verifies that token against the same Supabase RPC before using the profile display name; unauthenticated visitors retain a session-scoped `Guest-XXXX` fallback.
