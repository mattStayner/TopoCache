import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');

export function isNativePlatform() {
  return Capacitor.isNativePlatform();
}

async function ensureNotificationPermission() {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display === 'granted') return;
    await LocalNotifications.requestPermissions();
  } catch (err) {
    console.warn('Notification permission request failed', err);
  }
}

export async function startBackgroundGps(onLocation, onError) {
  await ensureNotificationPermission();

  return BackgroundGeolocation.addWatcher(
    {
      backgroundMessage: 'Tap to return to TopoCache',
      backgroundTitle: 'Recording hike',
      requestPermissions: true,
      stale: false,
      distanceFilter: 10,
    },
    (location, error) => {
      if (error) {
        onError(error);
        return;
      }
      onLocation(location);
    }
  );
}

export async function stopBackgroundGps(watcherId) {
  if (watcherId != null) {
    await BackgroundGeolocation.removeWatcher({ id: watcherId });
  }
}

export async function openLocationSettings() {
  await BackgroundGeolocation.openSettings();
}
