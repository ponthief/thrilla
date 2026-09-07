# Building the Thrilla Android APK (React Native)

This branch builds the **pure React Native** Android app (Expo removed). The
Vue/Capacitor web app lives on the `master` branch.

## Requirements

- Android Studio (Hedgehog or newer): https://developer.android.com/studio
- **Java 17 JDK** — React Native 0.73.6 targets JDK 17. Do **not** use JDK 21:
  its `jlink` breaks AGP 8.1.1's JdkImageTransform (see Troubleshooting).
- Node.js 18+
- Android SDK Platform 34 + Build-Tools 34.0.0

## Install Java 17

```bash
# Ubuntu/Debian
sudo apt install openjdk-17-jdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

# macOS
brew install openjdk@17
export JAVA_HOME=$(brew --prefix openjdk@17)

# Verify
java -version   # must show 17.x
```

In Android Studio: **Settings → Build, Execution, Deployment → Build Tools →
Gradle → Gradle JDK → 17**.

## First-time setup (run in project root)

```bash
npm install
```

Create `android/local.properties` pointing at your SDK if Studio hasn't:

```
sdk.dir=/home/YOUR_USER/Android/Sdk
```

## Backend configuration (LNbits server)

The app reads its backend URL and settings at build time via
`react-native-config`, from an env file selected with `ENVFILE` — the mobile
analog of the web build's `vite build --mode mainnet`. The keys live in
`.env.mainnet` (`LNBITS_URL`, `SILNT_PREFIX`, `NETWORK_LOCK`, `APP_NAME`,
`PAYJOIN_ENABLED`); see `.env.example`.

`LNBITS_URL` **must** be a full absolute URL to the backend (there is no
same-origin fallback in the APK).

## App Links: making the verification email open the app

Registration emails link to the web app's `/verify?token=…` page. That URL is
declared as an Android App Link, so on a device with the app installed the link
opens the app, which redeems the token itself and signs the user straight in
instead of sending them back through a browser to a login form.

This needs one thing served from the domain. **Until it is, nothing breaks** —
Android's verification simply fails, the link opens in a browser, and the web
`/verify` page completes registration exactly as before.

### 1. Check the host matches

`android/app/build.gradle` sets `verifyHost` per flavor:

| flavor | verifyHost | applicationId |
| --- | --- | --- |
| mainnet | `signet.thrilla.me` | `com.thrilla_btc.thrilla` |
| signet | `signet.thrilla.me` | `com.thrilla_btc.thrilla.signet` |

Each must equal the host of `SILNT_FRONTEND_URL` on the LNbits instance that
flavor talks to, because that is the host the backend puts in verification
emails. A mismatch is silent — Android never verifies the link and it keeps
opening in a browser.

Both are `signet.thrilla.me` because that is what both backends are currently
configured with.

> **A mainnet backend pointing at the signet frontend cannot complete a
> registration.** The token is encrypted with `settings.auth_secret_key`
> (`AESCipher` in `lnbits/helpers.py`), which is per-instance. A link minted by
> the mainnet backend, opened against a frontend that talks to the signet
> backend, is decrypted with the wrong key: `decrypt_internal_message` returns
> nothing and the user is told the link is invalid or expired. Give the mainnet
> backend its own `SILNT_FRONTEND_URL` before mainnet registration goes live,
> and change `verifyHost` for the mainnet flavor to match.

Because both flavors share a host today, that host's `assetlinks.json` must list
**both** package names (the file is an array of statements). A flavor missing
from it falls back to the browser. With both installed and both listed, Android
asks the user which app to open — unavoidable while they share a host, and it
goes away once mainnet gets its own frontend host.

### 2. Get the signing certificate's SHA-256 fingerprint

For the release keystore referenced by `THRILLA_STORE_FILE`:

```bash
keytool -list -v -keystore /path/to/thrilla-release.keystore \
        -alias thrilla | grep 'SHA256:'
```

For debug builds (a different certificate, so a different fingerprint):

```bash
keytool -list -v -keystore android/app/debug.keystore \
        -alias androiddebugkey -storepass android | grep 'SHA256:'
```

### 3. Serve `/.well-known/assetlinks.json`

At `https://<verifyHost>/.well-known/assetlinks.json`, as `application/json`,
over HTTPS with no redirect. One statement per applicationId that should claim
the URL — both flavors point at `signet.thrilla.me` today, so both belong in
this one file:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.thrilla_btc.thrilla",
      "sha256_cert_fingerprints": ["AA:BB:…:FF"]
    }
  },
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.thrilla_btc.thrilla.signet",
      "sha256_cert_fingerprints": ["AA:BB:…:FF"]
    }
  }
]
```

List every fingerprint that should match in each `sha256_cert_fingerprints`
array — add the debug certificate during development, and add Google Play's
app-signing certificate if the app is distributed through Play, since Play
re-signs uploads with its own key.

The docroot is the one serving the SPA for that host — the site that answers
`/verify`, not the marketing pages. Confirm with:

```bash
grep -rn -e server_name -e '\broot\b' /etc/nginx/sites-enabled/
```

**The SPA fallback will break this if you let it.** A wallet vhost has
`try_files $uri $uri/ /index.html`, which happily answers
`/.well-known/assetlinks.json` with the app's HTML — 200, `text/html`. Android
rejects that and reports nothing useful. Add an exception ahead of the fallback:

```nginx
location = /.well-known/assetlinks.json {
    default_type application/json;
    add_header Cache-Control "public, max-age=300";
    try_files $uri =404;
}
```

### 4. Verify it took

```bash
# after installing the APK
adb shell pm get-app-links com.thrilla_btc.thrilla
# want: the host listed as "verified"

# force a re-check without reinstalling
adb shell pm verify-app-links --re-verify com.thrilla_btc.thrilla

# test the intent directly, without waiting for an email
adb shell am start -a android.intent.action.VIEW \
  -d "https://signet.thrilla.me/verify?token=test"
```

If the host shows anything other than `verified`, the link keeps opening in the
browser. Usual causes: the JSON not served over HTTPS, served with the wrong
content type, behind a redirect, or listing a fingerprint that doesn't match the
certificate the installed APK was actually signed with.

## Build a debug APK

```bash
cd android
ENVFILE=.env.mainnet ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Without `ENVFILE` the build still succeeds but `Config.*` values are empty
(you'll see a "Missing .env file" notice), so the app won't reach a backend.

## Build a release (mainnet) APK

```bash
cd android
ENVFILE=.env.mainnet ./gradlew assembleRelease
```

> The release build is signed with the debug keystore by default. Generate your
> own keystore before publishing — see https://reactnative.dev/docs/signed-apk-android.

## Run on a connected device / emulator

```bash
# Terminal 1 — Metro bundler
npm start

# Terminal 2 — build, install and launch
ENVFILE=.env.mainnet npm run android
```

Install a prebuilt APK manually:

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

## Troubleshooting

**`JdkImageTransform` / `jlink` failure, "Could not resolve ... androidJdkImage":**
You're building with JDK 21. RN 0.73.6 uses AGP 8.1.1, which only supports JDK
17. Set `JAVA_HOME` to JDK 17 (or the Gradle JDK in Studio) and rebuild.

**`SDK location not found`:** create `android/local.properties` with `sdk.dir=...`.

**`gradlew: Permission denied`:** `chmod +x android/gradlew`.

**Wrong Java version:** `java -version` must show 17.x — not 21, not 11.

**Stale build:** `cd android && ./gradlew clean` then rebuild.
