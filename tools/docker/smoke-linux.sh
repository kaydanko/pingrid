#!/bin/bash
# Install a built .deb into a clean distro container, start Pingrid on a
# virtual display, and screenshot it after 25 s.
#   tools/docker/smoke-linux.sh amd64|arm64 <dir with .deb> [image]
set -euo pipefail
ARCH=${1:-amd64}
DIR=$(cd "${2:-artifacts/linux-$ARCH}" && pwd)
IMAGE=${3:-debian:bookworm}
docker run --rm --platform "linux/$ARCH" -v "$DIR":/pkg "$IMAGE" bash -c '
  set -euo pipefail
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq /pkg/*.deb xvfb imagemagick dbus-x11 >/dev/null
  Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
  export DISPLAY=:99 WEBKIT_DISABLE_COMPOSITING_MODE=1 PINGRID_LOG_CHECKS=1
  sleep 2
  dbus-launch --exit-with-session pingrid > /pkg/smoke.log 2>&1 &
  sleep 25
  if pgrep -x pingrid >/dev/null; then echo "pingrid is running"; else echo "pingrid EXITED"; cat /pkg/smoke.log; exit 1; fi
  import -display :99 -window root /pkg/smoke.png
  echo "installed size: $(dpkg-query -W -f="\${Installed-Size}" pingrid) KB"
'
