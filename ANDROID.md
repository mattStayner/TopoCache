# Android app (Capacitor)

TopoCache runs as a native Android app with **background GPS** via `@capacitor-community/background-geolocation`. The web/PWA build is unchanged; Capacitor uses a separate `www/` output.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Android Studio](https://developer.android.com/studio) (SDK, emulator or USB device)
- MapTiler key in `config.js` (copy from `config.example.js`)

If `vendor/` is missing, add MapLibre GL files there before building:

- `vendor/maplibre-gl.js`
- `vendor/maplibre-gl.css`

## Build and run

```bash
npm install
npm run cap:sync      # copies web assets to www/ and syncs Android project
npm run cap:open      # opens Android Studio
```

In Android Studio: Run on a device or emulator.

After changing `app.js`, `index.html`, or other web files:

```bash
npm run cap:sync
```

Then rebuild/run from Android Studio.

## First run: permissions

On Android 10+, grant **Allow all the time** for location when prompted (or in system Settings → Apps → TopoCache → Permissions). Background tracking needs this; “While using the app” alone is not enough for screen-off recording.

On Android 13+, allow **Notifications** when prompted — the foreground-service notification is required while a hike is recording.

## What changes on native vs PWA

| | PWA (browser) | Android app |
|---|---|---|
| GPS API | `navigator.geolocation` | Background geolocation plugin |
| Screen off | Unreliable | Foreground service + notification |
| Deploy | GitHub Pages | APK/AAB from Android Studio |

## Release build

Android Studio → **Build → Generate Signed Bundle / APK**. You’ll need a keystore for Play Store uploads.

Google Play requires a [background location declaration](https://support.google.com/googleplay/android-developer/answer/9799150) for fitness/navigation apps.
