# syntax=docker/dockerfile:1
# Application image for api, worker, media-worker and web (compose profile "app").
# Build from the repository root:  docker build -t broadcast-studio-app:local .
# It lives at the root because Railway's builder ignores a Dockerfile in a subfolder named in railway.json and
# falls back to Railpack auto-detection.
# NEXT_PUBLIC_* values are baked into the web bundle at build time: pass the public URLs as build args.
# PUBLIC_REALTIME_URL empty (the default) = Socket.IO on the page's own origin, as served by a reverse proxy or
# by scripts/start-hosted.mjs (hosted platforms: one container, one port, migrations with MIGRATE_ON_START=true).
FROM node:22.22.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# Optional: behind a TLS-intercepting proxy, pass --build-arg EXTRA_CA_PEM="$(cat <bundle>)" and HTTPS_PROXY.
# (No BuildKit secret mounts: Railway's builder supports only cache mounts. The CA bundle is public, not a secret.)
ARG EXTRA_CA_PEM=
RUN if [ -n "$EXTRA_CA_PEM" ]; then printf '%s\n' "$EXTRA_CA_PEM" > /extra-ca.pem; export NODE_EXTRA_CA_CERTS=/extra-ca.pem; fi; \
  corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
ARG PUBLIC_REALTIME_URL=
ARG PUBLIC_LIVEKIT_URL=ws://localhost:7880
ARG PUBLIC_RTMP_URL=rtmp://localhost:1935/live
ENV PUBLIC_REALTIME_URL=$PUBLIC_REALTIME_URL PUBLIC_LIVEKIT_URL=$PUBLIC_LIVEKIT_URL PUBLIC_RTMP_URL=$PUBLIC_RTMP_URL
RUN if [ -f /extra-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/extra-ca.pem; fi; \
  rm -f .env && pnpm install --frozen-lockfile && pnpm -r --filter "./apps/*" run build

FROM mwader/static-ffmpeg:7.1.1 AS ffmpeg

FROM node:22.22.0-bookworm-slim
# static FFmpeg/ffprobe (no distro package mirror needed at build time)
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
RUN groupadd -r bs && useradd -r -g bs -d /app bs
# pg_dump for scheduled database backups (BACKUP_ENABLED=true)
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=bs:bs /app /app
USER bs
ENV NODE_ENV=production
# migrations: docker compose run --rm api pnpm db:migrate  (uses DATABASE_ADMIN_URL)
# Default: every process behind one port ($PORT). Compose overrides the command per service.
CMD ["node", "scripts/start-hosted.mjs"]
