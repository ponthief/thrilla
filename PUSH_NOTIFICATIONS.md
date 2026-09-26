# Push notifications (FCM) setup

The app can push a notification while it is closed: "Payment received" when the
server-side background scan finds funds, "Payment confirmed" when a send gets
its first confirmation, and "Tango" when someone asks to connect or a mix is
waiting on your turn. Delivery uses Firebase Cloud Messaging (FCM). The code is
in place; these are the credentials/config steps only you can do.

Until this is configured, everything still builds and runs — push just stays
off (no crashes, no build break).

## 1. Firebase project
1. Create a Firebase project (console.firebase.google.com).
2. Add an **Android app** with the app's applicationId: `com.whispawallet.app`
   (mainnet) and, if you want push on signet too, also `com.whispawallet.app.signet`.
3. Download **`google-services.json`** and place it at:
   `android/app/google-services.json`
   (The Gradle plugin is applied only when this file exists.)
4. Rebuild the APK: `npm run apk:mainnet`.

The client automatically requests notification permission and registers its FCM
token with the backend after login (`src/services/push.ts`).

## 2. Backend (siLNt) — sender credentials
1. In **the same Firebase project as step 1**, create a **service account** key
   with the Firebase Cloud Messaging API enabled and download its JSON.
2. Put it on the siLNt server and set the environment variable:
   `SILNT_FCM_CREDENTIALS=/absolute/path/to/service-account.json`
3. Restart LNbits. If the var is unset/missing, the backend simply doesn't send
   (no error).

> **The two halves must be the same project, and getting it wrong destroys
> tokens.** A token minted from one project's `google-services.json` cannot be
> sent to with another project's service account: FCM answers `404 UNREGISTERED`,
> which `helpers/fcm.py` cannot tell apart from a genuinely dead token — so it
> calls `remove_fcm_token` and deletes a valid one. The app re-registers, the
> next send purges it again, and push never works. Check both ends agree:
>
> ```bash
> jq -r '.project_info.project_id' android/app/google-services.json
> jq -r '.type, .project_id' /path/to/service-account.json
> ```
>
> This happened once for real, when the app moved to a new Firebase project
> (`whispa-…`) while `SILNT_FCM_CREDENTIALS` still pointed at a service account
> for the old one (`thrilla-…`).

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
- Messages are **data-only** — no `notification` block (`helpers/fcm.py`,
  `_build_message`). That is deliberate and load-bearing: a `notification` block
  makes the firebase SDK on the device build and post the notification itself,
  inside Google's code, and the app then cannot put its logo on it. The large
  icon is the only full-colour slot a notification has — the small icon is an
  alpha mask, so the mark would flatten to a blob — and FCM has no field for a
  large icon. Adding a `notification` block back takes the logo away silently.
  `tests/test_fcm_message.py` in siLNt pins this.
- With the app backgrounded/closed, the notification is therefore built by the
  app: `android/app/src/main/java/.../notify/PaymentNotificationReceiver.kt`.
  A broadcast receiver on `com.google.android.c2dm.intent.RECEIVE`, not a
  `FirebaseMessagingService` — a second service would displace the one
  `@react-native-firebase/messaging` declares and cut JS off from messages
  entirely. It needs no JavaScript, so a notification costs no React Native
  startup. Invalid tokens are pruned automatically.
- The logo is bundled (`res/drawable-xxhdpi/ic_notification_large.png`, generated
  from `src/assets/icon.png`). FCM's `image` field would have been far less code,
  but it makes the phone fetch a URL for every notification — a timestamped,
  per-IP record of when a user is paid, held by whoever serves it. Wrong trade
  for this wallet, and a bundled asset also works offline.
- The receiver's foreground check has to agree with
  `SharedUtils.isAppInForeground` in `@react-native-firebase`, which is what
  decides whether the library routes a message to JS or to the headless task.
  If both decided "foreground" the user would see nothing at all: a banner
  posted into a UI nobody is looking at, and no system notification.
- When the app is in the **foreground**, Android suppresses the system banner, so
  the app displays its own in-app banner instead (`src/components/PushBanner.tsx`,
  fed by the `messaging().onMessage` handler in `src/services/push.ts`).
- On logout the device unregisters its token.

## `type` — the field that decides whether anything appears at all

Every push carries a data map with a `type`: `payment`, `send_confirmed`,
`test` or `tango`. `PaymentNotificationReceiver.kt` **refuses one it doesn't
recognise**, and because the messages are data-only there is no SDK fallback
behind that refusal. An unlisted type doesn't degrade to a plain notification —
it produces nothing, on every phone, with the app closed, with nothing logged.

That's not hypothetical. `tango` was sent by every endpoint of a round for as
long as Tango existed and was missing from the receiver's list the whole time,
so a mix invitation reached nobody who wasn't already looking at the app.

Adding a kind of push therefore takes **three** edits, not one:

| Where | What |
| --- | --- |
| siLNt `tests/test_fcm_message.py` | `PUSH_TYPES` — the sending end |
| `src/services/push.ts` | `PUSH_TYPES` — chooses the foreground banner's wording |
| `android/.../notify/PaymentNotificationReceiver.kt` | `KNOWN_TYPES` — the notification with the app closed, and the one that silently does nothing if you forget |

The siLNt test fails if the server sends a type not on its list;
`scripts/check-settings-ui.cjs` fails if the JS and Kotlin lists disagree.

Payments and Tango sit on **separate notification channels** (`payments` and
`tango`), so the OS switch that silences one leaves the other alone, and system
settings describes each correctly.

## Turning it off (Settings → Notifications → Alerts)

Users who'd rather use the app silently can switch **Alerts** off. It's a
per-device preference (stored in the platform keystore via
`src/services/notifyPrefs.ts`, mirrored in `src/stores/notifyStore.ts`), so
turning it off on one phone leaves another phone on the same account alerting.

Off means every surface goes quiet:

| Surface | How it's suppressed |
| --- | --- |
| System notification while the app is closed | `App.tsx` removes this device's FCM token from the server (`DELETE /api/v1/fcm/token`) and stops registering it, so there's nothing to push to. The removal is retried every session while the switch is off, in case it first failed offline. |
| In-app banner for a foreground push | `handleForegroundMessage` in `src/services/push.ts` drops the message. |
| In-app banner from the foreground catch-up scan | `src/hooks/useCatchUpScan.ts` skips the banner when it finds new coins. |
| In-app banner when a send confirms | `src/hooks/useSendConfirmations.ts` skips it. |
| In-app banner when a Tango turn becomes yours | `src/hooks/useTangoWatch.ts` skips it. The tab badge still counts them — a number on a tab is not an interruption. |

Coins still arrive and still show up in the balance and history, Tango requests
and rounds still appear under Tango — only the announcement is suppressed.
Turning the switch back on re-requests the OS notification permission if needed
(Settings shows a link to the system settings when Android has stopped
prompting) and re-registers the token.

Because the mechanism is token removal, no backend change is involved: the
server simply has no device to send to.

### Why one switch and not one per kind

Splitting payments from Tango is the obvious shape and can't be honoured from
the client. One device token carries every kind of message, so not holding a
token is the only thing that stops a notification with the app closed — an
all-or-nothing lever. The notification is built at that point by native code
that has no way to read a keystore-backed JS preference (the app has no
SharedPreferences bridge). A second switch would have gone on silencing the
in-app banner while the phone kept buzzing.

Per-kind control needs the **server** to know which kinds each token wants, so
it sends only those: a `kinds` column on `fcm_tokens`, accepted by
`POST /api/v1/fcm/token` and filtered in `list_fcm_tokens_for_user`. That's a
backend change, and it's the better privacy answer too — the unwanted push is
never sent, rather than sent and discarded. Until then, the OS notification
channels give per-kind control from system settings.

## Privacy

FCM "notification" messages pass their title/body/data through Google in
plaintext (that's how Android shows them while the app is closed). To avoid
leaking financial metadata, the payment push is deliberately **generic** —
"You've received a new payment" — with **no amount, wallet name, or count**.
Google therefore only learns that *a* payment arrived at a given time on the
device, not how much.

The **amount** is shown only inside the app: the in-app banner is composed
locally from the wallet's own scan data and never traverses FCM. Note the
server itself already sees your amounts (background scanning uses your scan
key by design); the generic push is specifically about keeping that data off
Google's servers.
