#!/bin/bash
# Run this from your thrilla project root AFTER npx cap add android
# Usage: bash fix-android-gradle.sh

set -e
ANDROID="./android"

if [ ! -d "$ANDROID" ]; then
  echo "ERROR: android/ folder not found. Run 'npx cap add android' first."
  exit 1
fi

echo "Patching android/ gradle files for SDK 35 + AGP 8.4 compatibility..."

# ── 1. gradle-wrapper.properties — use Gradle 8.9 ────────────────────────────
cat > "$ANDROID/gradle/wrapper/gradle-wrapper.properties" << 'EOF'
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-8.9-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
EOF
echo "✓ gradle-wrapper.properties → Gradle 8.9"

# ── 2. build.gradle (project level) — use AGP 8.4.0 ─────────────────────────
sed -i \
  "s/classpath 'com.android.tools.build:gradle:[^']*'/classpath 'com.android.tools.build:gradle:8.4.0'/" \
  "$ANDROID/build.gradle"
echo "✓ build.gradle → AGP 8.4.0"

# ── 3. variables.gradle — target SDK 35, Java 21 ─────────────────────────────
cat > "$ANDROID/variables.gradle" << 'EOF'
ext {
    minSdkVersion = 23
    compileSdkVersion = 35
    targetSdkVersion = 35
    javaVersion = JavaVersion.VERSION_21
    androidxActivityVersion = '1.9.0'
    androidxAppCompatVersion = '1.7.0'
    androidxCoordinatorLayoutVersion = '1.2.0'
    androidxCoreVersion = '1.13.1'
    androidxFragmentVersion = '1.8.0'
    coreSplashScreenVersion = '1.0.1'
    androidxWebkitVersion = '1.11.0'
    junitVersion = '4.13.2'
    androidxJunitVersion = '1.2.1'
    androidxEspressoCoreVersion = '3.6.1'
    cordovaAndroidVersion = '10.1.1'
}
EOF
echo "✓ variables.gradle → SDK 35, Java 21"

# ── 4. app/build.gradle — ensure Java 21 compile options ─────────────────────
# Patch compileOptions if present
if grep -q "sourceCompatibility" "$ANDROID/app/build.gradle"; then
  sed -i \
    's/sourceCompatibility JavaVersion.VERSION_[0-9]*/sourceCompatibility JavaVersion.VERSION_21/' \
    "$ANDROID/app/build.gradle"
  sed -i \
    's/targetCompatibility JavaVersion.VERSION_[0-9]*/targetCompatibility JavaVersion.VERSION_21/' \
    "$ANDROID/app/build.gradle"
  echo "✓ app/build.gradle → Java 21 compile options"
fi

# ── 5. gradle.properties — add memory and config cache settings ───────────────
cat >> "$ANDROID/gradle.properties" << 'EOF'

# Added by fix-android-gradle.sh
org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=512m
android.useAndroidX=true
android.enableJetifier=true
EOF
echo "✓ gradle.properties → JVM memory settings"

# ── 6. Clean Gradle cache for this project ───────────────────────────────────
rm -rf "$ANDROID/.gradle"
echo "✓ Cleared .gradle cache"

echo ""
echo "Done. Now run in Android Studio:"
echo "  File → Invalidate Caches → Invalidate and Restart"
echo "  Then: Build → Build APK(s)"
