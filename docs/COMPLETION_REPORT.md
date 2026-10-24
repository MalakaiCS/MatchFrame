# Completion report — P0 release

## What was built

All P0 milestones (M0–M7 in `IMPLEMENTATION_PLAN.md`) are implemented in this repository as working source:
multi-tenant foundation with RLS, real auth, CSV fixture import; football and basketball scoring with anchored
clocks, corrections, fenced scorer lease and an offline-capable scorer PWA; a shared graphics renderer with three
original themes, overlays with capability URLs and a production desk; durable game-plan automation with
priorities, rehearsal and starter plans; sponsor campaigns with render/compositor-verified delivery reports;
streaming operations through a real LiveKit adapter (programme/clean outputs, ≤3 RTMP destinations, authorised
HLS, input preview, multiview, recovery); and a media library (uploads with content validation, recordings,
live highlights by UTC capture time, editor exports in three aspects, compilations, share links, quota, retention,
usage ledger). Migrations, a seed with synthetic data, Docker Compose, an app image, `.env.example`, runbooks and
operator/scorer guides are included.

## How it was verified

* `pnpm typecheck`, `pnpm lint`, `pnpm build` — clean.
* `pnpm test` — 59 unit tests; `pnpm test:db` — 51 integration tests on real PostgreSQL with the application
  roles (plus MinIO and FFmpeg for media); `pnpm test:e2e` — 4 Playwright specs in a real browser.
* Real media: RTMP → LiveKit → programme/clean → RTMP receiver + HLS + recording (pixel/luma and audio analysis
  of what the receiver recorded), live highlight → export → share, sponsor-video audio policies measured on the
  recorded audio, Redis outage and control-plane restart drills, restore into a clean environment, secret scan,
  latency measurements and a 30-minute two-session soak.

Per-requirement results with evidence paths: `ACCEPTANCE_RESULTS.md` — 51 PASS, 2 PARTIAL (A21, A40),
1 FAIL (A51 on this host); several PASS rows carry explicit scope notes.

## Defects found by verification and fixed

* Scorer offline: the app trusted an open WebSocket over the browser's offline signal; the service worker did not
  cache the match page/chunks loaded before it took control; the shell blocked on the account request offline;
  offline-chain reconciliation compared against cached state (could auto-rebase stale intents).
* Session control: a row lock was held across slow `StartEgress` calls (timeouts → duplicate egress); now
  compare-and-set state, per-session advisory lock, and adoption of an accepted-but-unconfirmed egress by id.
* Egress template: React cleanup emitted `END_RECORDING`, ending egress early.
* Egress storage settings were ignored (`storage.s3` key) and admission blocked programme+clean.
* API request logs contained share tokens; production bundles could not resolve workspace dependencies.

## What is not claimed

* **Two simultaneous 720p programmes** (§2.2) — FAIL on the only available 4 vCPU host (see A51). Re-measure on a
  larger media node before raising `MAX_CONCURRENT_PROGRAMMES`.
* **A/V skew ≤150 ms** — not strictly met in M0 (median +79 ms, stdev 138 ms); not measurable under the
  oversubscribed soak.
* A real failing RTMP destination (A40) was exercised only with the fake provider; missing-image fallbacks (A21)
  have no automated screenshot assertion; highlight marker error was not measured with a dedicated marker.
* Not implemented: a single "Run demonstration" button, a metrics scrape endpoint, graphics-active usage metering.
* P1 backlog items (SRT, programme WebRTC, platform OAuth, billing, more sports, …) are listed, not built.

## Running it

See `README.md` (quick start and commands) and `docs/operations.md` (deployment, backups, runbooks).
