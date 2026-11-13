#!/bin/sh
# Runs inside the `apk` container. Bundles web/ into the app and builds it.
set -eu
cd /repo
ASSETS=android/app/src/main/assets/web
rm -rf "$ASSETS" && mkdir -p "$ASSETS"
rsync -a --exclude '*.local.json' web/ "$ASSETS/"
# Belt and braces: personal config must never end up inside the APK.
if find "$ASSETS" -name '*.local.json' | grep -q .; then echo "refusing: private config in assets" >&2; exit 1; fi

gradle -p android --no-daemon -q lintRelease assembleRelease

mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk dist/fantasy-panel.apk
echo "built dist/fantasy-panel.apk ($(du -h dist/fantasy-panel.apk | cut -f1))"
sha256sum dist/fantasy-panel.apk | cut -c1-16
