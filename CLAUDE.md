# Broadcast Studio — working notes for Claude Code

**Specification:** `MVP_SPEC.md` (requirements, architecture, acceptance contract). Plan: `IMPLEMENTATION_PLAN.md`.
Evidence: `ACCEPTANCE_RESULTS.md` (requirement IDs A01–A54), `MEDIA_SPIKE.md` (Milestone 0).

## Commands
```bash
pnpm setup            # once: .env with generated secrets, renders .data/config/* (LiveKit/ingress/egress/MediaMTX)
pnpm services:up      # postgres, redis, minio, mailpit, livekit, ingress, egress (docker compose, host network)
pnpm services:up:core # same without LiveKit (graphics-only: STREAMING_ENABLED=false)
pnpm db:migrate       # migrations as admin role; creates bs_app (RLS) / bs_worker (BYPASSRLS)
pnpm db:seed          # two orgs, football + basketball demo data
pnpm dev              # api :4000, worker, media-worker, web :3000
pnpm typecheck && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e && pnpm test:media
```
If the Docker daemon is not running in a cloud container: `dockerd > /tmp/dockerd.log 2>&1 &`.

## Layout
`apps/{web,api,worker,media-worker}`, `packages/{domain,contracts,db,services,graphics,media,ui,config}`, `infra/`, `tests/`, `docs/`.
Business rules live in `packages/domain` (pure) and `packages/services` (DB-aware). Apps are thin entry points.

## Invariants (do not break)
- Every tenant query runs inside `withTenant()` and filters `organisation_id` explicitly; RLS is the backstop.
  The API uses role `bs_app`; only workers use `bs_worker`. Never test isolation as a superuser.
- Match mutations go through `scoring.handleMatchCommand` only (lock → idempotency → version → lease → rules → outbox).
- Overlay mutations go through the overlay command service (operator and automation alike).
- Outbox rows are written in the same transaction as the change; publishing happens after commit.
- Published theme/template/game-plan versions are immutable (DB trigger). Changes create new versions.
- Secrets (stream keys, tokens) are encrypted or hashed, never returned by list APIs, sockets, logs or audit.
- The fake media provider is for tests/labelled demo mode only; missing config = blocked state, never fake LIVE.
- Never label an unexecuted check PASS in ACCEPTANCE_RESULTS.md.

## Current milestone
See the status table at the top of `IMPLEMENTATION_PLAN.md`.
