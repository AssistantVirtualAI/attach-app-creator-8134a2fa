#!/usr/bin/env bash
# Build pjproject for iOS (device arm64 + simulator) and assemble
# libpjsip.xcframework for the PpPjsip plugin.
#
# Must run on macOS with Xcode command line tools. This cannot be produced in
# the Lovable sandbox (no macOS / no iOS SDK).
#
#   cd apps/planipret-mobile && bash scripts/build-pjsip-ios.sh
#
# Output: ios/App/App/Plugins/PpPjsip/Frameworks/libpjsip.xcframework
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${PJSIP_WORKDIR:-$APP_DIR/.pjsip-build}"
OUT="$APP_DIR/ios/App/App/Plugins/PpPjsip/Frameworks"
PJ_TAG="${PJSIP_TAG:-2.14.1}"

command -v xcodebuild >/dev/null || { echo "xcodebuild introuvable — ce script exige macOS + Xcode."; exit 1; }

mkdir -p "$WORK" "$OUT"
cd "$WORK"

if [ ! -d pjproject ]; then
  git clone --depth 1 --branch "$PJ_TAG" https://github.com/pjsip/pjproject.git
fi
cd pjproject

# config_site.h — IMPORTANT : PJSIP n'a PAS de transport SIP over WebSocket.
# La macro PJSIP_TRANSPORT_WSS n'existe pas ; ne pas l'ajouter.
cat > pjlib/include/pj/config_site.h <<'EOF'
#define PJ_CONFIG_IPHONE 1
#define PJMEDIA_HAS_VIDEO 0
#define PJSIP_HAS_TLS_TRANSPORT 1
#define PJ_HAS_SSL_SOCK 1
#define PJSIP_MAX_PKT_LEN 8000
#include <pj/config_site_sample.h>
EOF

build_arch () {
  local sdk="$1" arch="$2" tag="$3"
  echo "▶ pjproject: $tag ($sdk / $arch)"
  make distclean >/dev/null 2>&1 || true
  IPHONESDK="$sdk" ARCH="-arch $arch" \
    ./configure-iphone --disable-video --disable-libyuv --disable-opencore-amr
  make dep && make clean && make
  mkdir -p "$WORK/libs/$tag"
  find . -name '*.a' -path '*-apple-darwin_ios*' -exec cp {} "$WORK/libs/$tag/" \;
  libtool -static -o "$WORK/libs/$tag/libpjsip.a" "$WORK/libs/$tag"/*.a
}

build_arch iPhoneOS.sdk arm64 device
build_arch iPhoneSimulator.sdk arm64 simulator

mkdir -p "$WORK/headers"
cp -R pjlib/include/. "$WORK/headers/"
cp -R pjlib-util/include/. "$WORK/headers/"
cp -R pjnath/include/. "$WORK/headers/"
cp -R pjmedia/include/. "$WORK/headers/"
cp -R pjsip/include/. "$WORK/headers/"

# Module map so Swift can `import pjsua`.
cat > "$WORK/headers/module.modulemap" <<'EOF'
module pjsua [system] {
  header "pjsua-lib/pjsua.h"
  export *
}
EOF

rm -rf "$OUT/libpjsip.xcframework"
xcodebuild -create-xcframework \
  -library "$WORK/libs/device/libpjsip.a" -headers "$WORK/headers" \
  -library "$WORK/libs/simulator/libpjsip.a" -headers "$WORK/headers" \
  -output "$OUT/libpjsip.xcframework"

echo "✅ libpjsip.xcframework → $OUT"
echo "   Ajoute-le à la cible App (Frameworks, Libraries and Embedded Content),"
echo "   puis: npx cap sync ios"
