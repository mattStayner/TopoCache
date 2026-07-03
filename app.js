/**
 * TopoCache — Offline topo maps & hike tracking PWA
 * Core application: map, offline downloader, GPS tracking, IndexedDB persistence.
 */

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  MAPTILER_KEY: 'VquLuyko0vFYcjpk2FW8',
  STYLE_URL: 'https://api.maptiler.com/maps/outdoor-v2/style.json',
  CACHE_NAME: 'topocache-v1',
  DB_NAME: 'topocache-db',
  DB_VERSION: 1,
  STORE_TRAILS: 'trails',
  STORE_REGIONS: 'regions',
  UNITS: 'imperial', // 'imperial' | 'metric'
  DOWNLOAD_CONCURRENCY: 5,
  DELETE_CONCURRENCY: 10,
  DEFAULT_MAX_ZOOM: 15,
  MIN_DOWNLOAD_ZOOM: 10,
  GPS_ACCURACY_THRESHOLD: 100, // meters — skip fixes worse than this
  GPS_OPTIONS: { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  TILE_WARN_THRESHOLD: 2000,
};

// ─── Application State ───────────────────────────────────────────────────────

const state = {
  map: null,
  tracking: false,
  lockToGps: false,
  watchId: null,
  timerInterval: null,
  startTime: null,
  coordinates: [],
  distanceMeters: 0,
  lastPosition: null,
  lastTimestamp: null,
  visibleTrails: new Set(),
  downloading: false,
  downloadAbort: null,
  pendingRegionTiles: [],
  pendingRegionBounds: null,
  pendingRegionZoom: null,
  nameModalMode: null, // 'trail' | 'region' | 'rename-region'
  renameRegionId: null,
};

// ─── DOM References ──────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const dom = {
  hud: $('hud'),
  statDistance: $('stat-distance'),
  statDuration: $('stat-duration'),
  statSpeed: $('stat-speed'),
  hudWarning: $('hud-warning'),
  offlineBanner: $('offline-banner'),
  toast: $('toast'),
  btnDownload: $('btn-download'),
  btnTrack: $('btn-track'),
  btnCenter: $('btn-center'),
  btnLock: $('btn-lock'),
  btnTrails: $('btn-trails'),
  nameModal: $('name-modal'),
  nameModalTitle: $('name-modal-title'),
  nameModalDesc: $('name-modal-desc'),
  nameInput: $('name-input'),
  nameCancel: $('name-cancel'),
  nameSave: $('name-save'),
  confirmModal: $('confirm-modal'),
  confirmTitle: $('confirm-title'),
  confirmMessage: $('confirm-message'),
  confirmCancel: $('confirm-cancel'),
  confirmOk: $('confirm-ok'),
  trailsOverlay: $('trails-overlay'),
  trailsDrawer: $('trails-drawer'),
  trailsList: $('trails-list'),
  trailsClose: $('trails-close'),
  regionsOverlay: $('regions-overlay'),
  regionsDrawer: $('regions-drawer'),
  regionsList: $('regions-list'),
  regionsSummary: $('regions-summary'),
  regionsClose: $('regions-close'),
  btnDeleteAllRegions: $('btn-delete-all-regions'),
  downloadPanel: $('download-panel'),
  maxZoom: $('max-zoom'),
  progressWrap: $('progress-wrap'),
  progressFill: $('progress-fill'),
  progressText: $('progress-text'),
  downloadCancel: $('download-cancel'),
  downloadStart: $('download-start'),
  openRegionsDrawer: $('open-regions-drawer'),
};

// ─── Service Worker & Persistent Storage ─────────────────────────────────────

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service workers not supported');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    console.log('Service worker registered:', reg.scope);
    reg.update();
  } catch (err) {
    console.error('SW registration failed:', err);
  }
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return;
  try {
    const persisted = await navigator.storage.persist();
    console.log('Persistent storage granted:', persisted);
    const estimate = await navigator.storage.estimate();
    console.log('Storage estimate:', estimate);
  } catch (err) {
    console.warn('persist() failed:', err);
  }
}

// ─── IndexedDB Wrapper ───────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(CONFIG.STORE_TRAILS)) {
        db.createObjectStore(CONFIG.STORE_TRAILS, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(CONFIG.STORE_REGIONS)) {
        db.createObjectStore(CONFIG.STORE_REGIONS, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbAdd(store, record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbUpdate(store, record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(store, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Trail CRUD
const saveTrail = (record) => dbAdd(CONFIG.STORE_TRAILS, record);
const getAllTrails = () => dbGetAll(CONFIG.STORE_TRAILS);
const deleteTrail = (id) => dbDelete(CONFIG.STORE_TRAILS, id);

// Region CRUD
const saveRegion = (record) => dbAdd(CONFIG.STORE_REGIONS, record);
const getAllRegions = () => dbGetAll(CONFIG.STORE_REGIONS);
const deleteRegion = (id) => dbDelete(CONFIG.STORE_REGIONS, id);

async function updateRegion(id, patch) {
  const regions = await getAllRegions();
  const region = regions.find((r) => r.id === id);
  if (!region) return;
  await dbUpdate(CONFIG.STORE_REGIONS, { ...region, ...patch });
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/** Show a brief toast message */
let toastTimer = null;
function showToast(msg, duration = 3000) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('show'), duration);
}

/** Show confirm dialog; returns Promise<boolean> */
function showConfirm(title, message, okLabel = 'Delete') {
  return new Promise((resolve) => {
    dom.confirmTitle.textContent = title;
    dom.confirmMessage.textContent = message;
    dom.confirmOk.textContent = okLabel;
    dom.confirmModal.classList.add('open');

    const cleanup = (result) => {
      dom.confirmModal.classList.remove('open');
      dom.confirmOk.removeEventListener('click', onOk);
      dom.confirmCancel.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    dom.confirmOk.addEventListener('click', onOk);
    dom.confirmCancel.addEventListener('click', onCancel);
  });
}

/** Format seconds as HH:MM:SS */
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

/** Haversine distance in meters between two [lng, lat] points */
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Format distance for display */
function formatDistance(meters) {
  if (CONFIG.UNITS === 'metric') {
    return meters >= 1000
      ? `${(meters / 1000).toFixed(2)} km`
      : `${Math.round(meters)} m`;
  }
  const miles = meters / 1609.344;
  return `${miles.toFixed(2)} mi`;
}

/** Format speed for display (meters per second input) */
function formatSpeed(mps) {
  if (CONFIG.UNITS === 'metric') {
    return `${(mps * 3.6).toFixed(1)} km/h`;
  }
  return `${(mps * 2.23694).toFixed(1)} mph`;
}

/** Format a date string for display */
function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Default name with today's date */
function defaultMapName() {
  return `Map ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// ─── Tile Math (Web Mercator) ────────────────────────────────────────────────

/** Compute tile x/y range for a bounding box at a given zoom */
function tileRangeForBounds(bounds, zoom) {
  const n = 2 ** zoom;
  const xMin = Math.floor(((bounds.getWest() + 180) / 360) * n);
  const xMax = Math.floor(((bounds.getEast() + 180) / 360) * n);
  const lat2y = (lat) =>
    Math.floor(
      ((1 -
        Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) /
          Math.PI) /
        2) *
        n
    );
  const yMin = lat2y(bounds.getNorth());
  const yMax = lat2y(bounds.getSouth());
  return { xMin, xMax, yMin, yMax };
}

/** Build a tile URL from a template string */
function buildTileUrl(template, z, x, y, key) {
  let url = template
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y)
    .replace('{key}', key);
  if (!url.includes('key=') && key) {
    url += (url.includes('?') ? '&' : '?') + `key=${key}`;
  }
  return url;
}

/** Enumerate all tile URLs for a bounds + zoom range */
function enumerateTileUrls(bounds, minZoom, maxZoom, tileTemplate) {
  const urls = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const { xMin, xMax, yMin, yMax } = tileRangeForBounds(bounds, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        urls.push(buildTileUrl(tileTemplate, z, x, y, CONFIG.MAPTILER_KEY));
      }
    }
  }
  return urls;
}

// ─── Concurrent Fetch Pool ───────────────────────────────────────────────────

/**
 * Fetch URLs with a concurrency limit, caching each successful response.
 * Returns array of successfully cached URLs.
 */
async function fetchAndCacheBatch(urls, concurrency, onProgress, signal) {
  const cache = await caches.open(CONFIG.CACHE_NAME);
  const cached = [];
  let completed = 0;
  let index = 0;

  async function worker() {
    while (index < urls.length) {
      if (signal?.aborted) return;
      const i = index++;
      const url = urls[i];
      try {
        const response = await fetch(url, { signal });
        if (response.ok) {
          await cache.put(url, response.clone());
          cached.push(url);
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('Tile fetch failed:', url, err.message);
        }
      }
      completed++;
      onProgress(completed, urls.length);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return cached;
}

// ─── Map Initialization ──────────────────────────────────────────────────────

function initMap() {
  const styleUrl = `${CONFIG.STYLE_URL}?key=${CONFIG.MAPTILER_KEY}`;

  state.map = new maplibregl.Map({
    container: 'map',
    style: styleUrl,
    center: [-110.5, 43.5],
    zoom: 12,
    attributionControl: true,
  });

  state.map.addControl(new maplibregl.NavigationControl(), 'top-left');
  // GeolocateControl removed — duplicates the Center on Me FAB

  state.map.on('load', () => {
    // Active trail line (live GPS breadcrumb)
    state.map.addSource('active-trail', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
    });
    state.map.addLayer({
      id: 'active-trail-line',
      type: 'line',
      source: 'active-trail',
      paint: {
        'line-color': '#00e5a0',
        'line-width': 4,
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // Active position dot
    state.map.addSource('active-position', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } },
    });
    state.map.addLayer({
      id: 'active-position-dot',
      type: 'circle',
      source: 'active-position',
      paint: {
        'circle-radius': 8,
        'circle-color': '#ffffff',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#00e5a0',
      },
    });

    // Saved trails collection
    state.map.addSource('saved-trails', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    state.map.addLayer({
      id: 'saved-trails-line',
      type: 'line',
      source: 'saved-trails',
      paint: {
        'line-color': '#6eb5ff',
        'line-width': 3,
        'line-cap': 'round',
        'line-join': 'round',
        'line-opacity': 0.85,
      },
    });

    // Try to center on user location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          state.map.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude],
            zoom: 13,
          });
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  });

  // Show offline banner when map fails to load tiles (no cache)
  state.map.on('error', (e) => {
    if (e.error?.message?.includes('Failed to fetch') || !navigator.onLine) {
      dom.offlineBanner.classList.add('show');
    }
  });
}

// ─── Offline Map Downloader ──────────────────────────────────────────────────

/** Fetch and cache shared map assets (style, sprites, glyphs) */
async function cacheSharedAssets(signal) {
  const styleUrl = `${CONFIG.STYLE_URL}?key=${CONFIG.MAPTILER_KEY}`;
  const cache = await caches.open(CONFIG.CACHE_NAME);

  const styleRes = await fetch(styleUrl, { signal });
  if (!styleRes.ok) throw new Error('Failed to fetch map style');
  await cache.put(styleUrl, styleRes.clone());
  const style = await styleRes.json();

  const urlsToCache = [];

  // Sprites
  if (style.sprite) {
    const spriteBase = style.sprite.includes('?')
      ? style.sprite
      : `${style.sprite}?key=${CONFIG.MAPTILER_KEY}`;
    urlsToCache.push(spriteBase + '.json', spriteBase + '.png', spriteBase + '@2x.json', spriteBase + '@2x.png');
  }

  // Glyphs — cache common Unicode blocks for fonts used in the style
  if (style.glyphs) {
    const glyphTemplate = style.glyphs.includes('key=')
      ? style.glyphs
      : `${style.glyphs}?key=${CONFIG.MAPTILER_KEY}`;
    const fonts = extractFontsFromStyle(style);
    const ranges = ['0-255', '256-511', '512-767', '768-1023', '1024-1279', '1280-1535'];
    for (const font of fonts) {
      for (const range of ranges) {
        urlsToCache.push(
          glyphTemplate
            .replace('{fontstack}', encodeURIComponent(font))
            .replace('{range}', range)
        );
      }
    }
  }

  // Tile source URL template
  let tileTemplate = null;
  for (const src of Object.values(style.sources || {})) {
    if (src.type === 'vector' && src.url) {
      // Source may reference a TileJSON — fetch it
      const tileJsonUrl = src.url.includes('key=')
        ? src.url
        : `${src.url}?key=${CONFIG.MAPTILER_KEY}`;
      try {
        const tjRes = await fetch(tileJsonUrl, { signal });
        if (tjRes.ok) {
          await cache.put(tileJsonUrl, tjRes.clone());
          const tileJson = await tjRes.json();
          if (tileJson.tiles?.[0]) tileTemplate = tileJson.tiles[0];
        }
      } catch { /* fall through */ }
    }
    if (src.type === 'vector' && src.tiles?.[0]) {
      tileTemplate = src.tiles[0];
    }
  }

  // Fallback tile template for MapTiler outdoor
  if (!tileTemplate) {
    tileTemplate = `https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=${CONFIG.MAPTILER_KEY}`;
  }

  // Cache shared asset URLs (non-fatal failures)
  await fetchAndCacheBatch(urlsToCache, CONFIG.DOWNLOAD_CONCURRENCY, () => {}, signal);

  return tileTemplate;
}

/** Extract font stack names from style layers */
function extractFontsFromStyle(style) {
  const fonts = new Set(['Noto Sans Regular']);
  for (const layer of style.layers || []) {
    if (layer.layout?.['text-font']) {
      const stack = layer.layout['text-font'];
      if (Array.isArray(stack)) stack.forEach((f) => fonts.add(f));
    }
  }
  return [...fonts];
}

/** Start downloading the current map view */
async function startDownload() {
  if (state.downloading) return;

  const maxZoom = parseInt(dom.maxZoom.value, 10);
  const bounds = state.map.getBounds();
  const minZoom = CONFIG.MIN_DOWNLOAD_ZOOM;

  state.downloading = true;
  state.downloadAbort = new AbortController();
  const { signal } = state.downloadAbort;

  dom.progressWrap.classList.add('active');
  dom.downloadStart.disabled = true;
  dom.progressFill.style.width = '0%';
  dom.progressText.textContent = 'Caching map assets…';

  try {
    // Step 1: cache shared assets and get tile template
    const tileTemplate = await cacheSharedAssets(signal);
    if (signal.aborted) return;

    // Step 2: enumerate tiles
    const tileUrls = enumerateTileUrls(bounds, minZoom, maxZoom, tileTemplate);

    if (tileUrls.length > CONFIG.TILE_WARN_THRESHOLD) {
      const proceed = await showConfirm(
        'Large Download',
        `This will cache ${tileUrls.length.toLocaleString()} tiles. This may use significant storage. Continue?`,
        'Download'
      );
      if (!proceed) {
        resetDownloadUI();
        return;
      }
    }

    dom.progressText.textContent = `Downloading 0 / ${tileUrls.length} tiles…`;

    // Step 3: fetch tiles with concurrency
    const cachedUrls = await fetchAndCacheBatch(
      tileUrls,
      CONFIG.DOWNLOAD_CONCURRENCY,
      (done, total) => {
        const pct = Math.round((done / total) * 100);
        dom.progressFill.style.width = `${pct}%`;
        dom.progressText.textContent = `Downloading ${done.toLocaleString()} / ${total.toLocaleString()} tiles…`;
      },
      signal
    );

    if (signal.aborted) return;

    // Step 4: prompt for region name
    state.pendingRegionTiles = cachedUrls;
    state.pendingRegionBounds = {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    };
    state.pendingRegionZoom = { min: minZoom, max: maxZoom };

    dom.downloadPanel.classList.remove('open');
    resetDownloadUI();
    openNameModal('region', defaultMapName());

    showToast(`Cached ${cachedUrls.length.toLocaleString()} tiles`);
  } catch (err) {
    if (err.name === 'AbortError') {
      showToast('Download cancelled');
    } else if (err.name === 'QuotaExceededError' || err.message?.includes('quota')) {
      showToast('Storage full — try a smaller area or delete cached maps');
    } else {
      console.error('Download error:', err);
      showToast('Download failed — check connection');
    }
    resetDownloadUI();
  }
}

function resetDownloadUI() {
  state.downloading = false;
  state.downloadAbort = null;
  dom.progressWrap.classList.remove('active');
  dom.downloadStart.disabled = false;
  dom.progressFill.style.width = '0%';
}

function cancelDownload() {
  if (state.downloadAbort) {
    state.downloadAbort.abort();
  }
  resetDownloadUI();
  dom.downloadPanel.classList.remove('open');
}

// ─── Cached Maps Management ──────────────────────────────────────────────────

/** Build a set of all tile URLs referenced by regions except excludeId */
async function getOtherRegionTileUrls(excludeId) {
  const regions = await getAllRegions();
  const set = new Set();
  for (const r of regions) {
    if (r.id !== excludeId) {
      for (const url of r.tileUrls || []) set.add(url);
    }
  }
  return set;
}

/** Delete tile URLs from cache, respecting reference counts from other regions */
async function evictRegionTiles(region, excludeFromRefCount) {
  const otherUrls = await getOtherRegionTileUrls(region.id);
  const toDelete = (region.tileUrls || []).filter((url) => !otherUrls.has(url));

  const cache = await caches.open(CONFIG.CACHE_NAME);
  let deleted = 0;

  // Delete in batches with concurrency limit
  let idx = 0;
  async function worker() {
    while (idx < toDelete.length) {
      const i = idx++;
      const deletedOk = await cache.delete(toDelete[i]);
      if (deletedOk) deleted++;
    }
  }
  await Promise.all(
    Array.from({ length: CONFIG.DELETE_CONCURRENCY }, () => worker())
  );
  return deleted;
}

/** Render the cached maps drawer */
async function renderRegionsDrawer() {
  const regions = await getAllRegions();
  regions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Storage summary
  try {
    const est = await navigator.storage.estimate();
    const usedMB = ((est.usage || 0) / 1024 / 1024).toFixed(1);
    const quotaMB = ((est.quota || 0) / 1024 / 1024).toFixed(0);
    dom.regionsSummary.textContent = `${regions.length} region${regions.length !== 1 ? 's' : ''} · ${usedMB} MB used of ${quotaMB} MB`;
  } catch {
    dom.regionsSummary.textContent = `${regions.length} cached region${regions.length !== 1 ? 's' : ''}`;
  }

  if (regions.length === 0) {
    dom.regionsList.innerHTML =
      '<div class="drawer-empty">No offline maps cached yet. Download your current view to get started.</div>';
    return;
  }

  dom.regionsList.innerHTML = regions
    .map(
      (r) => `
    <div class="drawer-item" data-region-id="${r.id}">
      <div class="drawer-item-body">
        <div class="drawer-item-name">${escapeHtml(r.name)}</div>
        <div class="drawer-item-meta">
          ${formatDate(r.createdAt)}<br>
          z${r.minZoom}–z${r.maxZoom} · ${(r.tileCount || 0).toLocaleString()} tiles
        </div>
      </div>
      <div class="drawer-item-actions">
        <button class="icon-btn" data-action="fly" data-id="${r.id}" title="Fly to region" aria-label="Fly to region">
          <svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        </button>
        <button class="icon-btn" data-action="rename" data-id="${r.id}" title="Rename" aria-label="Rename">
          <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        </button>
        <button class="icon-btn danger" data-action="delete" data-id="${r.id}" title="Delete" aria-label="Delete">
          <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    </div>`
    )
    .join('');

  // Bind region action buttons
  dom.regionsList.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => handleRegionAction(btn.dataset.action, parseInt(btn.dataset.id, 10)));
  });
}

async function handleRegionAction(action, id) {
  const regions = await getAllRegions();
  const region = regions.find((r) => r.id === id);
  if (!region) return;

  if (action === 'fly') {
    const b = region.bounds;
    state.map.fitBounds(
      [[b.west, b.south], [b.east, b.north]],
      { padding: 40, duration: 1200 }
    );
    closeDrawer('regions');
    return;
  }

  if (action === 'rename') {
    state.nameModalMode = 'rename-region';
    state.renameRegionId = id;
    openNameModal('rename-region', region.name);
    return;
  }

  if (action === 'delete') {
    const confirmed = await showConfirm(
      'Delete Cached Map',
      `Delete "${region.name}"? This removes ${(region.tileCount || 0).toLocaleString()} offline tiles.`
    );
    if (!confirmed) return;

    const deleted = await evictRegionTiles(region);
    await deleteRegion(id);
    showToast(`Deleted "${region.name}" (${deleted.toLocaleString()} tiles removed)`);
    renderRegionsDrawer();
  }
}

async function deleteAllRegions() {
  const regions = await getAllRegions();
  if (regions.length === 0) return;

  const confirmed = await showConfirm(
    'Delete All Cached Maps',
    `Delete all ${regions.length} cached regions and their tiles? This cannot be undone.`
  );
  if (!confirmed) return;

  const cache = await caches.open(CONFIG.CACHE_NAME);
  const allUrls = new Set();
  for (const r of regions) {
    for (const url of r.tileUrls || []) allUrls.add(url);
  }
  await Promise.all([...allUrls].map((url) => cache.delete(url)));
  for (const r of regions) await deleteRegion(r.id);

  showToast('All cached maps deleted');
  renderRegionsDrawer();
}

// ─── GPS Tracking ────────────────────────────────────────────────────────────

function startTracking() {
  if (state.tracking) return;
  if (!navigator.geolocation) {
    showToast('Geolocation not supported on this device');
    return;
  }

  state.tracking = true;
  state.coordinates = [];
  state.distanceMeters = 0;
  state.lastPosition = null;
  state.lastTimestamp = null;
  state.startTime = Date.now();

  dom.hud.classList.remove('hidden');
  dom.btnTrack.classList.add('tracking');
  dom.btnTrack.title = 'Stop & Save';
  dom.btnTrack.setAttribute('aria-label', 'Stop and Save');
  dom.btnTrack.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>';

  // Duration timer — updates HUD every second
  state.timerInterval = setInterval(updateStatsHUD, 1000);

  state.watchId = navigator.geolocation.watchPosition(
    onPositionUpdate,
    onPositionError,
    CONFIG.GPS_OPTIONS
  );
}

function stopTracking() {
  if (!state.tracking) return;

  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  state.tracking = false;

  dom.btnTrack.classList.remove('tracking');
  dom.btnTrack.title = 'Start Tracking';
  dom.btnTrack.setAttribute('aria-label', 'Start Tracking');
  dom.btnTrack.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';

  // Open save modal if we have enough points
  if (state.coordinates.length >= 2) {
    openNameModal('trail', `Hike ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
  } else {
    dom.hud.classList.add('hidden');
    clearActiveTrail();
    showToast('Not enough GPS points to save');
  }
}

function onPositionUpdate(pos) {
  const { latitude, longitude, accuracy } = pos.coords;
  const timestamp = pos.timestamp;

  // Skip low-accuracy fixes
  if (accuracy > CONFIG.GPS_ACCURACY_THRESHOLD) return;

  // Skip duplicate timestamps
  if (timestamp === state.lastTimestamp) return;

  const coord = [longitude, latitude];

  // Accumulate distance
  if (state.lastPosition) {
    state.distanceMeters += haversineMeters(state.lastPosition, coord);
  }

  state.coordinates.push(coord);
  state.lastPosition = coord;
  state.lastTimestamp = timestamp;

  // Update map layers
  updateActiveTrail();
  updateActivePosition(coord);

  // Lock camera to GPS if enabled
  if (state.lockToGps) {
    state.map.easeTo({
      center: coord,
      zoom: Math.max(state.map.getZoom(), 14),
      duration: 800,
    });
  }

  dom.hudWarning.textContent = '';
}

function onPositionError(err) {
  console.warn('GPS error:', err.message);
  dom.hudWarning.textContent = 'GPS signal weak';
  // Do not stop tracking — wait for signal to return
}

function updateActiveTrail() {
  if (!state.map?.getSource('active-trail')) return;
  state.map.getSource('active-trail').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: state.coordinates },
  });
}

function updateActivePosition(coord) {
  if (!state.map?.getSource('active-position')) return;
  state.map.getSource('active-position').setData({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coord },
  });
}

function clearActiveTrail() {
  if (!state.map?.getSource('active-trail')) return;
  state.map.getSource('active-trail').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [] },
  });
  state.map.getSource('active-position').setData({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
  });
}

function updateStatsHUD() {
  if (!state.startTime) return;
  const elapsed = (Date.now() - state.startTime) / 1000;
  dom.statDuration.textContent = formatDuration(elapsed);
  dom.statDistance.textContent = formatDistance(state.distanceMeters);
  const speed = elapsed > 1 ? state.distanceMeters / elapsed : 0;
  dom.statSpeed.textContent = formatSpeed(speed);
}

// ─── Saved Trails ────────────────────────────────────────────────────────────

async function saveCurrentTrail(name) {
  const elapsed = (Date.now() - state.startTime) / 1000;
  const record = {
    name,
    coordinates: [...state.coordinates],
    distance: state.distanceMeters,
    duration: elapsed,
    createdAt: new Date().toISOString(),
    geojson: {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [...state.coordinates] },
      properties: { name },
    },
  };

  await saveTrail(record);
  dom.hud.classList.add('hidden');
  clearActiveTrail();
  state.coordinates = [];
  state.distanceMeters = 0;
  state.startTime = null;
  showToast(`Trail "${name}" saved`);
  renderTrailsDrawer();
}

async function renderTrailsDrawer() {
  const trails = await getAllTrails();
  trails.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (trails.length === 0) {
    dom.trailsList.innerHTML =
      '<div class="drawer-empty">No saved hikes yet. Start tracking to record your first trail.</div>';
    return;
  }

  dom.trailsList.innerHTML = trails
    .map(
      (t) => `
    <div class="drawer-item">
      <input type="checkbox" class="trail-toggle" data-trail-id="${t.id}"
        ${state.visibleTrails.has(t.id) ? 'checked' : ''}
        aria-label="Show ${escapeHtml(t.name)} on map">
      <div class="drawer-item-body">
        <div class="drawer-item-name">${escapeHtml(t.name)}</div>
        <div class="drawer-item-meta">
          ${formatDate(t.createdAt)}<br>
          ${formatDistance(t.distance)} · ${formatDuration(t.duration)}
        </div>
      </div>
      <div class="drawer-item-actions">
        <button class="icon-btn danger" data-delete-trail="${t.id}" title="Delete trail" aria-label="Delete trail">
          <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    </div>`
    )
    .join('');

  dom.trailsList.querySelectorAll('.trail-toggle').forEach((cb) => {
    cb.addEventListener('change', () => toggleTrailOnMap(parseInt(cb.dataset.trailId, 10), cb.checked));
  });

  dom.trailsList.querySelectorAll('[data-delete-trail]').forEach((btn) => {
    btn.addEventListener('click', () => handleDeleteTrail(parseInt(btn.dataset.deleteTrail, 10)));
  });
}

async function toggleTrailOnMap(id, visible) {
  if (visible) {
    state.visibleTrails.add(id);
  } else {
    state.visibleTrails.delete(id);
  }
  await refreshSavedTrailsLayer();
}

async function refreshSavedTrailsLayer() {
  const trails = await getAllTrails();
  const features = trails
    .filter((t) => state.visibleTrails.has(t.id))
    .map((t) => ({
      ...t.geojson,
      properties: { ...t.geojson.properties, id: t.id, name: t.name },
    }));

  if (state.map?.getSource('saved-trails')) {
    state.map.getSource('saved-trails').setData({
      type: 'FeatureCollection',
      features,
    });
  }
}

async function handleDeleteTrail(id) {
  const trails = await getAllTrails();
  const trail = trails.find((t) => t.id === id);
  if (!trail) return;

  const confirmed = await showConfirm('Delete Trail', `Delete "${trail.name}"? This cannot be undone.`);
  if (!confirmed) return;

  await deleteTrail(id);
  state.visibleTrails.delete(id);
  await refreshSavedTrailsLayer();
  renderTrailsDrawer();
  showToast(`Trail "${trail.name}" deleted`);
}

// ─── Name Modal ──────────────────────────────────────────────────────────────

function openNameModal(mode, defaultName = '') {
  state.nameModalMode = mode;

  if (mode === 'trail') {
    dom.nameModalTitle.textContent = 'Name your trail';
    dom.nameModalDesc.textContent = 'Give this hike a memorable name.';
  } else if (mode === 'region') {
    dom.nameModalTitle.textContent = 'Name this map region';
    dom.nameModalDesc.textContent = 'Label this offline area so you can find it later.';
  } else if (mode === 'rename-region') {
    dom.nameModalTitle.textContent = 'Rename map region';
    dom.nameModalDesc.textContent = 'Enter a new name for this cached area.';
  }

  dom.nameInput.value = defaultName;
  dom.nameModal.classList.add('open');
  dom.nameInput.focus();
  dom.nameInput.select();
}

function closeNameModal() {
  dom.nameModal.classList.remove('open');
  state.nameModalMode = null;
  state.renameRegionId = null;
}

async function handleNameSave() {
  const name = dom.nameInput.value.trim();
  if (!name) {
    dom.nameInput.focus();
    return;
  }

  const mode = state.nameModalMode;
  const renameId = state.renameRegionId;
  closeNameModal();

  if (mode === 'trail') {
    await saveCurrentTrail(name);
  } else if (mode === 'region') {
    const record = {
      name,
      bounds: state.pendingRegionBounds,
      minZoom: state.pendingRegionZoom.min,
      maxZoom: state.pendingRegionZoom.max,
      tileUrls: state.pendingRegionTiles,
      tileCount: state.pendingRegionTiles.length,
      createdAt: new Date().toISOString(),
    };
    await saveRegion(record);
    state.pendingRegionTiles = [];
    state.pendingRegionBounds = null;
    state.pendingRegionZoom = null;
    showToast(`Region "${name}" saved`);
    renderRegionsDrawer();
  } else if (mode === 'rename-region') {
    await updateRegion(renameId, { name });
    showToast(`Renamed to "${name}"`);
    renderRegionsDrawer();
  }
}

// ─── Drawer Helpers ──────────────────────────────────────────────────────────

function openDrawer(which) {
  const overlay = which === 'trails' ? dom.trailsOverlay : dom.regionsOverlay;
  const drawer = which === 'trails' ? dom.trailsDrawer : dom.regionsDrawer;
  overlay.classList.add('open');
  drawer.classList.add('open');
  if (which === 'trails') renderTrailsDrawer();
  if (which === 'regions') renderRegionsDrawer();
}

function closeDrawer(which) {
  const overlay = which === 'trails' ? dom.trailsOverlay : dom.regionsOverlay;
  const drawer = which === 'trails' ? dom.trailsDrawer : dom.regionsDrawer;
  overlay.classList.remove('open');
  drawer.classList.remove('open');
}

// ─── Center on Me ────────────────────────────────────────────────────────────

function centerOnMe() {
  if (!navigator.geolocation) {
    showToast('Geolocation not available');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.map.flyTo({
        center: [pos.coords.longitude, pos.coords.latitude],
        zoom: Math.max(state.map.getZoom(), 14),
        duration: 1000,
      });
    },
    () => showToast('Could not get your location'),
    CONFIG.GPS_OPTIONS
  );
}

// ─── HTML Escape ─────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Event Bindings ──────────────────────────────────────────────────────────

function bindEvents() {
  // Download
  dom.btnDownload.addEventListener('click', () => {
    dom.downloadPanel.classList.toggle('open');
  });
  dom.downloadStart.addEventListener('click', startDownload);
  dom.downloadCancel.addEventListener('click', cancelDownload);
  dom.openRegionsDrawer.addEventListener('click', () => {
    dom.downloadPanel.classList.remove('open');
    openDrawer('regions');
  });

  // Tracking
  dom.btnTrack.addEventListener('click', () => {
    if (state.tracking) stopTracking();
    else startTracking();
  });

  // Center & lock
  dom.btnCenter.addEventListener('click', centerOnMe);
  dom.btnLock.addEventListener('click', () => {
    state.lockToGps = !state.lockToGps;
    dom.btnLock.classList.toggle('active', state.lockToGps);
    showToast(state.lockToGps ? 'Camera locked to GPS' : 'Camera lock off');
  });

  // Trails drawer
  dom.btnTrails.addEventListener('click', () => openDrawer('trails'));
  dom.trailsClose.addEventListener('click', () => closeDrawer('trails'));
  dom.trailsOverlay.addEventListener('click', () => closeDrawer('trails'));

  // Regions drawer
  dom.regionsClose.addEventListener('click', () => closeDrawer('regions'));
  dom.regionsOverlay.addEventListener('click', () => closeDrawer('regions'));
  dom.btnDeleteAllRegions.addEventListener('click', deleteAllRegions);

  // Name modal
  dom.nameCancel.addEventListener('click', closeNameModal);
  dom.nameSave.addEventListener('click', handleNameSave);
  dom.nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleNameSave();
    if (e.key === 'Escape') closeNameModal();
  });
  dom.nameModal.addEventListener('click', (e) => {
    if (e.target === dom.nameModal) closeNameModal();
  });

  // Online/offline indicator
  window.addEventListener('online', () => dom.offlineBanner.classList.remove('show'));
  window.addEventListener('offline', () => {
    if (!state.downloading) dom.offlineBanner.classList.add('show');
  });
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  await registerServiceWorker();
  await requestPersistentStorage();
  initMap();
  bindEvents();
  renderRegionsDrawer();
}

document.addEventListener('DOMContentLoaded', init);
