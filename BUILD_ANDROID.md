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
