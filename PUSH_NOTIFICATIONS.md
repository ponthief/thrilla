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

## Verifying it works

Once both sides are configured, sign in and open **Settings → Scanning → Send
test notification**. This sends a diagnostic push to your registered devices and
tells you exactly what's wrong if nothing arrives:

- *"Server has no FCM credentials"* → `SILNT_FCM_CREDENTIALS` isn't set (or the
  file is missing) on the backend.
- *"This device is not registered for push"* → the build has no
  `google-services.json`, or you didn't grant notification permission. Rebuild
  with the file present, allow notifications, then sign out and back in.
- *"Sent to N devices"* → the pipeline works. A real payment notification only
  fires from the **server background sweep** (every 30 min) when it discovers new
  UTXOs while the app is closed — so to test that path, send a payment and do
  **not** open the app, or the foreground catch-up scan will find it first and
  the sweep will have nothing new to announce.

## How it works
- On login the device registers its FCM token: `POST /api/v1/fcm/token`.
- When a background scan (opt-in "Background scanning" in Settings) finds new
  UTXOs for a wallet, the server pushes to that user's registered devices.
- Notification-type messages are displayed by Android automatically when the app
  is backgrounded/closed. Invalid tokens are pruned automatically.
- When the app is in the **foreground**, Android suppresses the system banner, so
  the app displays its own in-app banner instead (`src/components/PushBanner.tsx`,
  fed by the `messaging().onMessage` handler in `src/services/push.ts`).
- On logout the device unregisters its token.
