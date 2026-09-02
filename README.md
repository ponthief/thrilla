# Thrilla — Bitcoin Silent Payments Wallet

Thrilla is a self-custodial **Bitcoin** wallet built on **Silent Payments
([BIP-352](https://github.com/bitcoin/bips/blob/master/bip-0352.mediawiki))**.
It's a React Native (Android/iOS) app; a Vue web app lives in the same repo.

## What is it for?

Silent Payments let you publish **one reusable address** and receive to it as
many times as you like — **without reusing an address on-chain**. Each payment
the sender makes derives a fresh, unlinkable output, so your incoming payments
can't be tied together by a static address on the blockchain. You get the
convenience of a single "always-on" address with much better privacy than a
normal reused address, and without running an interactive server to hand out
fresh addresses.

- **Reusable, shareable address.** Publish your `sp1…` address (QR, link, or a
  memorable **BitMail** name like `you@thrilla.me` via
  [BIP-353](https://github.com/bitcoin/bips/blob/master/bip-0353.mediawiki)).
- **Self-custodial.** Keys are derived **on-device** from a BIP-39 seed at the
  BIP-352 path (`m/352'`). Your **spend key never leaves the phone**. The scan
  key is only uploaded if you opt into **background scanning** — and it can
  *detect* payments but can never spend them.
- **Real Bitcoin, on-chain.** Your coins are ordinary UTXOs on the Bitcoin
  blockchain, spendable to Silent Payment, on-chain (`bc1…`), or BitMail
  recipients. The backend only stores *references* to your scanned UTXOs; the
  bitcoin itself always lives on-chain and is recoverable from your seed.
- **Coin control & privacy tools.** See, label, and **freeze** individual
  coins; dust from third parties is flagged so you can avoid it.
- **Notifications.** Get a push when a payment arrives (even with the app
  closed) via an opt-in background scanner — the amount is shown in-app, not to
  the push provider. Prefer to receive silently? Turn **Payment alerts** off in
  Settings → Notifications (per device).
- **Lock & duress.** Biometric or in-app PIN lock, plus an optional **duress
  PIN** that wipes this device's keys and signs out. Sending re-authenticates.

Thrilla talks to a self-hosted **LNbits** instance running the **siLNt**
extension (the scanner/indexer backend). Builds are provided for **mainnet** and
**signet**.

## Screenshots

<table>
  <tr>
    <td align="center">
      <img src="screenshots/Screenshot_20260811_175533_com_thrilla_btc_thrilla_MainActivity.jpg" width="230"><br>
      <sub><b>Wallet</b> — balance & history</sub>
    </td>
    <td align="center">
      <img src="screenshots/Screenshot_20260816_175327_com_thrilla_btc_thrilla_signet_MainActivity.jpg" width="230"><br>
      <sub><b>Receive</b> — reusable address & BitMail</sub>
    </td>
    <td align="center">
      <img src="screenshots/Screenshot_20260816_175235_com_thrilla_btc_thrilla_signet_MainActivity.jpg" width="230"><br>
      <sub><b>Coins</b> — coin control & freeze</sub>
    </td>
    <td align="center">
      <img src="screenshots/Screenshot_20260811_175605_com_thrilla_btc_thrilla_MainActivity.jpg" width="230"><br>
      <sub><b>Scan</b> — find Silent Payments</sub>
    </td>
  </tr>
</table>

## Quick Start

### Prerequisites

- Node.js 16+
- Android SDK (for Android development)
- Xcode (for iOS development on macOS)

### Setup

```bash
npm install
```

### Development

**Start Metro bundler:**
```bash
npm start
```

**Run on Android (in another terminal):**
```bash
npm run android          # mainnet debug
npm run android:signet   # signet debug
```

**Run on iOS (macOS only):**
```bash
npm run ios
```

### Build a release APK

The app has `mainnet` and `signet` build flavors (each pulls its own `.env`):

```bash
npm run apk:mainnet   # → android/app/build/outputs/apk/mainnet/release/
npm run apk:signet    # → android/app/build/outputs/apk/signet/release/
```

**Signing:** release builds are signed with your own keystore when its
credentials are present as Gradle properties (kept **outside** the repo, in
`~/.gradle/gradle.properties`):

```properties
THRILLA_STORE_FILE=/absolute/path/to/thrilla-release.keystore
THRILLA_KEY_ALIAS=thrilla
THRILLA_STORE_PASSWORD=…
THRILLA_KEY_PASSWORD=…
```

Generate the keystore once with:
```bash
keytool -genkeypair -v -keystore thrilla-release.keystore \
        -alias thrilla -keyalg RSA -keysize 4096 -validity 10000
```
Without those properties, release builds fall back to the debug key (fine for
local testing, never for distribution). **Back up the keystore + passwords** —
losing them means you can't ship updates.

### Publish a verifiable release

The APKs are sideloaded from a website, so nothing about the transport proves
where a build came from. Two independent checks cover that, and a release
should ship both.

**1. The APK signing certificate.** Android already enforces this: an APK
signed by a different key cannot replace an installed Thrilla, so every user
is protected whether or not they check anything. Publish the fingerprint so
they *can* check:

```bash
apksigner verify --print-certs thrilla.apk | grep -i 'SHA-256 digest'
```

**2. A GPG signature over the checksums.** This covers the download itself,
before it is ever installed. One signature over a `SHA256SUMS` file covers
every artifact — the layout Bitcoin Core and Tor use, so the steps are ones
people may already know:

```bash
scripts/sign-release.sh                    # → SHA256SUMS + SHA256SUMS.asc
THRILLA_GPG_KEY=<key-id> scripts/sign-release.sh    # pick a specific key
```

The script checksums the APKs, signs the sums, **verifies the signature it
just made** (a bad signature that ships reads to users as a compromised
build), and prints both fingerprints.

First time only, create a signing key and export the public half:

```bash
gpg --quick-generate-key "Thrilla <you@example.com>" ed25519 sign 3y
gpg --armor --export "you@example.com" > thrilla-signing-key.asc
```

Then publish, per release:

- `SHA256SUMS` and `SHA256SUMS.asc` next to the APKs
- `thrilla-signing-key.asc` on the site (once)
- the key fingerprint in `verify.html` on thrilla.me

**Publish the fingerprint somewhere other than the download page too** — the
GitHub profile, X, the Telegram channel. Someone who can serve a fake APK from
the site can serve a fake key beside it; a second source is what makes the
check mean anything. And keep the signing key off the build machine, on
hardware if you can: it is the one secret that lets anyone else's build pass
as yours.

## Project Structure

```
src/
├── App.tsx           # Root component
├── screens/          # Wallet, Send, Receive, Scan, Coins, Settings, Lock, …
├── components/       # Modals, PIN pad, seed input, QR, …
├── services/         # spKeys (BIP-352 derivation), api, secureKeys, push, …
├── stores/           # Zustand (mobile) / Pinia (web) state
└── views/            # Vue web app screens
index.js              # Entry point (polyfills, FCM background handler)
```

## Troubleshooting

**Metro cache issues:**
```bash
npm start -- --reset-cache
```

**Android build issues:**
```bash
cd android
./gradlew clean
./gradlew assembleDebug
```

**Pod issues (iOS):**
```bash
cd ios
rm -rf Pods Podfile.lock
pod install
```
