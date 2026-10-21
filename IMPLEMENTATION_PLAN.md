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
| Hosted graphics-only edition | `STREAMING_ENABLED=false`, single-port container (`scripts/start-hosted.mjs`), Railway config, deploy guide | Done — built image run with env vars only: migrations on start, 5/5 e2e through the single port; not yet deployed to Railway |
| Operator UI pass | Match-day checklist, OBS link tab with an auto-created output, scorer "Next" flow and grouped events, control-room ergonomics, plain-English wording, visual automation and look editors, dashboard next-match and first-run cards | Done — screenshot tour of every reworked screen (desktop + phone) and 6/6 Playwright specs on the production build |
| Premier look | Fourth built-in theme in the style of top-flight football broadcast graphics (original design, no league marks): every template, all three output formats, visual baselines | Done |
| Premier look v2 | Restyled in the style of a top-flight football motion graphics pack: purple glass panels with angular facets, cyan-to-magenta rule, white score plates, crests on a team-colour glow, Outfit type, light sweep on entry, shard background; new immutable theme version (migration 0010); 37 Premier baselines regenerated | Done |
| Six broadcast packs | Liga, Major, Southern, Continental, Primetime and Meister: one engine (`theme-pack.tsx`) with per-look surfaces, corners, textures, title treatments, four scorebug layouts, event kickers, type and animated backgrounds; one shared list of looks (`LOOKS`, `THEME_KEYS`) drives every picker; migration 0011; five typefaces; 162 new visual baselines | Done |
| Match-day fixes (21 Oct) | First match in an organisation with no plan publishes the starter flow, so the OBS link shows the background and header at once; the match header has no set time on air and counts down to kick-off however far away; scorebug at About to start, clock from kick-off; the output format can be changed back to 16:9; names fitted after the web font loads; untouched copies of older starter flows upgraded on worker start and upcoming outputs moved to the new version; the match page offers a newer published plan version | Done |
| Walk-out exits, half-time timing, look choice (21 Oct) | Automatic clears take graphics out with their exit animation (board first, background 0.4 s later at the walk-outs); half time waits 10 s, then header and stats alternate 30 s each (playlists can start after a one-off delay); tournament look and match look chosen from the organisation's looks and all ten built-in looks | Done |
| Futsal (21 Oct) | Seventh sport under the Futsal Laws as Football Australia uses them: count-down halves on a stopped clock, accumulated fouls with the 10 m kick, timeouts, two-minute send-off, rolling substitutions, extra time and kicks from the penalty mark; presets for knockout, community and junior formats; futsal starter flow; scorer phone, scorebug, docs and site (beta) | Done |
| Football automation flow | Starter plan rebuilt to the requested match-day order: animated background and match header with kick-off countdown, timed line-ups once (skipped for a side with no line-up), scorebug and kick-off banner, half-time background cycling stats and header with restart countdown every 45 s, scorebug 7 s after the second-half walk-out, thank-you header 30 s after full time; background and full-screen boards above every in-play layer, stinger on its own top layer | Done (real-time Playwright run on the production build) |
| Public website | MatchFrame branding (vector mark, favicon, share image, product name default); public header and footer; homepage with an interactive sample of the real graphics engine; features, how it works, showcase, sports, pricing (being finalised), searchable FAQ, documentation hub with first-match and troubleshooting guides, contact form sent to `CONTACT_EMAIL`; indexing switch, sitemap and robots. New matches get automation and show the background and header from creation | Done; open owner decisions in `docs/public-site.md` |
| Sixty-feature pass | Six sports, league tables and season data, 28 graphics in three looks and three output formats, look options (scorebug variants, clock, wording, stings, fonts), scorer line-ups/feedback/sunlight/low-data/roles, producer board, approvals and conditions, presence and locks, run sheet, activity, commentator view, public match centre and feed, social exports, hotkeys and OBS scenes, webhooks, reminders, demo match, airtime report, billing, SSO, white-label, 2FA enforcement and sessions, backups, metrics/status, iCal and sheet import, rollover and bulk rounds | Done — see `docs/feature-pass.md` for the item-by-item record and what is config-gated or partial; unit, DB and Playwright suites on the production build |

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
1. Further sport adapters (cricket, tennis, futsal).
2. Native SRT ingest, programme WebRTC monitoring, adaptive bitrate; RTMPS ingest termination.
3. Independent language/territory programmes.
4. Rive import/runtime with typed bindings.
5. Licensed data-provider adapters (PlayHQ, Dribl); today fixtures import from CSV, iCal and published sheets.
6. Measuring 1080p on the hosted installation (presets are offered per match but marked unmeasured).
7. Verifying the config-gated integrations against live provider accounts (Stripe, Google/Microsoft, web push).
8. The club look's strip scorebug variant (club keeps the pill); headshots on the top-scorers board for players
   outside the match line-up.
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
