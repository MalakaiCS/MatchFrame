# The sixty-feature pass: what each item received

Status words: **Done** — built, typechecked, covered by the suites named in `ACCEPTANCE_RESULTS.md` where a
suite applies, and exercised on the production build. **Config-gated** — built and reviewed, but it needs an
outside account or keys that this repository does not have, so it has not been run against the real provider.
**Partial** — built with a stated gap. Nothing here is marked Done on the strength of code alone: the e2e,
visual and unit suites behind each group are listed in `ACCEPTANCE_RESULTS.md`.

## Graphics and match data (1–10)

| # | Item | Status | What shipped |
| --- | --- | --- | --- |
| 1 | League table graphic | Done | Standings computed from completed results (`packages/domain/src/standings.ts`, rules per sport, byes, percentage, win %); *League table* full-frame graphic in all looks; Table tab on the competition page. |
| 2 | Fixtures and results board | Done | *Fixtures and results* graphic by round; Results & fixtures tab; season fixtures API. |
| 3 | Formation graphic | Done | Formation field on the line-up (phone and desktop editors); *Formation* graphic draws the starters by position. |
| 4 | Full-time match summary | Done | *Match summary* graphic: scorers with minutes, cards, substitutions; scorers line on the break/final board. |
| 5 | Head-to-head and form | Done | Meetings and last-five form from stored results; *Head to head and form* graphic; commentator view. |
| 6 | Match info strap | Done | Officials, attendance and weather on the match; *Match information strap*; editor on the match page. |
| 7 | Penalty shoot-out tracker | Done | *Shoot-out tracker* graphic for football and hockey shoot-outs. |
| 8 | Live team-stats comparison | Done | *Live statistic* comparison graphic from the scorer's statistics; bars in the commentator and fan views. |
| 9 | Season player statistics | Done | Per-player appearances, starts, goals, assists, points, cards per season; *Top scorers* and *Player of the match* graphics; Players tab. |
| 10 | Custom brand fonts | Done | Font upload through the asset library; a look carries `fontUrl`, loaded with `@font-face` in every renderer. |

## Scorer and operator workflow (11–20)

| # | Item | Status | What shipped |
| --- | --- | --- | --- |
| 11 | Line-up editing on the phone | Done | `/score/:id/lineup`: starters, bench, out, captain, formation; last line-up and team default in one tap. |
| 12 | Haptic and sound confirmation | Done | Vibration patterns and WebAudio tones per action kind, switchable; floating Undo for a configurable window. |
| 13 | Narrower scorer roles | Done | `match.stats` (statistics only, no lease, server-enforced event group) and `match.view`; badges and reduced controls on the phone. |
| 14 | More sports | Done | Netball, rugby league, AFL and hockey adapters (rules, periods, events, display, starter automation plans), with unit tests. |
| 15 | Basketball depth | Done | Team fouls and bonus, timeouts remaining, possession, foul types, player fouls and foul-outs in the picker, rebounds and assists. |
| 16 | Producer board | Done | `/app/board`: live and today's matches with scorer, OBS state, mode, on-air layers, approvals waiting, links. |
| 17 | Stream Deck and hotkey API | Done | `POST /api/v1/hotkeys/:overlay/:action` with API keys; the OBS link tab lists every button as a request. |
| 18 | OBS scene collection download | Done | `GET /api/v1/matches/:id/obs-scene-collection.json`: a scene per output with the sized browser source. |
| 19 | Social exports | Partial | Transparent PNG and short WebM of the preview or on-air graphics at native size, rendered in the browser. The WebM is recorded at the browser's frame rate (not broadcast quality); MP4 is not produced. |
| 20 | Fixture import beyond CSV | Partial | iCal (.ics) files and published Google Sheet / CSV links feed the same dry-run and commit flow. PlayHQ and Dribl have no public API from this repository; they remain P1. |

## Platform, quality and business (21–30)

| # | Item | Status | What shipped |
| --- | --- | --- | --- |
| 21 | Scheduled reminders | Done (push config-gated) | Worker loop: kick-off reminder an hour out and a "still live" nudge, by email; web push when VAPID keys exist. Settings → Notifications subscribes a device. |
| 22 | Self-playing demo match | Done | *Start a demo match* creates a labelled demo fixture and drives it through the real scoring commands at a chosen speed; demos stay out of tables and reports. |
| 23 | Plain-words activity feed | Done | Match → Activity: scoring, desk commands, graphics on and off air and set-up changes with who did what. |
| 24 | Visual regression suite | Done | `tests/e2e/specs/visual.spec.ts`: every football graphic in each look, vertical and venue formats, and the sport-specific graphics of the other codes, compared against committed baselines. |
| 25 | Renderer performance | Done | Animation-frame driven updates with memoised parts; thumbnails rendered at hold phase. CPU inside OBS is not measured from this repository. |
| 26 | 1080p presets | Partial | Offered per match and labelled "not yet measured on this installation"; competition defaults stay at 720p. No 1080p soak has been run here. |
| 27 | Observability | Done | `/metrics` (Prometheus text, bearer token: HTTP counts and duration, live matches, connected outputs, pending outbox rows, worker liveness, event-loop lag, process memory), `/api/v1/status` and the `/status` page, error reports to `ERROR_REPORT_URL`. |
| 28 | Hosted backups | Done | Scheduled `pg_dump` to the media bucket from the worker; Settings → Backups lists runs and requests one now; the image ships `pg_dump`. The restore drill from M7 covers restoring a dump. |
| 29 | Security hardening | Done | TOTP two-step sign-in with backup codes, per-organisation enforcement with an enrolment gate, session list and revocation, password change, scoped API keys. |
| 30 | Billing and plans | Config-gated | Plans with limits, Stripe Checkout and customer portal through the REST API with webhook signature verification, manual plan setting without Stripe. Not exercised against a live Stripe account. |

## Graphics and on-air (31–41)

| # | Item | Status | What shipped |
| --- | --- | --- | --- |
| 31 | Around-the-grounds ticker | Done | The ticker carries the other live scores of the same competition and round. |
| 32 | Moment sponsorship | Done | "Presented by" on goal, card and substitution graphics; counted in sponsor delivery. |
| 33 | Stinger wipe | Done | *Stinger wipe* full-frame graphic with sponsor, from the control room or a hotkey. |
| 34 | Audio stings | Done | Look option: short WebAudio stings on goals and cards from the browser source. |
| 35 | Player headshots | Partial | Photos on goal cards, line-ups and player cards from the asset library; the top-scorers board shows photos only for players in the match line-up. |
| 36 | Scorebug variants and position | Partial | Box or strip, left/centre/right per look; the club look keeps its pill shape for the strip variant. |
| 37 | Colour clash handling | Done | Close primary colours switch the away side to its alternate colours automatically. |
| 38 | Vertical 9:16 output | Done | Output format per overlay; scorebug at the top, events at the bottom, boards scaled; 1080×1920 browser source. |
| 39 | Venue big-screen output | Done | Venue format: scorebug and events scaled up, no ticker. |
| 40 | Clock display options | Done | Hide seconds; added time as "+3" or a label; count-down sports keep their own clocks. |
| 41 | Localised wording | Done | Per-look wording overrides for on-air labels. |

## Scorer and match data (42–49)

| # | Item | Status | What shipped |
| --- | --- | --- | --- |
| 42 | Assists and goal types | Done | Assist and goal type on football goals (phone flow and later from Recent); assists in season totals and the summary board. |
| 43 | Who is on the pitch | Done | On-field tracking from line-up, substitutions and dismissals; substitutions validated server-side; pickers list on-field players first. |
| 44 | Default line-ups | Done | "Use last line-up", a saved default per team, "Save as team default". |
| 45 | Match officials | Done | Officials on the match; officials graphic and strap; public match centre. |
| 46 | Sunlight mode | Done | High-contrast palette switched from the scorer's preferences. |
| 47 | Low-bandwidth venue mode | Done | Polling fallback when the socket is unavailable, plus an explicit low-data preference; the status pill says which. |
| 48 | Commentator companion view | Done | Read-only large-type page with line-ups, events, statistics, head-to-head, form, table, information and run sheet. |
| 49 | Round bulk-create and templates | Done | Create a round from the competition page; copy setup (look, plan, output format) from an earlier match. |

## Operator workflow (50–54)

| # | Item | Status | What shipped |
| --- | --- | --- | --- |
| 50 | Conditional automation | Done | Condition guards (score gap, total score, statistic, minute, quiet time) edited in plain words; skipped runs say why. |
| 51 | Approval mode | Done | Per-playlist "Ask the producer before sending"; cues wait in the control room with Send now / Skip. |
| 52 | Presence and action locks | Done | Who else is in the control room; advisory layer locks while preparing a graphic; the command route refuses a clash (409). |
| 53 | Shared run sheet | Done | Timed lines and notes per match, ticked live; on the match page, in the control room and the commentator view. |
| 54 | Accessibility pass | Partial | Skip link, main landmark, labelled icon buttons, reduced-motion and prefers-contrast support, keyboard-reachable dialogs. No external audit was run. |

## Platform, integration and business (55–60)

| # | Item | Status | What shipped |
| --- | --- | --- | --- |
| 55 | Outbound webhooks | Done | Endpoints with event selection, HMAC signatures, retries and delivery history; private hosts refused. |
| 56 | Public match centre and feed | Done | `/m/:token` fan page and `/api/v1/public/match/:token/feed.json`; created, rotated and disabled from the match page. |
| 57 | Graphics on-air metering | Done | Confirmed time on air per graphic, match, sponsor artwork and source; Reports → Graphics on air with CSV. |
| 58 | Google and Microsoft sign-in | Config-gated | Social sign-in buttons appear when the provider keys are set; not exercised against live OAuth apps from this repository. |
| 59 | White-label | Done | Product name, logo, colours, support email and vendor hiding per organisation; custom domain resolution for sign-in and public pages. |
| 60 | Season rollover and archive | Done | Roll over from the competition page: next season, rosters carried forward, previous season archived with its results and tables. |
