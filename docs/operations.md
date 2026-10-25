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
* **Optional integrations** (all off until their keys are set; the UI says so where each would appear):
  `GOOGLE_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET` (+`MICROSOFT_TENANT_ID`) and
  `FACEBOOK_CLIENT_ID/SECRET` add "Continue with …" buttons; `SMS_PROVIDER=twilio` with `TWILIO_*` adds text-message
  sign-in codes (`mail` sends them to Mailpit in development and is refused in production);
  `VAPID_PUBLIC_KEY/PRIVATE_KEY` (+`VAPID_SUBJECT`) enable web push for reminders; `STRIPE_SECRET_KEY` alone
  turns on card payments (prices found or created in Stripe by lookup key; optional `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_CURRENCY`, `STRIPE_PRICE_*`; without a key the owner sets the plan by hand, with one plans come from
  subscriptions or from site Admins in the staff console); `BACKUP_ENABLED`, `BACKUP_EVERY_HOURS`, `BACKUP_KEEP` schedule database dumps;
  `METRICS_TOKEN` protects `/metrics`; `ERROR_REPORT_URL` receives a JSON report for every unhandled API error.
* **White-label** — an organisation's `customDomain` (Settings → Branding, owners) resolves a host name to that
  organisation: point the host at the installation and let the reverse proxy accept it; sign-in and public pages
  then carry the organisation's name, logo and colours (`GET /api/v1/public/branding`).
* **Sign-in** — a password, a 6-digit code by email (which also creates the account for a new address), a code by
  text message to a number verified on the account, a passkey, or a configured provider. Codes: 10 minutes by
  email, 5 by text, single use, rate-limited per connection; a text goes only to a number on an account (or to a
  signed-in person adding theirs), so the endpoint reveals nothing and cannot be used to send texts elsewhere.
  Google and Apple sign-ins with the same verified email join the existing account; other providers are connected
  from Settings → Security once signed in. An account with two-step sign-in on is asked for its authenticator code
  after an email code, a text code or a provider sign-in too (a passkey counts as the second step).
* **Security** — Settings → Security lists the ways to sign in (password, passkeys, mobile number, connected
  providers), turns on TOTP two-step sign-in per account (backup codes included; accounts without a password can
  too), lists and revokes sessions, and lets an owner require two-step sign-in for the whole organisation: members
  without it are held at an enrolment screen until they set it up (`TWO_FACTOR_REQUIRED`). API keys carry scopes.
* **Contact enquiries** — messages from the public contact form are kept in `contact_enquiries` (no tenant) and
  listed for site staff at `/staff/enquiries` (Support and above; Admins delete); with `CONTACT_EMAIL` each is also
  emailed there, retried by the worker with backoff (1 min to 3 h, six attempts) when sending fails. They are
  deleted 12 months after they arrive. The form is open when there is an inbox or at least one site staff member.
* **Migrations** — the application roles' default grants are set before migrations run, so a brand-new database
  gets every table's grants (and each migration's deliberate REVOKEs) in its first `pnpm db:migrate`. Before
  24 October 2026 they were set afterwards, so a database created empty and migrated in one go lacked the grants on
  tables added after `0001`; databases migrated step by step (every deployment so far) were not affected.
* **Payments** — with `STRIPE_SECRET_KEY` set, owners buy Starter, Club or Studio (monthly or yearly) through
  Stripe Checkout from Settings → Plan; the plan applies when they come back (the session is read from Stripe), and
  renewals, cancellations at period end, failed payments (the plan is kept while Stripe retries) and deleted
  subscriptions arrive through the webhook, or within 15 minutes through the worker's sync. *Manage billing* opens
  the Stripe customer portal. The pricing page shows the currency of the Stripe account once payments are on.
* **Site staff** — the people who run the installation, across every organisation (not an organisation's own
  members). `PLATFORM_OWNER_EMAILS` (comma-separated) makes those verified accounts Owners; they add the rest in
  the staff console at `/staff` → *Staff team*. Four roles, each with everything below it:
  *Support* looks up organisations and accounts (members, usage, recent activity) and resends verification emails;
  *Moderator* also takes down public content (a match's public page, media share links; *Public links* finds the
  organisation behind a reported link); *Admin* also suspends and reactivates organisations, disables and enables
  accounts, signs accounts out everywhere, sets plans, manages Moderators and Support and reads the
  *Staff log*; *Owner* also manages Admins and other Owners. Nobody changes their own role, Admins cannot act on
  Owners or other Admins, Owners from the configuration are changed there, and there is always one Owner.
  Every action needs a reason where it changes something, and is written to the append-only staff log
  (`platform_audit_logs`) and to the organisation's own activity. Staff read other organisations through
  read-only row-level security policies (`staff_read` on organisations, memberships, plans and billing
  accounts); changes run in the organisation's tenant context. **A plan set by staff always ends**: 1, 7, 14, 30, 60
  or 90 days, 1, 3, 6 or 12 months, a chosen date (within five years) or Permanent, chosen on purpose. It applies
  instead of the plan the organisation pays for (or its owner chose) until then; the worker ends it within a minute
  of the time (logged as the system in both logs) and the organisation goes back to its own plan. *End now* ends it
  early, setting the plan again replaces it, and an owner who starts a paid subscription ends it too. The console
  shows the end on the organisation page and in the list; owners see it under Settings → Plan. A suspended organisation's members see a suspended screen
  (`ORGANISATION_SUSPENDED`); its graphics outputs, public match pages, share links, API keys and invitations stop
  resolving; nothing is deleted and reactivating restores everything (open outputs keep their last picture until
  reloaded). A disabled account is signed out everywhere and its sign-ins are refused (`ACCOUNT_DISABLED`).
  Staff do not get into an organisation's workspace; to work inside one, its owner invites them.
* **Webhooks** — Settings → Integrations (admins). Each delivery is signed: `X-Webhook-Signature: t=<unix>,v1=<hex>`
  where `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`, with `X-Webhook-Event` naming the event. Private, loopback
  and link-local hosts are refused and `https` is required outside local development. Failed deliveries retry with
  increasing delays and are marked dead after the last attempt.

## Deployment with the image

```bash
docker build -t broadcast-studio-app:local \
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
* **Built-in scheduled dumps** — with `BACKUP_ENABLED=true` the worker writes a compressed `pg_dump` to the media
  bucket under `backups/` every `BACKUP_EVERY_HOURS` hours and keeps the last `BACKUP_KEEP`. The runtime image
  ships `pg_dump`. Owners see the runs under Settings → Backups and can request one now (the worker runs it;
  the API process never dumps). Restore with `pg_restore` into an empty database, then run the migrations.
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
state='pending'`), dead letters (`state='dead'`), automation runs/cues tables (the desk shows reasons),
`broadcast_sessions`/`output_sessions` state and `error`, destination `last_status`, export job states,
`usage_ledger`.

* **Metrics** — `GET /metrics` (Prometheus text format; `Authorization: Bearer $METRICS_TOKEN` when set): HTTP
  request counts and duration, live matches, connected graphics outputs, pending outbox rows, worker liveness,
  event-loop lag and process memory/uptime.
* **Status** — `GET /api/v1/status` (and the `/status` page): database, realtime cache, storage, email, streaming
  mode and worker liveness, plus live-match and renderer counts.
* **Error reports** — every unhandled API error is logged with its request id and, when `ERROR_REPORT_URL` is
  set, posted there as JSON (request id, route, message, stack); the client sees only the request id.
* **Reminders and demo runner** — worker loops: kick-off reminders (email, and web push when configured) an hour
  before the start and a nudge when a match has been live for three hours; the demo runner advances demo matches
  through the real scoring commands.

## Failure runbooks

| Symptom | Check | Action |
| --- | --- | --- |
| Stream stuck in **WAITING_FOR_INPUT** | Streams → Inputs health; ingress logs | Verify encoder URL/key (reveal, or rotate and update OBS). After the bounded wait the session fails with `NO_INPUT` and releases capacity. |
| **DEGRADED: INPUT_LOST** | Input preview; encoder | Holding slate is on air and recording continues. Restore the encoder; the session returns to LIVE without a new session. |
| **DEGRADED: DESTINATION_FAILED** | Destination status badge/error | Other destinations and the recording continue. Fix the platform key/server and restart the stream when convenient. |
| **CAPACITY_REACHED** on start | Streams → Sessions capacity line | Stop another output or add egress capacity, then raise `MAX_CONCURRENT_PROGRAMMES` only after measuring. |
| Egress failed repeatedly | `output_sessions.error`, egress logs | Up to 3 automatic restarts create new recording parts; after that the output is FAILED. Check `INTERNAL_RENDER_BASE_URL` reachability from egress and S3 credentials in `.data/config/egress.yaml` (`storage.s3`). |
| An upload fails or a logo never appears | Library → Files: the file's state and reason; API logs | Images are ready as soon as the upload completes; a FAILED image says why (*not a PNG, JPEG or WebP image*, *larger than 8000 px*). If object storage is down, small files are kept in `media_blobs` automatically; video needs storage, so fix `S3_*`. An image stuck in PROCESSING is over 25 MB and waits for the media worker. |
| Graphics on desk but not on output | Desk diagnostics: renderer list, *displayed* revision | Output not connected (reload the browser source), capability rotated (use the new URL), or realtime bus down (see Redis). |
| Redis down | `redis-cli ping`; API readiness | Scoring and automation keep committing; outputs do not show *displayed* until Redis returns; the outbox drains automatically. |
| Worker restarted mid-match | worker logs | Automation lease moves with a higher fence; expired cues are skipped, not replayed. Sessions are reconciled from provider state; unknown egress in our rooms is stopped. |
| Highlight **NEEDS_ALIGNMENT / FAILED (gap)** | Match → Media → highlight reason | The recording lacks media at the event time. Cut manually from the recording if partial media exists; calibrate input delay (`inputs.source_delay_ms`, output `calibration_ms`). |
| Export stuck RUNNING | Exports tab | Cancel (kills only that job's FFmpeg), then Retry. Queued jobs lost with Redis are re-enqueued every minute. |
| Outbox dead letters | `outbox_events where state='dead'` | Inspect `last_error`, fix the cause, re-queue with the relay's `retryDead()` (subscribers are idempotent). |
| Leaked share link | Media → Share links | Revoke: every following page, metadata and byte-range request is refused (410). |
| Suspected key leak | Audit log (`input.key_revealed`) | Rotate the input key (old key stops at the provider) and destination keys at the platform. |
