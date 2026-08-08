const CACHE_PREFIX = 'poopcade-';
const CACHE_NAME = `${CACHE_PREFIX}shell-v3`;

// These routes must exist for the offline shell to install successfully.
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/games/orbit-shift/',
  '/games/orbit-shift/index.html'
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
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, event.preloadResponse));
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
