#!/bin/zsh
# Сборка релиза: интерфейс с компьютера → APK с номером версии в имени
set -e
cd "$(dirname "$0")"
./web/build-web.sh
./gradlew assembleRelease -q
V=$(grep -m1 'versionName' app/build.gradle.kts | sed -E 's/.*"(.+)".*/\1/')
OUT="../Pinakes-Android-v$V.apk"
cp app/build/outputs/apk/release/app-release.apk "$OUT"
echo "$OUT"
