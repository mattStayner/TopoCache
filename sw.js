/**
 * TopoCache Service Worker
 * Handles offline app shell precaching and MapTiler tile/style interception.
 */

const CACHE_NAME = 'topocache-v2';
const APP_SHELL = [
  './',
  './index.html',
  './config.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './vendor/maplibre-gl.js',
  './vendor/maplibre-gl.css',
];

const MAPTILER_HOSTS = ['api.maptiler.com', 'cdn.maptiler.com'];

function isAppShellAsset(pathname) {
  return APP_SHELL.some((asset) => {
    const normalized = asset.replace(/^\.\//, '/');
    return pathname === normalized || pathname.endsWith(normalized);
  });
}

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
 * Fetch handler: network-first for app shell, cache-first for MapTiler resources.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (isAppShellRequest(url) && isAppShellAsset(url.pathname)) {
    event.respondWith(handleNetworkFirstAppShell(request));
    return;
  }

  if (isAppShellRequest(url) || isMapTilerRequest(url)) {
    event.respondWith(handleCacheFirst(request));
  }
});

/**
 * Network-first for HTML/JS/CSS so deploys and dev builds pick up changes quickly.
 */
async function handleNetworkFirstAppShell(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = (await cache.match(request)) || (await cache.match(request.url));
    if (cached) return cached;
    return new Response('Offline — app shell not cached', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}

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

    if (response.ok) {
      const url = new URL(request.url);
      if (isMapTilerRequest(url)) {
        cache.put(request, response.clone());
      }
    }

    return response;
  } catch {
    return new Response('Offline — resource not cached', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}
