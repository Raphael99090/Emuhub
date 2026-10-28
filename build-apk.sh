#!/usr/bin/env bash
# Gera o APK localmente (PC com Node 18+, Java 17 e Android SDK). No celular/Termux é mais fácil usar o GitHub Actions.
set -e
npm install
node scripts/copiar-www.js
[ -d android ] || npx cap add android
node scripts/pos-android.js
npx --yes @capacitor/assets generate --android --assetPath assets
npx cap sync android
cd android && chmod +x gradlew && ./gradlew assembleDebug
echo "APK: android/app/build/outputs/apk/debug/app-debug.apk"
