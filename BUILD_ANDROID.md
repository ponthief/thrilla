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

## Easiest: let CI build it

Building locally means Gradle, a Kotlin compiler daemon, Metro and your editor
all competing for the same RAM. On a 16GB machine that is enough to take the
editor down mid-build, and the APK is not something you need a local toolchain
for.

`.github/workflows/build-android.yml` builds it on a GitHub runner instead:

1. **Actions** → **Build Android APK** → **Run workflow**
2. pick the branch, the flavour (`signet` / `mainnet`) and `release`
3. when it finishes, download the APK from the run's **Artifacts**
4. `adb install -r thrilla-signet-release-*.apk`

Or from the CLI:

```bash
gh workflow run build-android.yml -f flavor=signet -f buildType=release
gh run watch                     # then download from the run page
```

It also publishes the raw `.apk` as a rolling **prerelease** per flavour, so
there is a fixed URL you can open on the phone itself:

```
https://github.com/ponthief/thrilla/releases/download/ci-signet-release/thrilla-signet-release.apk
```

> The prerelease step needs **Settings → Actions → General → Workflow
> permissions** set to *Read and write permissions*, and no ruleset restricting
> tag or release creation. Without it the build still succeeds and the APK is
> still attached to the run as an artifact — only the fixed download URL is
> skipped, with a 403 explaining which setting to change.

### What CI produces depends on two optional secrets

With neither set it builds a debug-signed APK with no push — fine for looking at
a change on your own phone, not shippable. An APK signed with a different key
will not install over one signed with the real key, so uninstall first when
switching.

All of them go in the same place: **Settings → Secrets and variables → Actions
→ New repository secret**. Nothing goes in the repository itself.

| Secret | Value |
|---|---|
| `GOOGLE_SERVICES_JSON` | `base64 -w0 google-services.json` — switches push on |
| `RELEASE_KEYSTORE_BASE64` | `base64 -w0 thrilla-release.keystore` |
| `RELEASE_STORE_PASSWORD` | the keystore password |
| `RELEASE_KEY_ALIAS` | e.g. `thrilla` |
| `RELEASE_KEY_PASSWORD` | the key password (often the same as the store's) |

(`-w0` just puts it on one line, which pastes more reliably; wrapped base64
decodes fine either way. On macOS use `base64 -i <file>`.)

### One google-services.json or two?

A Firebase project's `google-services.json` lists a client for **every** Android
app registered in that project, so with `com.thrilla_btc.thrilla` and
`com.thrilla_btc.thrilla.signet` both registered in one project, one file covers
both flavours and one secret is enough. Check what a file actually contains:

```bash
jq -r '.client[].client_info.android_client_info.package_name' google-services.json
```

If that prints both package names, use the single `GOOGLE_SERVICES_JSON` above.
If you have two files from two separate Firebase projects, use these instead —
each overrides the shared secret for its flavour:

| Secret | Value |
|---|---|
| `GOOGLE_SERVICES_JSON_SIGNET` | base64 of the file whose client is `…thrilla.signet` |
| `GOOGLE_SERVICES_JSON_MAINNET` | base64 of the file whose client is `…thrilla` |

Either way the build checks that the file it ends up with actually covers the
flavour being built, and fails with the missing package name if not — rather
than letting the google-services plugin produce a "No matching client found".

Every run reports the signing certificate's SHA-256 and whether push is on, in
the job summary and the prerelease notes, so which key was used is never a
guess. Set a **`RELEASE_CERT_SHA256`** repository *variable* (a variable, not a
secret — a certificate fingerprint is public and is in every APK) to have the
build additionally fail if the certificate is not the one you expect. That turns
a swapped or regenerated keystore into a failed build rather than a release
nobody can install over.

> **The release key in CI is a real exposure.** It can ship an update to every
> phone with Thrilla installed, and for a wallet that means an update that can
> move funds. In Actions secrets it is reachable by anyone with push access to
> this repository — log masking is trivially defeated by base64-ing twice — and
> by anyone who compromises the account. The alternative is keeping it on one
> machine: let CI build, then sign the downloaded APK locally with `apksigner`,
> which takes seconds and no Gradle. Signing only requires the cheap half of the
> work, which is why the expensive half being in CI does not force the key to
> follow it.
>
> Note also that with the secrets set, *every* CI build is release-signed —
> including branch builds published to the public prerelease URL above. For
> `signet` that cannot overwrite a mainnet install (different applicationId),
> but a `mainnet` branch build is a genuinely installable update to real users'
> wallets. Prefer signet for testing, or remove the secrets between releases.

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

## Building locally on a machine with 16GB or less

Use the flavour scripts rather than `assembleRelease`, and the `:lowmem`
variants when the machine is also running an editor:

```bash
npm run apk:signet:lowmem     # or apk:mainnet:lowmem
```

Those pass `-PreactNativeArchitectures=arm64-v8a` (one ABI instead of two) and
`--no-daemon`, so nothing keeps a 2GB JVM alive after the build finishes — which
is usually what makes the *next* thing on the machine fall over rather than the
build itself.

`android/gradle.properties` already caps the Kotlin compiler daemon at 1.5GB and
holds Gradle to two workers, for the same reason. If your machine has more to
spare, raise them in `~/.gradle/gradle.properties` (which overrides the
committed file, so your local tuning stays out of git):

```properties
org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g
kotlin.daemon.jvmargs=-Xmx3g
org.gradle.workers.max=4
org.gradle.parallel=true
```

Two habits that matter more than any of the above:

- **Do not run Metro (`npm start`) during a release build.** A release build
  bundles the JS itself; a Metro server running alongside is another Node
  process holding the whole module graph for nothing.
- **Close the editor's TypeScript server, or the editor.** `tsc`/tsserver on
  this project sits at 1–2GB, and it is idle while Gradle works. Run
  `npm run apk:signet:lowmem` from a plain terminal.

If a build dies with `Java heap space` or the machine starts swapping, stop the
daemons before retrying — a crashed build leaves them behind:

```bash
cd android && ./gradlew --stop
pkill -f KotlinCompileDaemon    # only if ./gradlew --stop left one running
```

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

**Screenshots do nothing / screen recording is blank / the recents preview is
empty:** that is deliberate, not a bug. `MainActivity` sets `FLAG_SECURE` so
Android draws a blank instead of the wallet in the app-switcher thumbnail, and
that flag also blocks screenshots, screen recording and mirroring for the whole
app. To capture screens while developing, comment out the `window.setFlags` call
in `MainActivity.kt` and rebuild — don't ship that.

**`SDK location not found`:** create `android/local.properties` with `sdk.dir=...`.

**`gradlew: Permission denied`:** `chmod +x android/gradlew`.

**Wrong Java version:** `java -version` must show 17.x — not 21, not 11.

**Stale build:** `cd android && ./gradlew clean` then rebuild.
