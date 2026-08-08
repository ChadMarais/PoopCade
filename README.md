# Poopcade

Poopcade is a static, mobile-first progressive web app containing small arcade games. It uses plain HTML, CSS, and JavaScript with no build step or runtime dependencies.

## Project structure

```text
/
├── index.html                       # Arcade homepage and install UI
├── manifest.webmanifest             # PWA metadata and icon declarations
├── service-worker.js                # Offline shell and caching strategies
├── _headers                         # Cloudflare Pages response headers
├── assets/
│   └── icons/                       # PWA icon artwork (still required)
└── games/
    └── orbit-shift/
        └── index.html               # ORBIT//SHIFT
```

New games belong in their own directory under `games/`, with an `index.html` entry point. For example, a new game at `games/example/index.html` is available at `/games/example/`. Add its production route to the homepage and to the service worker's core or optional cache list as appropriate.

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
- `service-worker.js` precaches the homepage and ORBIT//SHIFT. Navigations are network-first so updated HTML is preferred, with cached pages and the homepage as offline fallbacks. Same-origin static assets use stale-while-revalidate behavior.
- Missing optional icon files are ignored during service-worker installation, so they cannot prevent the offline shell from installing.

## ORBIT//SHIFT production testing convention

The existing **Start at level** control is intentionally available during development and has not been removed or changed. Before a Google Play production release, it must either:

1. be shown only when the game URL includes `?debug=1`, or
2. be disabled for ordinary players in production.

Do not remove the underlying testing capability until a production-safe debug path has replaced it.

## Deployment status

The repository is prepared for its first Cloudflare Pages deployment as a static site:

- Framework preset: none
- Build command: none
- Build output directory: repository root (`.`)
- Production routes: `/` and `/games/orbit-shift/`
- Custom response headers: `_headers`

No Content Security Policy is set yet because the current homepage and game use inline CSS and JavaScript, and the game uses WebAudio. A CSP should be designed and tested separately rather than added in a way that breaks the application.

### Remaining production artwork

The manifest intentionally declares:

- `/assets/icons/icon-192.png`
- `/assets/icons/icon-512.png`
- `/assets/icons/icon-maskable-512.png`

These PNG files are currently missing and require final production artwork. Until valid files exist at all three paths, browser PWA installation criteria may not be satisfied even though the manifest and service worker are otherwise configured.

Before public launch, also configure the Cloudflare Pages project, attach the production domain, deploy, and verify the manifest, worker scope, offline mode, install prompt, and security headers over HTTPS.
