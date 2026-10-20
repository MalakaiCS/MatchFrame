# Operations: deployment, configuration, backups and failure runbooks

## Topology

| Process | Role | Database role | Scales |
| --- | --- | --- | --- |
| `apps/api` | REST, auth, Socket.IO, provider webhooks, HLS/media gateways | `bs_app` (RLS forced) | horizontally behind sticky WebSockets (Redis adapter) |
| `apps/worker` | outbox relay, automation (fenced lease), media session control queue + reconcile loop | `bs_worker` | 1+ (automation lease is single-owner; relay rows are claimed with SKIP LOCKED) |
| `apps/media-worker` | FFmpeg jobs, highlight mapping, retention, storage usage | `bs_worker` | by CPU; `MEDIA_JOB_CONCURRENCY` |
| `apps/web` | Next.js UI, renderer pages (`/overlay`, `/render/programme`), share pages | none | horizontally |
| LiveKit server / ingress / egress | media (RTMP ingest, private rooms, template egress → HLS/MP4/RTMP) | — | egress by CPU (see capacity) |
| PostgreSQL, Redis, S3 (MinIO) | durable state / bus+queues / objects | — | — |

Redis carries realtime fan-out and BullMQ messages only. Every effect is decided by durable rows (outbox,
execution keys, job rows), so losing Redis delays delivery but never loses or duplicates work (A49).

## Configuration

`pnpm setup` writes `.env` from `.env.example` (generated secrets, detected media node IP) and renders
`.data/config/{livekit,ingress,egress,mediamtx}.yaml`. Re-running it keeps existing secrets.

* **Public vs internal URLs** — `PUBLIC_*` are what browsers/encoders use; `INTERNAL_*` are what servers and the
  egress browser use. `INTERNAL_RENDER_BASE_URL` must be reachable *from the egress container*.
* **Capacity** — `MAX_CONCURRENT_PROGRAMMES` counts output sessions (programme or clean) across the installation;
  starts beyond it are refused (`CAPACITY_REACHED`). Set it only from a measurement on your hardware
  (`tests/media/run-soak.mjs`). Egress admission is also limited in `infra/templates/egress.yaml` (`cpu_cost`).
* **Destinations** — RTMP/RTMPS only; private/loopback/link-local targets are rejected (DNS is resolved).
  `DEV_DESTINATION_ALLOWLIST` (host:port) exists for local test receivers only.
* **Secrets** — stream keys and destination keys are AES-GCM encrypted with `ENCRYPTION_KEY`; capability tokens
  are HMAC-derived (`MEDIA_TOKEN_SECRET`) or stored as hashes. Rotating `ENCRYPTION_KEY` requires re-entering
  destination keys and rotating input keys.
* **Graphics-only** — `STREAMING_ENABLED=false` runs without LiveKit: stream routes are not registered, the
  worker skips session control, and the UI hides Streams, the match Streams/Recordings tabs and stream health.
  Single-container hosting (`scripts/start-hosted.mjs`, `railway.json`): [`deploy-hosted.md`](deploy-hosted.md).
* **Media provider** — `MEDIA_PROVIDER=livekit` (default). `fake` is for automated tests and labelled demo mode;
  the UI and session rows show `demo` when it is active.

## Deployment with the image

```bash
docker build -f infra/Dockerfile -t broadcast-studio-app:local \
  --build-arg PUBLIC_REALTIME_URL=https://studio.example.org --build-arg PUBLIC_LIVEKIT_URL=wss://media.example.org \
  --build-arg PUBLIC_RTMP_URL=rtmp://ingest.example.org/live .
pnpm services:up                                     # or your managed Postgres/Redis/S3 + LiveKit
docker compose -f infra/docker-compose.yml --env-file .env --profile app run --rm api pnpm db:migrate
docker compose -f infra/docker-compose.yml --env-file .env --profile app up -d
```

`NEXT_PUBLIC_*` values are compiled into the web bundle: rebuild the image when public URLs change.
Behind a TLS-intercepting proxy pass `--build-arg EXTRA_CA_PEM="$(cat <ca-bundle>)"` and `--build-arg HTTPS_PROXY=…`.
Put a reverse proxy in front: `/` → web, `/api` and `/socket.io` → api (WebSocket upgrade), and expose the
LiveKit signalling port and RTMP ingest separately. Health: `GET /api/v1/health/live`, `/api/v1/health/ready`.

Creating the first owner without a shared password: either run `pnpm db:seed` (prints random one-time passwords;
change them) or register through `/register` and create an organisation in onboarding.

## Backups and restore

* **Database** — `pg_dumpall --roles-only` plus `pg_dump -Fc` (point-in-time recovery with WAL archiving in
  production). **Objects** — bucket versioning/replication or a periodic mirror.
* **Drill** — `node tests/media/run-restore-drill.mjs` restores both into fresh PostgreSQL and MinIO containers,
  starts a separate API and verifies login, match history, RLS isolation and recording playback
  (`docs/evidence/m7/restore-drill.json`, last run: 136 s for 615 kB dump + 4.5 GB objects).
* Redis is not backed up: it is a transient bus.

## Retention and quotas

Recordings default to 90 days (`retain_until`), exports to 30 days; pinned recordings and media of matches with an
active session are never deleted. The media worker runs retention hourly. `entitlements.limits.storageGb` blocks
*new* uploads/exports at the quota; live matches and recordings continue.

## Observability

Structured JSON logs (pino) with request ids; URLs are redacted (`t`, `bt`, `s`, `token`, `key`, `sig` query
params, RTMP keys). Useful signals: outbox lag (`select count(*), min(created_at) from outbox_events where
state='pending'`), dead letters (`state='dead'`), automation runs/cues tables (control room shows reasons),
`broadcast_sessions`/`output_sessions` state and `error`, destination `last_status`, export job states,
`usage_ledger`. A metrics endpoint for scraping is not implemented (P1).

## Failure runbooks

| Symptom | Check | Action |
| --- | --- | --- |
| Stream stuck in **WAITING_FOR_INPUT** | Streams → Inputs health; ingress logs | Verify encoder URL/key (reveal, or rotate and update OBS). After the bounded wait the session fails with `NO_INPUT` and releases capacity. |
| **DEGRADED: INPUT_LOST** | Input preview; encoder | Holding slate is on air and recording continues. Restore the encoder; the session returns to LIVE without a new session. |
| **DEGRADED: DESTINATION_FAILED** | Destination status badge/error | Other destinations and the recording continue. Fix the platform key/server and restart the stream when convenient. |
| **CAPACITY_REACHED** on start | Streams → Sessions capacity line | Stop another output or add egress capacity, then raise `MAX_CONCURRENT_PROGRAMMES` only after measuring. |
| Egress failed repeatedly | `output_sessions.error`, egress logs | Up to 3 automatic restarts create new recording parts; after that the output is FAILED. Check `INTERNAL_RENDER_BASE_URL` reachability from egress and S3 credentials in `.data/config/egress.yaml` (`storage.s3`). |
| Graphics on desk but not on output | Control room diagnostics: renderer list, *displayed* revision | Output not connected (reload the browser source), capability rotated (use the new URL), or realtime bus down (see Redis). |
| Redis down | `redis-cli ping`; API readiness | Scoring and automation keep committing; outputs do not show *displayed* until Redis returns; the outbox drains automatically. |
| Worker restarted mid-match | worker logs | Automation lease moves with a higher fence; expired cues are skipped, not replayed. Sessions are reconciled from provider state; unknown egress in our rooms is stopped. |
| Highlight **NEEDS_ALIGNMENT / FAILED (gap)** | Match → Media → highlight reason | The recording lacks media at the event time. Cut manually from the recording if partial media exists; calibrate input delay (`inputs.source_delay_ms`, output `calibration_ms`). |
| Export stuck RUNNING | Exports tab | Cancel (kills only that job's FFmpeg), then Retry. Queued jobs lost with Redis are re-enqueued every minute. |
| Outbox dead letters | `outbox_events where state='dead'` | Inspect `last_error`, fix the cause, re-queue with the relay's `retryDead()` (subscribers are idempotent). |
| Leaked share link | Media → Share links | Revoke: every following page, metadata and byte-range request is refused (410). |
| Suspected key leak | Audit log (`input.key_revealed`) | Rotate the input key (old key stops at the provider) and destination keys at the platform. |
