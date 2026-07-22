# Thrilla - React Native Wallet

Silent Payments wallet for Bitcoin using React Native (no Expo).

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
npm run android
```

**Run on iOS (macOS only):**
```bash
npm run ios
```

### Build for Production

**Android APK:**
```bash
cd android
./gradlew assembleRelease
```

APK location: `android/app/build/outputs/apk/release/app-release.apk`

**Android App Bundle (Google Play):**
```bash
cd android
./gradlew bundleRelease
```

Bundle location: `android/app/build/outputs/bundle/release/app-release.aab`

**iOS:**
```bash
cd ios
pod install
xcodebuild -workspace Thrilla.xcworkspace -scheme Thrilla -configuration Release
```

## Project Structure

```
src/
├── App.tsx          # Root component
index.js            # Entry point
app.json            # App configuration
package.json        # Dependencies
tsconfig.json       # TypeScript config
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
