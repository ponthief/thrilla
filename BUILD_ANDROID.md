# Building Thrilla Android APK
# ================================

## Requirements

- Android Studio Ladybug (2024.2.1) or newer: https://developer.android.com/studio
- Java 21 JDK (Capacitor 6 requires Java 21)
- Node.js 18+


## Install Java 21

# Ubuntu/Debian
sudo apt install openjdk-21-jdk
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64

# Mac
brew install openjdk@21
export JAVA_HOME=$(brew --prefix openjdk@21)

# Verify
java -version   # must show 21.x


## In Android Studio — set Gradle JDK to 21

File → Settings → Build, Execution, Deployment → Build Tools → Gradle
Set "Gradle JDK" to "JDK 21"


## First-time setup (run in project root)

npm install
npm run build
npx cap add android       # adds android/ folder — run ONCE only
npx cap sync android      # MUST run this before opening Studio


## Every time you change the Vue code

npm run build
npx cap sync android
# Then rebuild in Android Studio


## Build debug APK from command line

cd android
./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk


## Build via Android Studio

npx cap open android      # opens android/ in Studio
# Build → Build Bundle(s) / APK(s) → Build APK(s)


## Install to connected device (USB debugging enabled)

adb install android/app/build/outputs/apk/debug/app-debug.apk


## Troubleshooting

# "Cannot query the value of this provider" or compile errors:
# 1. File → Invalidate Caches → Invalidate and Restart
# 2. Check Gradle JDK is set to 21 in Studio settings
# 3. Run: npx cap sync android  (then rebuild)

# SDK not found:
# Create android/local.properties:
#   sdk.dir=/home/YOUR_USER/Android/Sdk

# gradlew permission denied:
#   chmod +x android/gradlew

# Wrong Java version:
#   Check: java -version
#   Must be 21.x — not 17, not 11
