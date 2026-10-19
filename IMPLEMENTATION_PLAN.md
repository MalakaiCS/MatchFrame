# Implementation plan

Source of truth: `MVP_SPEC.md`. P0 = complete first usable release; P1 = backlog below (not claimed).

## Status

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 Media spike | LiveKit RTMP → room → template → HLS/RTMP/MP4 → clip | Done (single session) — see MEDIA_SPIKE.md |
| M1 Tenant foundation | Auth, orgs/roles/grants, RLS, catalog, fixtures + CSV import | In progress |
| M2 Scoring & realtime | Sport adapters, clock, facts/corrections, lease, idempotency, realtime, scorer PWA + offline outbox | In progress |
| M3 Graphics & desk | Shared renderer, 3 themes, overlays, production URLs, control room, designer | Not started |
| M4 Automation & sponsors | Durable game plans, priorities, rehearsal, sponsor allocation + evidence reports | Not started |
| M5 Streaming ops | Inputs/destinations/outputs, sessions lifecycle, HLS gateway, health, multiview | Not started |
| M6 Media library | Recording reconciliation, timeline mapping, highlights, editor, exports, retention, shares | Not started |
| M7 Verification | Section 3 demo, acceptance matrix, soak, restore drill, runbooks | Not started |

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
2. Native SRT ingest, programme WebRTC monitoring, adaptive bitrate.
3. Independent language/territory programmes.
4. Rive import/runtime with typed bindings.
5. Licensed data-provider adapters.
6. Platform OAuth/event creation, direct social publishing.
7. Club self-service sponsor delegation, partner portals.
8. Advanced timeline editing, audio tracks, automatic compilations.
9. Stripe billing.
10. Autoscaling, regional failover, managed operations.
