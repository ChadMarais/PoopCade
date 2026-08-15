# Poopcade

Poopcade is a static, mobile-first progressive web app containing small arcade games. It uses plain HTML, CSS, and JavaScript with no build step or locally installed frontend packages. Account features load one pinned Supabase browser module from a CDN.

## Project structure

```text
/
├── index.html                       # Arcade homepage and install UI
├── manifest.webmanifest             # PWA metadata and icon declarations
├── service-worker.js                # Offline shell and caching strategies
├── _headers                         # Cloudflare Static Assets response headers
├── account/                         # Gamer profile and personal bests
├── leaderboard/                     # Public per-game leaderboards
├── js/                              # Shared Supabase client/auth/API modules
├── assets/
│   └── icons/                       # PWA PNG icons and editable SVG master
├── supabase/
│   ├── migrations/                  # Reviewed database schema and RLS
│   └── functions/submit-run/        # Authenticated score submission
└── games/
    ├── orbit-shift/index.html        # ORBIT//SHIFT
    └── next/index.html               # NEXT.
```

New games belong in their own directory under `games/`, with an `index.html` entry point. For example, a new game at `games/example/index.html` is available at `/games/example/`. Add its production route to the homepage and to the service worker's core or optional cache list as appropriate.

Game 03 is the Nebula Murderball live multiplayer arena at `games/game-03/`. Its separate Cloudflare Worker and Durable Object backend lives in `multiplayer/`; that directory is excluded from the static-assets upload and is deployed independently.

## Run locally

A service worker requires a secure context. Browsers treat `localhost` as secure for development, so serve the repository root instead of opening `index.html` directly:

```sh
python -m http.server 8080
```

Then open `http://localhost:8080/`. A comparable static file server is also fine. No package installation or build command is required.

When testing service-worker changes, use the browser's Application/Storage developer tools to inspect registrations and caches. The worker uses a versioned cache and takes control after installation without forcing a page reload.

## PWA structure

- `index.html` links the manifest, exposes the install prompt when supported, and registers the root-scoped service worker.
- `manifest.webmanifest` defines standalone, portrait-first behavior and the intended production icon paths.
- `service-worker.js` precaches the homepage, ORBIT//SHIFT, NEXT., and all three leaderboard pages. Navigations are network-first so updated HTML is preferred, with cached pages and the homepage as offline fallbacks. Same-origin static assets use stale-while-revalidate behavior, except Game 03 resources, which are network-first to prevent incompatible multiplayer builds from being mixed by an older cache.
- Missing optional icon files are ignored during service-worker installation, so they cannot prevent the offline shell from installing.
- Supabase API, authentication, Edge Function, and leaderboard responses are never cached by the service worker.

## Accounts and leaderboards

Guest play remains the default. Players may optionally sign in with Google, choose a separate public gamer name, save ORBIT//SHIFT, NEXT., and NEBULA MURDERBALL runs, and sync personal bests across devices. NEBULA MURDERBALL submits each newly reached positive arena-score high from the server-reported player snapshot, so a later death penalty cannot erase a previously saved best.

The NEBULA MURDERBALL Worker also submits a signed-in player's final authoritative arena score when the player deliberately leaves or is removed after the inactivity timeout. This closes sessions that otherwise have no game-over event; guest sessions remain analytics-only.

NEBULA MURDERBALL maps are file-backed packages under `games/game-03/maps/`. Each map directory owns its terrain, object definitions, placements, spawn points, metadata, and 15-player arena ID. Characters, weapons, powerups, effects, and audio remain shared under `games/game-03/assets/` and the common game modules. **LUNAR LIABILITY** (`lunar-liability`) remains the default map; **HELL MOON** (`hell-moon`) is a 4,000 × 2,500 tiled-terrain arena ready for object authoring. Add future maps to `games/game-03/maps/catalog.js` to expose them in the lobby selector and Worker map directory.

The browser uses one Supabase client from `js/supabase-config.js`, with `@supabase/supabase-js` pinned to version `2.111.0`. The publishable browser key in that file is not a secret. Never add a secret key, service-role key, database password, OAuth client secret, or access token to frontend code or source control.

The backend foundation is source-only and has not been deployed. Before accounts work in production:

1. Apply `supabase/migrations/20260808_initial_poocade.sql` and later migrations in timestamp order, including `20260809133000_add_next_game.sql` for NEXT., `20260813190000_add_dusty_orbit_highscores.sql` for NEBULA MURDERBALL's stable `dusty-orbit` game slug, and `20260814170000_rename_dusty_orbit_to_nebula_murderball.sql` for its current display name.
2. Deploy the `submit-run` Edge Function with JWT verification enabled.
3. Enable Google under Supabase Authentication providers and configure its real Google OAuth client ID and secret in the dashboard.
4. Set the Supabase Site URL and redirect allow list to `https://poopcade.com/`.
5. Add `https://kpssybcwwmtcdhrmfcgc.supabase.co/auth/v1/callback` as an authorized redirect URI in the Google OAuth client.
6. Test sign-in, profile naming, run submission, RLS, leaderboard reads, sign-out, and offline behavior on the production HTTPS origin.

The current server validation blocks unauthenticated and obviously extreme submissions, but a client-side game is not cheat-proof. Stronger anti-cheat, rate limiting, abuse monitoring, and self-service account deletion remain future production work.

## ORBIT//SHIFT production testing convention

The existing **Start at level** control is intentionally available during development and has not been removed or changed. Before a Google Play production release, it must either:

1. be shown only when the game URL includes `?debug=1`, or
2. be disabled for ordinary players in production.

Do not remove the underlying testing capability until a production-safe debug path has replaced it.

## Deployment status

The repository is configured for Cloudflare Workers Static Assets:

- Wrangler config: `wrangler.jsonc`
- Worker JavaScript entry point: none
- Static asset directory: repository root (`.`)
- Upload exclusions: `.assetsignore` (including `android/` and `supabase/` source)
- Production routes include `/`, `/games/orbit-shift/`, `/games/next/`, `/games/game-03/`, the overall `/leaderboard/`, `/leaderboard/orbit-shift/`, `/leaderboard/next/`, `/leaderboard/dusty-orbit/`, and `/account/`. Nebula Murderball launches directly without a development-mode query parameter.
- Custom response headers: `_headers`

No Content Security Policy is set yet because the current homepage and game use inline CSS and JavaScript, and the game uses WebAudio. A CSP should be designed and tested separately rather than added in a way that breaks the application.

Before deploying Game 03, deploy and validate the `multiplayer/` Worker first, then set the confirmed secure Worker origin in `games/game-03/config.js`. The value must be a `wss://` origin and must not include the arena route.

### Production icon artwork

The manifest declares:

- `/assets/icons/icon-192.png`
- `/assets/icons/icon-512.png`
- `/assets/icons/icon-maskable-512.png`

All three PNG files are generated from `assets/icons/icon-source.svg`. The maskable version keeps its essential mark inside Android's central safe area. Regenerate every PNG from the SVG master whenever the artwork changes, then increment the service-worker cache version.

Before public launch, deploy the reviewed static assets, attach `poopcade.com`, and verify the manifest, worker scope, offline mode, install prompt, account flow, leaderboard, and security headers over HTTPS.
