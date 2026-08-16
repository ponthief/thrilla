// Push notifications (Firebase Cloud Messaging).
//
// Notifications arrive when the app is closed (e.g. a server-side background scan
// found a payment). Android displays notification-type messages automatically;
// this module just handles permission + registering the device token with the
// backend so the server knows where to send.
//
// Everything is wrapped so the app works fine when Firebase ISN'T configured
// (no android/app/google-services.json) — push simply stays off.
import { PermissionsAndroid, Platform } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import * as api from './api';
import { usePushBanner } from '@stores/pushBanner';

let unsubscribeRefresh: (() => void) | null = null;
let unsubscribeMessage: (() => void) | null = null;

// Show a foreground FCM message as an in-app banner. Android does NOT display
// notification-type messages while the app is in the foreground, so without this
// a payment that lands with the app open would be silent.
function handleForegroundMessage(msg: any): void {
  try {
    const n = msg?.notification;
    const title = n?.title || 'Payment received';
    const body = n?.body || msg?.data?.body || 'You have a new payment.';
    usePushBanner.getState().show({ title, body });
  } catch {
    /* never let a malformed message break the handler */
  }
}

// Ask the OS for notification permission. Called at first launch so the user is
// prompted early (before device-trust/token registration), and again defensively
// inside registerForPush. Returns true if notifications are allowed.
//
// Android 13+ (API 33) gates notifications behind the POST_NOTIFICATIONS runtime
// permission, which the OS does NOT auto-grant, and messaging().requestPermission()
// alone doesn't reliably show the Android system dialog — so request it explicitly.
// If already granted, PermissionsAndroid.request returns immediately with no
// second dialog. No-op that resolves true on Android <13. Safe if native push
// isn't available.
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      if (Number(Platform.Version) < 33) return true; // auto-granted pre-13
      const res = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      return res === PermissionsAndroid.RESULTS.GRANTED;
    }
    // iOS: the FCM/APNs authorization prompt.
    const status = await messaging().requestPermission();
    return (
      status === messaging.AuthorizationStatus.AUTHORIZED ||
      status === messaging.AuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

// Ask for notification permission (Android 13+ prompts), get the FCM token, and
// register it with the backend. Also keeps the backend in sync if the token
// rotates. Safe no-op if Firebase/native push isn't available.
export async function registerForPush(inkey: string): Promise<void> {
  try {
    // Ensure the OS notification permission (no-op / no second dialog if the
    // first-launch prompt already granted it). Without a grant, pushes are
    // silently dropped, so don't bother registering a token.
    if (!(await ensureNotificationPermission())) return;

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

    // Foreground messages: display them ourselves (Android won't).
    if (unsubscribeMessage) unsubscribeMessage();
    unsubscribeMessage = messaging().onMessage(async (msg) => {
      handleForegroundMessage(msg);
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
    if (unsubscribeMessage) {
      unsubscribeMessage();
      unsubscribeMessage = null;
    }
    const token = await messaging().getToken();
    if (token) await api.unregisterPushToken(inkey, token);
  } catch {
    /* ignore */
  }
}
