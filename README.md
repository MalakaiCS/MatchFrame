# Broadcast Studio

A self-hostable web application for live sports production: tenant-isolated competitions and fixtures,
mobile live scoring (football and basketball) that keeps working offline, a shared broadcast graphics
renderer with three original themes, a production desk and transparent OBS browser sources, durable game-plan
automation, sponsor campaigns with render-verified delivery reports, cloud programme/clean streaming through
LiveKit to up to three RTMP destinations, authorised HLS preview, recordings, automatic highlights, a clip
editor with 16:9/9:16/1:1 exports, compilations and share links.

Specification: [`MVP_SPEC.md`](MVP_SPEC.md) · Plan and P1 backlog: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) ·
Verification: [`ACCEPTANCE_RESULTS.md`](ACCEPTANCE_RESULTS.md) · Media spike: [`MEDIA_SPIKE.md`](MEDIA_SPIKE.md) ·
Runbooks: [`docs/operations.md`](docs/operations.md) · Guides: [`docs/operator-guide.md`](docs/operator-guide.md), [`docs/scorer-guide.md`](docs/scorer-guide.md)

All clubs, players, sponsors and artwork in the seed are synthetic and generated locally.

## Quick start (local)

Requirements: Docker with Compose v2, Node 22, pnpm 10, FFmpeg/ffprobe (for media tests), Python 3 (marker analysis).

```bash
pnpm install
pnpm setup                       # once: writes .env with generated secrets, renders LiveKit/egress/MediaMTX configs
pnpm services:up                 # postgres, redis, minio, mailpit, livekit server + ingress + egress (host network)
pnpm db:migrate                  # migrations as the owner role; creates bs_app (RLS) and bs_worker roles
pnpm db:seed                     # two organisations, football + basketball, prints one-time owner passwords
pnpm dev                         # api :4000, worker, media-worker, web :3000
```

Open http://localhost:3000 and sign in with a printed owner account (change the password afterwards).
Email links (verification, reset, invitations) are captured by Mailpit at http://localhost:8025.

To try streaming: Streams → New input, copy the RTMP URL/key into OBS (or run
`ffmpeg -re -stream_loop -1 -i tests/media/fixtures/test-source-720p30.mp4 -c copy -f flv <url>/<key>`),
then on a match's **Streams** tab add a programme output, choose the input and start the stream.
The local RTMP receiver for testing destinations starts with `docker compose -f infra/docker-compose.yml --env-file .env --profile media-test up -d rtmp-sink`
(destination `rtmp://127.0.0.1:1936/live`, key `<name>?user=publisher&pass=<RTMP_SINK_PASSWORD>`).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` | TypeScript (all workspaces) / ESLint |
| `pnpm build` | Bundles api, worker, media-worker (esbuild) and builds the web app (Next.js) |
| `pnpm test` | Unit tests (domain rules, clocks, automation, sponsors, timeline mapping, graphics) |
| `pnpm test:db` | Integration tests on real PostgreSQL with the application roles, MinIO and FFmpeg |
| `pnpm test:e2e` | Playwright against a running stack (`E2E_PASSWORD=<owner password>`) |
| `pnpm test:media` | Real media smoke: RTMP → LiveKit → programme/clean → RTMP receiver + HLS + recording (`SMOKE_PASSWORD`) |
| `node tests/media/run-highlight-e2e.mjs` | Live highlight → 9:16 export → share link → revoke |
| `node tests/media/run-audio-policy.mjs` | Sponsor video audio policies measured on recorded audio |
| `node tests/media/run-resilience.mjs` | Redis outage and control-plane restart drills |
| `node tests/media/run-restore-drill.mjs` | Backup → restore into fresh Postgres/MinIO → verify |
| `node tests/media/run-soak.mjs` | Two concurrent 720p sessions for `SOAK_MINUTES` |
| `node scripts/secret-scan.mjs` | Searches bundles, logs, API/socket payloads and audit for secret values |
| `pnpm db:reset` | Development only: drop and recreate the database |
| `pnpm demo:start` / `pnpm demo:stop` | Start/stop services and the app |

Production images: `docker build -f infra/Dockerfile -t broadcast-studio-app:local .` then
`docker compose -f infra/docker-compose.yml --env-file .env --profile app up -d` (see `docs/operations.md`).

## Layout

```
apps/api            Fastify REST + Socket.IO (role bs_app, RLS enforced)
apps/worker         outbox relay, automation runtime, media session orchestration (role bs_worker)
apps/media-worker   FFmpeg jobs: uploads, clips, exports, compilations; highlights; retention
apps/web            Next.js: admin, production desk, scorer PWA, /overlay, /render/programme, /watch, /embed
packages/domain     pure rules: sport adapters, clocks, automation, sponsor selection, timeline mapping
packages/services   DB-aware services (all tenant queries through withTenant)
packages/graphics   shared renderer, catalogue, overlay reducer, themes
packages/media      provider interface, LiveKit adapter, labelled fake adapter for tests/demo
packages/db         Drizzle schema, migrations, RLS policies
infra/              docker-compose, config templates, Dockerfile, media spike
tests/              integration, e2e, media scripts and fixtures
```

## Honest limits (measured on a 4 vCPU / 15 GiB host)

* One 720p session with programme **and** clean output runs, but saturates the host (egress ≈250 % CPU,
  ingress ≈105 %). Two concurrent sessions: see A51 in `ACCEPTANCE_RESULTS.md`. Capacity is enforced by
  `MAX_CONCURRENT_PROGRAMMES` (outputs) — set it from your own measurement.
* RTMP ingest is unencrypted (labelled as such); SRT, programme WebRTC, platform OAuth and billing are P1.
* The fake media provider is only for automated tests and explicitly labelled demo mode.
