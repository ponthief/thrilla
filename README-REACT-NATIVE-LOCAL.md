# React Native - Pure Local Build

Cross-platform wallet application for Silent Payments using React Native (without Expo).

## Prerequisites

- Node.js 16+
- Android SDK with API 30+
- Android NDK
- Java Development Kit (JDK) 11+
- Xcode (for iOS development on macOS)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.mainnet .env.local
```

Edit `.env.local` with your LNbits server:

```env
LNBITS_URL=http://10.0.2.2:5000
SILNT_PREFIX=/siLNt
```

Note: `10.0.2.2` is the special alias Android emulators use to reach localhost on your host machine.

### 3. Android Setup

**Set Android environment variables:**

```bash
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/tools:$ANDROID_HOME/tools/bin:$ANDROID_HOME/platform-tools
```

**Or on Windows:**

```cmd
set ANDROID_HOME=C:\Users\%USERNAME%\AppData\Local\Android\Sdk
set PATH=%PATH%;%ANDROID_HOME%\emulator;%ANDROID_HOME%\tools;%ANDROID_HOME%\tools\bin;%ANDROID_HOME%\platform-tools
```

### 4. Start Development Server

```bash
npm start
```

Keep this terminal running.

### 5. Build and Run

**Android:**

```bash
# In a new terminal
npm run android
```

Requires Android emulator or device with USB debugging enabled.

**iOS (macOS only):**

```bash
npm run ios
```

## Build for Production

### Android APK

```bash
cd android
./gradlew assembleRelease
```

APK location: `android/app/build/outputs/apk/release/app-release.apk`

### Android App Bundle (for Google Play)

```bash
cd android
./gradlew bundleRelease
```

Bundle location: `android/app/build/outputs/bundle/release/app-release.aab`

### iOS

```bash
cd ios
pod install
pod repo update
xcodebuild -workspace Thrilla.xcworkspace -scheme Thrilla -configuration Release
```

## Project Structure

```
src/
├── App.tsx                    # Root app component
├── screens/                   # Screen components
│   ├── WalletScreen.tsx
│   ├── ReceiveScreen.tsx
│   ├── SendScreen.tsx
│   └── SettingsScreen.tsx
├── stores/                    # Zustand state management
│   ├── walletStore.ts
│   └── authStore.ts
├── services/                  # API clients
│   └── api.ts
└── utils/                     # Utilities
    └── crypto.ts
index.js                       # Entry point
app.json                       # App configuration
```

## Key Features

✅ Cross-platform (iOS & Android)  
✅ LNbits integration  
✅ Secure token storage (React Native Keychain)  
✅ State management (Zustand)  
✅ TypeScript support  
✅ React Navigation  
✅ Pure React Native (no Expo)

## Development

### Type Checking

```bash
npm run type-check
```

### Linting

```bash
npm run lint
```

## Troubleshooting

**Android build fails**

```bash
cd android
./gradlew clean
./gradlew assembleDebug
```

**Metro bundler cache issues**

```bash
npm start -- --reset-cache
```

**"Cannot find Android SDK"**

Ensure `ANDROID_HOME` is set correctly:

```bash
echo $ANDROID_HOME
```

Should output the path to your Android SDK.

**Pod issues (iOS)**

```bash
cd ios
rm -rf Pods Podfile.lock
pod install
pod repo update
```

## Support

For issues or questions, check:
- [React Native Docs](https://reactnative.dev)
- [React Navigation Docs](https://reactnavigation.org)
- [GitHub Issues](https://github.com/ponthief/thrilla/issues)
