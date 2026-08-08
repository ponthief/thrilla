# Push notifications (FCM) setup

The app can push a "Payment received" notification when the server-side
background scan finds funds while the app is closed. Delivery uses Firebase
Cloud Messaging (FCM). The code is in place; these are the credentials/config
steps only you can do.

Until this is configured, everything still builds and runs — push just stays
off (no crashes, no build break).

## 1. Firebase project
1. Create a Firebase project (console.firebase.google.com).
2. Add an **Android app** with the app's applicationId: `com.thrilla_btc.thrilla`
   (mainnet) and, if you want push on signet too, also `com.thrilla_btc.thrilla.signet`.
3. Download **`google-services.json`** and place it at:
   `android/app/google-services.json`
   (The Gradle plugin is applied only when this file exists.)
4. Rebuild the APK: `npm run apk:mainnet`.

The client automatically requests notification permission and registers its FCM
token with the backend after login (`src/services/push.ts`).

## 2. Backend (siLNt) — sender credentials
1. In the Firebase project, create a **service account** key with the Firebase
   Cloud Messaging API enabled and download its JSON.
2. Put it on the siLNt server and set the environment variable:
   `SILNT_FCM_CREDENTIALS=/absolute/path/to/service-account.json`
3. Restart LNbits. If the var is unset/missing, the backend simply doesn't send
   (no error).

## How it works
- On login the device registers its FCM token: `POST /api/v1/fcm/token`.
- When a background scan (opt-in "Background scanning" in Settings) finds new
  UTXOs for a wallet, the server pushes to that user's registered devices.
- Notification-type messages are displayed by Android automatically when the app
  is backgrounded/closed. Invalid tokens are pruned automatically.
- On logout the device unregisters its token.
