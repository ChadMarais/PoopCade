const CACHE_PREFIX = 'poopcade-';
const CACHE_NAME = `${CACHE_PREFIX}shell-v21`;
const SUPABASE_ORIGIN = 'https://kpssybcwwmtcdhrmfcgc.supabase.co';

// These routes must exist for the offline shell to install successfully.
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/account/',
  '/account/index.html',
  '/delete-account/',
  '/delete-account/index.html',
  '/games/orbit-shift/',
  '/games/orbit-shift/index.html',
  '/games/next/',
  '/games/next/index.html',
  '/leaderboard/',
  '/leaderboard/index.html',
  '/leaderboard/orbit-shift/',
  '/leaderboard/orbit-shift/index.html',
  '/leaderboard/next/',
  '/leaderboard/next/index.html',
  '/leaderboard/dusty-orbit/',
  '/leaderboard/dusty-orbit/index.html',
  '/privacy/',
  '/privacy/index.html',
  '/js/supabase-config.js',
  '/js/auth.js',
  '/js/stats.js',
  '/js/leaderboard.js',
  '/js/poopcade-api.js',
  '/js/guest-analytics.js'
];

// Presentation assets remain non-blocking so a bad optional response can
// never prevent the core offline shell from installing.
const OPTIONAL_ASSETS = [
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_ASSETS);
      await Promise.allSettled(
        OPTIONAL_ASSETS.map((asset) => cache.add(asset))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      if ('navigationPreload' in self.registration) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Auth, database, Edge Function, and leaderboard API responses always stay
  // on the network and are never placed in Poopcade caches.
  if (url.origin === SUPABASE_ORIGIN) return;
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // PKCE OAuth redirects carry a short-lived authorization code. Never cache
    // callback URLs or serve them from an offline fallback.
    if (url.searchParams.has('code') || url.searchParams.has('error') || url.searchParams.has('error_description')) {
      event.respondWith(fetch(request));
      return;
    }
    event.respondWith(networkFirst(request, event.preloadResponse));
    return;
  }

  // Game 03 is an active live multiplayer arena. Prefer the network
  // for its modules and artwork so a previously cached prototype cannot mix
  // with a newly deployed canonical build. Successful responses remain
  // available as an offline fallback.
  if (url.pathname.startsWith('/games/game-03/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  const networkUpdate = updateStaticAsset(request);
  event.waitUntil(networkUpdate.then(() => undefined));
  event.respondWith(
    caches.match(request).then((cached) => cached || networkUpdate.then(
      (response) => response || Response.error()
    ))
  );
});

async function networkFirst(request, preloadResponse) {
  try {
    const response = (await preloadResponse) || (await fetch(request));
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request, { ignoreSearch: true })) ||
      (await caches.match('/index.html')) ||
      Response.error();
  }
}

async function updateStaticAsset(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return null;
  }
}
