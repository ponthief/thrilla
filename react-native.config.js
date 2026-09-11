module.exports = {
  project: {
    ios: {},
    android: {},
  },
  dependency: {
    platforms: {
      android: null,
      ios: null,
    },
  },
  // Capacitor belongs to the Vue web app, not to React Native.
  //
  // src/components/QrScanModal.vue scans QR codes through
  // @capacitor-mlkit/barcode-scanning, so the dependency is real and stays.
  // But React Native autolinks it too, and on iOS that broke the build
  // outright:
  //
  //   duplicate symbol '_OBJC_CLASS_$_AppDelegate' in:
  //       .../Thrilla.build/.../AppDelegate.o
  //       .../CapacitorCordova/Cordova.framework/Cordova(AppDelegate.o)
  //
  // Cordova.framework defines its own AppDelegate, which collides with the
  // one every React Native app has.
  //
  // Android never hit this, and the reason is worth writing down: RN's Android
  // autolinking looks for a native module class and finds none, so it already
  // skips this package — `npx react-native config` reports
  // "android=- ios=yes" for it. iOS autolinking only needs a podspec, which
  // Capacitor ships. Both platforms are pinned to null here so the exclusion
  // is stated rather than relying on that asymmetry staying as it is.
  //
  // The React Native app does its own QR scanning with react-native-camera-kit
  // (see src/components/QRScanner.tsx), so nothing on the mobile side loses a
  // capability. Note this does NOT remove MLKit from the Android APK:
  // react-native-camera-kit depends on com.google.mlkit:barcode-scanning
  // itself, which is where libbarhopper_v3.so and the .tflite models come
  // from.
  dependencies: {
    '@capacitor-mlkit/barcode-scanning': {
      platforms: {
        ios: null,
        android: null,
      },
    },
    '@capacitor/core': {
      platforms: {
        ios: null,
        android: null,
      },
    },
  },
};
