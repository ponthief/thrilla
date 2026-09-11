# Building Thrilla for iOS

There was no iOS project in this repository until now — Android was the only
platform with one. This document covers what exists, what does not yet, and the
two things about iOS that have no Android equivalent and will shape every
decision from here.

## Read this before planning anything

**1. You cannot hand someone an `.ipa` from a web page.** The Android story —
build in CI, put the APK behind a URL, a user taps it and installs — has no iOS
counterpart. Every route to an iPhone that is not yours goes through Apple:

| Route | Reach | What it costs |
|---|---|---|
| Simulator build | nobody | nothing; proves the code compiles |
| Development signing | devices in your provisioning profile | Apple Developer Program |
| Ad-hoc distribution | up to 100 devices/year, by UDID | as above, plus collecting UDIDs |
| TestFlight | 10,000 external testers | as above, plus Apple review of the build; builds expire after 90 days |
| App Store | everyone | as above, plus full review |

**2. A cryptocurrency wallet cannot ship under an individual Apple account.**
App Review guideline 3.1.5(b)(i) reads, verbatim:

> **(i) Wallets:** Apps may facilitate virtual currency storage, provided they
> are offered by developers enrolled as an organization.

So public distribution needs Apple Developer Program enrollment **as an
organization** — a legal entity and a D-U-N-S number — not the individual
enrollment. That is a prerequisite to the App Store and to TestFlight's external
testing, and it is worth confirming before anyone spends time on the rest. It
does not block development signing onto your own device.

## What CI does today

`.github/workflows/build-ios.yml`, on a `macos-14` runner. It has two modes and
picks between them by whether the Apple secrets exist:

- **No secrets → simulator build.** Compiles the app and every CocoaPod, then
  stops. This is the honest ceiling without Apple credentials: unlike Android,
  where a throwaway keystore produces a real installable APK, an iOS build
  cannot be signed with a key you invent. A green compile is still the thing
  most likely to break, so it is worth running.
- **Secrets set → signed `.ipa`.** Archives, exports with the method you choose
  (`development`, `ad-hoc`, `app-store`), reports the resulting code signature
  and entitlements, and attaches the `.ipa` to the run.

### Secrets for the signed path

| Secret | How to produce it |
|---|---|
| `APPLE_CERTIFICATE_P12` | Keychain Access → select the certificate **and its private key** → Export as `.p12`, then `base64 -i cert.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the export password you set |
| `APPLE_PROVISIONING_PROFILE` | download the `.mobileprovision` from the Apple Developer portal, then `base64 -i profile.mobileprovision` |
| `APPLE_TEAM_ID` | the 10-character team id, top right of the developer portal |
| `GOOGLE_SERVICES_PLIST_IOS` | optional; `base64 -i GoogleService-Info.plist` — without it the app builds with push inert |

Exporting the certificate **without** its private key is the usual mistake: the
import succeeds and no signing identity results. The workflow checks for exactly
that and says so, rather than failing later inside `xcodebuild`.

The same exposure warning as the Android release key applies, and more sharply:
a distribution certificate plus profile in Actions secrets can sign something
that installs on testers' phones. Development signing, which only reaches
devices you have registered, is the safer default and is what the workflow
exports unless told otherwise.

## What the project has

Generated from the React Native 0.73.6 template, then adapted:

- **`ios/Podfile`** — `use_frameworks! :linkage => :static` with
  `$RNFirebaseAsStaticFramework = true`, because Firebase's iOS SDK will not
  link into a static-library Pods build. Flipper is consequently disabled; it
  does not work under `use_frameworks!` and is a debug inspector this build has
  no use for.
- **`ios/Thrilla/Info.plist`** — `NSCameraUsageDescription` (QR scanning) and
  `NSFaceIDUsageDescription` (app lock, and confirming before the recovery
  phrase is revealed). iOS shows these strings verbatim and refuses the feature
  outright when the key is missing. The template's empty
  `NSLocationWhenInUseUsageDescription` is removed — nothing asks for location,
  and declaring an unused permission invites questions at review.
- **`ios/Thrilla/fonts/`** — the five Geist faces, copied from the Android
  assets, declared in `UIAppFonts`.
- Bundle identifier `com.thrilla-btc.thrilla`, from `app.json`. The test target
  gets `…thrilla.ThrillaTests` rather than sharing the app's.

## What is NOT done yet

Listed plainly, because each is a real gap rather than polish:

1. **The fonts are not in Copy Bundle Resources.** They are on disk and
   declared in `UIAppFonts`, but until they are members of the Xcode target
   they are not copied into the app, and every Geist style silently falls back
   to the system font. The simulator build prints whether any `.ttf` made it
   into the bundle, so this is visible rather than assumed.
2. **`GoogleService-Info.plist` is not a target member either.** CI decodes it,
   which is necessary and not sufficient; Firebase will not find it until it is
   in the bundle.
3. **There is one scheme and one bundle id, so mainnet and signet are not yet
   separable.** On Android they are product flavours with different
   application ids and can be installed side by side. The iOS equivalent needs
   per-configuration `PRODUCT_BUNDLE_IDENTIFIER` via xcconfig, plus
   react-native-config's build phase to select `.env.<flavour>` from `ENVFILE`.
   Until that exists, **the workflow's flavour input does not change what is
   built** — it warns about this on every run rather than quietly misleading.
4. **No push entitlement or associated domains.** Push needs an
   `aps-environment` entitlement and an APNs key uploaded to Firebase;
   Universal Links (the iOS counterpart of the Android App Links to
   `signet.thrilla.me`) need an `associated-domains` entitlement and an
   `apple-app-site-association` file served by that host.
5. **Nothing has run on a real device.** The app has iOS branches throughout —
   `KeyboardAvoidingView` behaviour, Menlo fallbacks — so it was written with
   iOS in mind, but written-for is not tested-on. Keychain and biometric
   behaviour in particular differ enough from Android to expect surprises.

Items 1–3 are each a change to `project.pbxproj`, which is why they are not
bundled in blind: hand-editing that file is how an Xcode project stops opening.
They should be made with a tool that parses it.

## Building locally

Needs a Mac with Xcode. From the repository root:

```bash
npm ci
cd ios && pod install
open Thrilla.xcworkspace      # then run on a simulator or device
```

Or without Xcode's UI:

```bash
cd ios
xcodebuild -workspace Thrilla.xcworkspace -scheme Thrilla \
  -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```
