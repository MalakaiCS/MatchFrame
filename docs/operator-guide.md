# Operator and producer guide

## Before the match

1. **Fixture** — Matches → open the fixture. Check teams, venue, kickoff (shown in the organisation timezone,
   stored in UTC) and the lineup snapshot. Lineups lock at kickoff; later roster changes never rewrite them.
   *Create a round* on the competition's Fixtures tab makes a whole round at once and can copy another match's
   look, automation and output format.
2. **Match day checklist** — at the top of the match page: lineups entered, a look chosen, automation set, a
   scorer assigned, OBS connected. Each line has its action in place; *Copy OBS link* and *Send scorer link*
   (with a QR code) sit beside it. The dashboard shows the next match with the same three buttons.
3. **Line-ups** — the Lineup tab (or the scorer's phone) sets starters, bench, captain and formation from the
   season roster. *Use last line-up* and *Use team default* fill a side in one tap; *Save as team default* keeps a
   side for next time. The usual number of starters for the sport is shown as a hint, never enforced.
4. **Match information** — officials, attendance and weather on the Overview tab feed the match information
   strap, the officials graphic and the public match centre.
5. **OBS link** — every match has one graphics output from the moment it is created. Match → *OBS link* →
   *Copy link*, then in OBS add a Browser Source (1920×1080, or 1080×1920 for a vertical output; transparent, no
   custom CSS). The status turns green once OBS is showing the page. *Download OBS scene collection* gives OBS a
   ready-made scene per output. *Advanced → create a new link* if the link leaks; the old one stops at once.
   A second output (a clean feed, a vertical social stream, a venue screen) is under *More outputs*.
6. **Output format** — each output is 16:9 broadcast, 9:16 vertical (scorebug at the top, events at the bottom,
   boards scaled to the width) or venue screen (large type, no ticker). The same graphics render in all three.
7. **Automation** — choose a published plan on the match (checklist) or as the competition default. Plans are
   edited in plain language under Automation (when it runs, which steps, how long). Each playlist can carry
   **conditions** (*Only when… the score gap is at least 3*, a statistic threshold, the match minute, quiet time
   since the last graphic) and **Ask the producer before sending**, which parks its cues in the control room
   until someone presses *Send now*. *Rehearse* plays the draft through the real graphics against a made-up
   match, with nothing sent to any output. Starter plans exist for all six sports.
8. **Streaming (optional)** — Streams → *New input*; give the encoder the RTMP URL and key (reveal is audited;
   the transport is labelled unencrypted). On the match *Streams* tab add a **Programme** output (with graphics)
   and optionally a **Clean** output (no graphics), pick the input and preset, add up to three destinations
   (YouTube/Facebook/Twitch: paste the server URL and stream key from the platform) and *Start stream*.
   The state goes STARTING → WAITING_FOR_INPUT → LIVE only when the media provider reports the output active.
   1080p presets are offered per match but marked *not yet measured on this installation*: rehearse before
   relying on one.

## Sports

Football, basketball, netball, rugby league, AFL and hockey share the same scorer, graphics and automation.
What differs is the rule set (periods, clocks, scoring values), the event buttons and the wording:

| Sport | Scoring and events | On the scorebug |
| --- | --- | --- |
| Football | goals (with assist and type), penalties, own goals, yellow/second yellow/red, substitutions, shoot-out | score, added time, shoot-out tally |
| Basketball | +1/+2/+3 with the scorer named afterwards, foul types, timeouts, possession, rebounds, assists | team fouls and bonus, timeouts remaining, shot clock |
| Netball | goals and missed shots, intercepts, rebounds, turnovers, penalties, centre pass, rolling substitutions | quarter and score |
| Rugby league | try, penalty try, conversion, penalty goal, field goal, sin bin, send off, interchange, six again | score and sin-bin markers |
| AFL | goal, behind, rushed behind, interchange, marks, tackles, inside 50s, clearances | the "12.7 (79)" score line |
| Hockey | goals, green/yellow/red cards, substitutions, penalty corners and strokes, shoot-out | quarter and score |

Rolling-substitution sports let a player come back on; football does not. The scorer's player pickers only
offer players who can make the change (who is on the field is tracked from the line-up plus substitutions and
dismissals), and a season's player totals (appearances, goals, assists, points, cards) accumulate from the same
records.

## Looks

Themes → a look is one of four styles (broadcast, minimal, club, premier) with the organisation's colours, logo and
team colours, previewed on real graphics. **Premier** is the top-flight football broadcast look: deep purple panels,
hot magenta kickers, electric teal accents, white paper for the words and condensed uppercase type on a shared
slant. It is an original design in that spirit and carries no league marks; a club can retint it like any look. A look also sets the **scorebug variant and position**, the **clock
style** (hide seconds; added time as "+3" or a label), **wording** overrides for on-air labels (bilingual
competitions), **audio stings** on goals and cards (the OBS browser source captures them) and a **custom font**
uploaded through the asset library. When two kits are too close in colour the away side switches to its
alternate colours automatically. Published versions are immutable: a match keeps the version it started with
until you apply the newer one on its OBS link tab.

## Graphics

Twenty-eight built-in graphics render in every look: scorebug, match ident, team line-up, formation, goal /
score event, score update, card, substitution, kick-off and period banners, lower third, player card (with
headshots from the asset library), match statistics, live statistic comparison, break and final score, match
summary, head to head and form, league table, fixtures and results, top scorers, player of the match, match
information strap, shoot-out tracker, timeout, sponsor graphic, stinger wipe, holding slate, full-frame media
and the ticker (which can carry the other live scores of the round). Goal, card and substitution graphics can
carry a "presented by" sponsor; those appearances count in the sponsor delivery report.

## In the control room

* **Preview vs To Air** — selecting a graphic and editing its fields changes only the preview. *To air* (F8)
  sends it; *Out* (F9) takes it out; the buttons stay pinned at the bottom of the form. *Sent from this desk*
  shows *requested → accepted → displayed*; *displayed* means OBS acknowledged the change. Press **?** for the
  shortcut list. *What happens next* tells you which graphics run when the scorer presses the next phase.
* **Auto / Manual** — Manual pauses automatic takes and cancels pending automatic cues; what is on air stays.
  Returning to Auto does not replay anything that happened meanwhile; the default scorebug is restored in play.
* **Waiting for your go-ahead** — cues from an approval-mode playlist appear above the preview with *Send now*
  and *Skip*. Nothing from such a playlist reaches the output without a decision.
* **Who else is here** — the header lists the other desks on this output. Selecting a graphic tells them which
  layer you are preparing; if someone else is preparing the same layer, *To air* waits and says who.
* **Run sheet** — the bottom tabs carry the match's run sheet (timed lines such as *KO-10 opening ident*),
  ticked off live by anyone on the match; the same sheet is on the match page and in the commentator view.
* **Export** — renders the preview or what is on air as a transparent PNG, or a short WebM clip of the animation,
  at the output's native size, for the club's social accounts. Made in the browser; nothing is uploaded.
* **Emergency clear** — press and hold: every layer and the scorebug go out and automation is inhibited until
  you press *Resume*.
* **Priorities** — a goal (priority 1) interrupts a sponsor loop (priority 3); equal priorities queue in order;
  promotional items that lose priority are skipped and the reason appears in the automation history.
* **Programme monitor** — for cloud outputs the control room shows the *actual* programme from HLS with its
  latency label; the local preview is labelled Preview and is not proof of what went out.
* **Stream Deck and hotkeys** — the OBS link tab lists one web request per button (scorebug on/off, clear,
  take any graphic, run a playlist, resume). Send them with an API key that has the overlay.operate scope.

### What the football starter plan does on its own

The scorer's phase buttons drive the graphics, in the order a top-league broadcast runs them. Each step replaces
the one before it, and the walk-out repeats before the second half:

| Scorer presses | On air |
| --- | --- |
| *Pre-match* | match ident (teams, kick-off time, venue) and the sponsor slate, looping |
| *Players entering* | home lineup, then away lineup, looping |
| *About to start* | "About to start" banner with the score and period |
| *1st Half* / *2nd Half* | full-frame graphics clear, scorebug in, "Kick-off" banner |
| *Half Time* / *Full Time* | scorebug out; score, match stats and sponsor, looping |

During play only **goals, yellow and red cards and substitutions** put a graphic on air (then the goal partner
logo after a goal). Corners, shots, saves, fouls and offsides are recorded as statistics and appear on the
half-time and full-time stats board, not as graphics of their own. Every graphic builds in parts and animates
out; the scorebug's score, period and added-time indicators animate when they change. Automation only acts in
*Auto* mode. The other sports' starter plans follow the same shape with their own words (centre pass, first
bounce, push back, final siren).

## Producer board and companion views

* **Producer board** (menu) — every live match and today's fixtures on one screen: score and phase, whether a
  scorer is connected, each output's OBS state and mode, what is on air, cues waiting for approval, and buttons
  into the control room, the match page and the scorer.
* **Commentator view** (match page → *Commentator view*) — a read-only, large-type page for the commentary
  position: line-ups with what each player has done, key events, statistics, head-to-head, form, the table
  around both teams, officials and the run sheet. Text size and full screen are one tap away.
* **Match centre for fans** (match page → Overview) — a public link with the live score, events, line-ups,
  statistics and the table, plus a JSON feed for club websites. Create, rotate or switch it off at any time.
* **Activity** (match page tab) — one timeline in plain words: scoring, desk commands, graphics on and off air,
  set-up changes, with who did what.

## Season data

Competition → *Table*, *Results & fixtures* and *Players* show the league table (points for a win, draw, loss
and bye and the tiebreakers are set under *Table rules*), every round with scores, and player totals across the
season. *Roll over* on an active season creates the next one, carries rosters forward and archives the old
season with its results and tables intact. The same table, fixtures and top scorers are available as graphics.

## Sponsors and reports

Sponsors → brands, creatives (images/videos from the asset library; approve before use), campaigns (flight,
priority, weight, caps, spacing, placements). Reports → *Sponsor delivery* shows confirmed on-air occurrences and
seconds per output, the evidence type (compositor pixels or render delivery) and per-destination status;
*Graphics on air* shows the same confirmed timing for every graphic, by graphic, match, sponsor artwork and
source. Neither shows audience numbers. Export CSV for partners (formula-safe).

## After the match

Media → highlights are created automatically for goals/key events from the recorded programme once the
post-roll has been recorded (usually within ~30 s). *Edit* to trim, choose 16:9 / 9:16 / 1:1 with a crop
position and add intro/outro creatives, then download from Exports. *Share* creates an expiring link (revocable).
A corrected event marks its clip **stale** — review it before publishing.

## Trying it out

*Start a demo match* (dashboard quick actions, or a competition page) creates a match between two of your teams
that scores itself through the real scoring path at the speed you choose. It is labelled *Demo* everywhere and
left out of tables and reports. Open the scorer, the control room and the OBS link to watch everything move.

## Common problems

See the failure runbooks in [`operations.md`](operations.md#failure-runbooks).
