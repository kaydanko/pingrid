# Linux build environment for Pingrid (Tauri v2). Official images only.
#   docker build --platform linux/amd64 -t pingrid-linux -f tools/docker/linux.Dockerfile .
FROM node:22-bookworm AS node

FROM rust:1-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
# Tauri v2 Linux prerequisites (https://v2.tauri.app/start/prerequisites/#linux)
RUN apt-get update && apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev \
      libayatana-appindicator3-dev librsvg2-dev patchelf rpm xdg-utils \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
