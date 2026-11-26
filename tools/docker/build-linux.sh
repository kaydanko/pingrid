#!/bin/bash
# Build Linux bundles (.deb, .rpm, .AppImage) in Docker.
#   tools/docker/build-linux.sh amd64|arm64 <output dir>
set -euo pipefail
ARCH=${1:-amd64}
OUT=$(cd "${2:-artifacts/linux-$ARCH}" && pwd)
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
docker build -q --platform "linux/$ARCH" -t "pingrid-linux:$ARCH" -f "$ROOT/tools/docker/linux.Dockerfile" "$ROOT/tools/docker"
docker run --rm --platform "linux/$ARCH" -v "$ROOT":/src:ro -v "$OUT":/out \
  -e APPIMAGE_EXTRACT_AND_RUN=1 -e NO_STRIP=true -e CARGO_TERM_COLOR=never \
  "pingrid-linux:$ARCH" bash -c '
    set -euo pipefail
    # Copy sources, leaving host-built node_modules and targets behind.
    tar -C /src --exclude=./node_modules --exclude=./src-tauri/target --exclude=./dist \
        --exclude=./.git --exclude=./artifacts --exclude="*/.gstack" -cf - . | tar -xf -
    npm ci --no-audit --no-fund --loglevel=error
    npx tauri build --bundles deb,rpm,appimage
    B=src-tauri/target/release/bundle
    cp -v $B/deb/*.deb $B/rpm/*.rpm $B/appimage/*.AppImage /out/
    ls -l src-tauri/target/release/pingrid | awk "{print \"binary size:\", \$5}"'
