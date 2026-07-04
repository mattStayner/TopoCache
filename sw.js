/**
 * TopoCache Service Worker
 * Handles offline app shell precaching and MapTiler tile/style interception.
 */

const CACHE_NAME = 'topocache-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/config.js',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/vendor/maplibre-gl.js',
  '/vendor/maplibre-gl.css',
];

const MAPTILER_HOSTS = ['api.maptiler.com', 'cdn.maptiler.com'];

/**
 * Install: precache the app shell so the PWA loads offline.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

/**
 * Activate: claim clients and remove stale cache versions.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/**
 * Returns true if the URL is a MapTiler resource (tiles, style, glyphs, sprites).
 */
function isMapTilerRequest(url) {
  return MAPTILER_HOSTS.some((host) => url.hostname === host);
}

/**
 * Returns true if the URL is a same-origin app asset.
 */
function isAppShellRequest(url) {
  return url.origin === self.location.origin;
}

/**
 * Fetch handler: cache-first for app shell and MapTiler resources.
 * On network success for MapTiler, opportunistically cache the response.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  if (isAppShellRequest(url) || isMapTilerRequest(url)) {
    event.respondWith(handleCacheFirst(request));
  }
});

/**
 * Cache-first strategy with network fallback.
 * Caches successful network responses for MapTiler resources.
 */
async function handleCacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  let cached = await cache.match(request);
  if (!cached) cached = await cache.match(request.url);

  if (cached) return cached;

  try {
    const response = await fetch(request);

    // Cache successful MapTiler responses for future offline use
    if (response.ok) {
      const url = new URL(request.url);
      if (isMapTilerRequest(url)) {
        cache.put(request, response.clone());
      }
    }

    return response;
  } catch {
    // Offline and not in cache
    return new Response('Offline — resource not cached', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}
