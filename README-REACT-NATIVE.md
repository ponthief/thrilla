# React Native + Expo - Thrilla Wallet

Cross-platform wallet application for Silent Payments using React Native and Expo.

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI: `npm install -g eas-cli expo-cli`

### Setup

1. **Clone and install dependencies**

```bash
git clone https://github.com/ponthief/thrilla.git
cd thrilla
git checkout react-native-expo-migration
npm install
```

2. **Configure environment**

```bash
cp .env.example .env
```

Edit `.env` with your LNbits instance:

```dotenv
EXPO_PUBLIC_LNBITS_URL=https://your-lnbits-instance.com
EXPO_PUBLIC_SILNT_PREFIX=/siLNt
EXPO_PUBLIC_PAYJOIN_ENABLED=false
```

3. **Start development server**

```bash
npm start
```

Then:
- Press `a` for Android emulator
- Press `i` for iOS simulator
- Press `w` for web

### Build Locally

**Android:**

```bash
npm run android
```

Requires Android emulator or device with USB debugging enabled.

**iOS:**

```bash
npm run ios
```

Requires macOS with Xcode.

### Build for Production

**With EAS (Recommended)**

```bash
# Login to Expo
eas login

# Update eas.json with your project ID from https://expo.dev

# Build Android
npm run build:android

# Build iOS
npm run build:ios
```

**Local Build (Android)**

```bash
npm run eject  # Generates android/ and ios/ directories
cd android
./gradlew assembleRelease
```

## Project Structure

```
app/
├── (tabs)/                  # Tab navigation screens
│   ├── _layout.tsx         # Tab layout
│   ├── index.tsx           # Wallet/Dashboard
│   ├── receive.tsx         # Receive payments
│   ├── send.tsx            # Send payments
│   └── settings.tsx        # Settings
├── stores/                 # Zustand state management
│   ├── walletStore.ts
│   └── authStore.ts
├── services/               # API clients
│   └── api.ts
├── utils/                  # Utilities
│   └── crypto.ts
└── _layout.tsx            # Root navigation
```

## Key Features

✅ Cross-platform (iOS & Android)  
✅ LNbits integration  
✅ Secure token storage (Expo Secure Store)  
✅ State management (Zustand)  
✅ TypeScript support  
✅ QR code support  
✅ EAS Build integration  

## Development

### Type Checking

```bash
npm run type-check
```

### Linting

```bash
npm run lint
```

## Migration Notes

This is a React Native + Expo rebuild of the original Vue.js SPA:
- **State**: Pinia → Zustand
- **Routing**: Vue Router → Expo Router
- **UI**: Vue components → React Native
- **Build**: Vite → Expo Prebuild

## Troubleshooting

**"Cannot find module" errors after npm install**

```bash
npm install
expo doctor
```

**Android build fails**

```bash
eas build --platform android --clean
```

**iOS build requires Mac**

Use EAS Build to build in the cloud:

```bash
eas build --platform ios
```

## Next Steps

1. ✅ Install dependencies: `npm install`
2. ✅ Configure `.env` with your LNbits URL
3. ✅ Test locally: `npm start` → press `a` or `i`
4. ✅ Build for Android: `npm run build:android`
5. ✅ Build for iOS: `npm run build:ios`

## Support

For issues or questions, check:
- [Expo Docs](https://docs.expo.dev)
- [React Native Docs](https://reactnative.dev)
- [GitHub Issues](https://github.com/ponthief/thrilla/issues)
