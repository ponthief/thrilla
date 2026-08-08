// Push notifications (Firebase Cloud Messaging).
//
// Notifications arrive when the app is closed (e.g. a server-side background scan
// found a payment). Android displays notification-type messages automatically;
// this module just handles permission + registering the device token with the
// backend so the server knows where to send.
//
// Everything is wrapped so the app works fine when Firebase ISN'T configured
// (no android/app/google-services.json) — push simply stays off.
import messaging from '@react-native-firebase/messaging';
import * as api from './api';

let unsubscribeRefresh: (() => void) | null = null;

// Ask for notification permission (Android 13+ prompts), get the FCM token, and
// register it with the backend. Also keeps the backend in sync if the token
// rotates. Safe no-op if Firebase/native push isn't available.
export async function registerForPush(inkey: string): Promise<void> {
  try {
    const status = await messaging().requestPermission();
    const granted =
      status === messaging.AuthorizationStatus.AUTHORIZED ||
      status === messaging.AuthorizationStatus.PROVISIONAL;
    if (!granted) return;

    const token = await messaging().getToken();
    if (token) await api.registerPushToken(inkey, token);

    if (unsubscribeRefresh) unsubscribeRefresh();
    unsubscribeRefresh = messaging().onTokenRefresh(async (t) => {
      try {
        await api.registerPushToken(inkey, t);
      } catch {
        /* transient — will re-register next launch */
      }
    });
  } catch {
    // Firebase not configured or native module unavailable — leave push off.
  }
}

// Stop this device from receiving pushes (on logout).
export async function unregisterForPush(inkey: string): Promise<void> {
  try {
    if (unsubscribeRefresh) {
      unsubscribeRefresh();
      unsubscribeRefresh = null;
    }
    const token = await messaging().getToken();
    if (token) await api.unregisterPushToken(inkey, token);
  } catch {
    /* ignore */
  }
}
