# TopoCache

Offline topo maps and hike tracking for the backcountry. Runs as a **PWA** in the browser or as a **native Android app** with background GPS while the screen is off.

## Prerequisites

1. **MapTiler API key** — [Create a free key](https://cloud.maptiler.com/) for map tiles and styles.

2. **MapLibre GL JS** — Place these files in `vendor/` (not included in the repo):
   - `vendor/maplibre-gl.js`
   - `vendor/maplibre-gl.css`

   Download from [MapLibre GL JS releases](https://github.com/maplibre/maplibre-gl-js/releases) or copy from `node_modules/maplibre-gl/dist/` if you install the package locally.

3. **Config file** — Copy the example config and add your key:

   ```bash
   cp config.example.js config.js
   ```

   Edit `config.js` and set `MAPTILER_KEY`. This file is gitignored.

## Run locally (web / PWA)

The app is static HTML/JS. Serve it over HTTP (required for the service worker and geolocation):

```bash
npx serve .
```

Open the URL shown (usually `http://localhost:3000`). For installable PWA behavior, use Chrome on Android or a desktop browser that supports PWAs.

### Using the app

- **Track** — Start/stop hike recording; distance follows your GPS breadcrumb path.
- **Trails** — View and manage saved hikes.
- **Regions** — Download map tiles for offline use in an area.

GPS tracking in the browser/PWA is **unreliable with the screen off**. Use the Android app for that.

## Run on Android (background GPS)

The Android app uses Capacitor and records location in the background via a foreground-service notification.

**Requirements:** Node.js 20+, [Android Studio](https://developer.android.com/studio), USB device or emulator.

```bash
npm install
npm run cap:sync      # build web assets into www/ and sync Android project
npm run cap:open      # open Android Studio
```

In Android Studio, click **Run** on a device or emulator.

After changing web files (`app.js`, `index.html`, etc.):

```bash
npm run cap:sync
```

Then rebuild from Android Studio.

### Android permissions

- **Location** — Allow when prompted. For screen-off tracking, use **Allow all the time** in system settings if needed.
- **Notifications** (Android 13+) — Required while a hike is recording.

See [ANDROID.md](ANDROID.md) for release builds and Play Store notes.

## Deploy to GitHub Pages

Pushes to `main` deploy automatically via GitHub Actions. Set the repository secret:

- `MAPTILER_KEY` — Your MapTiler API key

The workflow writes `config.js` at deploy time. Local `config.js` is not used in CI.

## Project layout

| Path | Purpose |
|------|---------|
| `index.html`, `app.js` | App UI and logic |
| `sw.js` | Service worker (offline caching) |
| `config.js` | Local MapTiler key (gitignored) |
| `vendor/` | MapLibre GL assets |
| `native-gps.mjs` | Capacitor background-GPS bridge |
| `scripts/build-www.mjs` | Builds `www/` for Capacitor |
| `android/` | Generated Android project (gitignored) |

## npm scripts

| Command | Description |
|---------|-------------|
| `npm run build:cap` | Copy web assets to `www/` and bundle native GPS module |
| `npm run cap:sync` | Build + sync to Android project |
| `npm run cap:open` | Open Android Studio |
