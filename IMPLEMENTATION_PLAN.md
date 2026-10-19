# Implementation plan

Source of truth: `MVP_SPEC.md`. P0 = complete first usable release; P1 = backlog below (not claimed).

## Status

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 Media spike | LiveKit RTMP → room → template → HLS/RTMP/MP4 → clip | Done — `MEDIA_SPIKE.md` |
| M1 Tenant foundation | Auth (verify/reset/MFA), orgs/roles/grants, RLS, catalog, fixtures + CSV import | Done |
| M2 Scoring & realtime | Sport adapters, anchored clocks, facts/corrections, fenced lease, idempotency, realtime, offline scorer PWA | Done (browser e2e A13–A15) |
| M3 Graphics & desk | Shared renderer, 3 themes, overlays, capability URLs, control room, constrained designer | Done |
| M4 Automation & sponsors | Durable game plans, priorities, rehearsal, sponsor allocation, render-verified evidence, reports | Done |
| M5 Streaming ops | Inputs/outputs/destinations, session lifecycle, authorised HLS, health, multiview, recovery | Done; capacity limited by host (see A51) |
| M6 Media library | Uploads, recordings, timeline mapping, live highlights, editor/exports, compilations, retention, shares | Done |
| M7 Verification | Acceptance matrix, e2e, real-media checks, resilience, soak, restore drill, secret scan, runbooks | Done — `ACCEPTANCE_RESULTS.md` |

## Architecture decisions

- **Monorepo** (pnpm workspaces, TypeScript 5.9, Node 22 LTS). Packages consumed as TS source (bundler resolution);
  apps bundled with esbuild for production; Next.js transpiles workspace packages.
- **Web**: Next.js 16 (App Router) + React 19 + Tailwind 4; Radix primitives for accessible dialogs/menus/tabs.
  Same-origin `/api/*` via Next rewrites in dev, reverse proxy in production.
- **API**: Fastify 5 + Socket.IO 4 (separate long-running process), Better Auth (email/password, verification,
  reset, TOTP MFA) mounted at `/api/auth/*`. REST under `/api/v1`, zod validation, typed error envelope.
- **Data**: PostgreSQL 16 + Drizzle; composite `(id, organisation_id)` FKs on high-risk joins; RLS forced for `bs_app`;
  SECURITY DEFINER functions only for capability-token resolution (overlay URLs, shares, invitations, API keys).
- **Delivery**: transactional outbox → worker relay (LISTEN/NOTIFY + polling) → Redis pub/sub (realtime fan-out)
  and BullMQ (control vs media queues). DB uniqueness is the dedup authority.
- **Automation**: worker-side, durable runs/cues tables, unique execution & cue keys, fenced worker lease.
- **Media**: LiveKit server/ingress/egress self-hosted (pinned), source-based `StartEgress` with our
  `/render/programme` template; egress writes HLS/MP4 to MinIO; RTMP destinations ≤3 per output.
- **Files**: media-worker runs FFmpeg/ffprobe with argument arrays, own process group, bounded time/size.

## Acceptance mapping
Each A-ID in `MVP_SPEC.md §26` has a row in `ACCEPTANCE_RESULTS.md` with the test reference and evidence path.

## P1 backlog (visible, not implemented)
1. More sport adapters (netball, rugby, AFL, cricket, tennis, hockey).
2. Native SRT ingest, programme WebRTC monitoring, adaptive bitrate; RTMPS ingest termination.
3. Independent language/territory programmes.
4. Rive import/runtime with typed bindings.
5. Licensed data-provider adapters.
6. Platform OAuth/event creation, direct social publishing.
7. Club self-service sponsor delegation, partner portals.
8. Advanced timeline editing, audio tracks, automatic compilations.
9. Stripe billing.
10. Autoscaling, regional failover, managed operations.

## Known P0 gaps and deviations (reported, not hidden)
* **Two simultaneous 720p programmes** (§2.2/§22) were attempted on the only available host (4 vCPU); see A51
  for the measured result. A larger media node is needed to claim the target.
* **One-click "Run demonstration"** workflow (§24) is not a single button: the seed creates labelled demo fixtures
  with automation and sponsors, and `pnpm demo:start` starts the stack; the synthetic fact timeline is available
  as rehearsal, not as a live demo driver.
* **Metrics endpoint** (§22 observability) is not implemented; the signals are queryable from tables/logs
  (see `docs/operations.md`).
* **Usage ledger** records streaming output-seconds, media job-seconds and daily storage bytes. Graphics-active
  time is not yet metered.
* **Performance targets** (§22) — see the measured latencies section in `ACCEPTANCE_RESULTS.md`; targets not
  listed there were not measured.
* **RTMP ingest** is plain RTMP (labelled unencrypted in the UI).
