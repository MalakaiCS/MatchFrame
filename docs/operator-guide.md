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

Football, futsal, basketball, netball, rugby league, AFL and hockey share the same scorer, graphics and automation.
What differs is the rule set (periods, clocks, scoring values), the event buttons and the wording:

| Sport | Scoring and events | On the scorebug |
| --- | --- | --- |
| Football | goals (with assist and type), penalties, own goals, yellow/second yellow/red, substitutions, shoot-out | score, added time, shoot-out tally |
| Basketball | +1/+2/+3 with the scorer named afterwards, foul types, timeouts, possession, rebounds, assists | team fouls and bonus, timeouts remaining, shot clock |
| Netball | goals and missed shots, intercepts, rebounds, turnovers, penalties, centre pass, rolling substitutions | quarter and score |
| Rugby league | try, penalty try, conversion, penalty goal, field goal, sin bin, send off, interchange, six again | score and sin-bin markers |
| AFL | goal, behind, rushed behind, interchange, marks, tackles, inside 50s, clearances | the "12.7 (79)" score line |
| Hockey | goals, green/yellow/red cards, substitutions, penalty corners and strokes, shoot-out | quarter and score |
| Futsal (beta) | goals (with assist and type), penalties and 10 m kicks, accumulated fouls, one timeout per half, yellow/second yellow/red with the two-minute send-off, rolling substitutions, kicks from the penalty mark | count-down clock, accumulated fouls (marked at five), timeouts |

**Futsal** follows the Futsal Laws of the Game as Football Australia and its member federations use them. The
default rules are two 20-minute halves on a stopped clock (counting down; pause it whenever the ball is out of play)
and a half-time interval of up to 15 minutes. The other presets are *Knockout* (extra time 2×5 and kicks from the
penalty mark, 5 each then one each), *Community 2×20 running clock, stopped in the final 2 minutes* and *Junior 2×15
running clock*; the competition page shows the rules in force. Competitions vary these, so check the competition's
own regulations.

* *Foul* records an accumulated foul (one penalised with a direct free kick or a penalty). Fouls count per half and
  reset for the second half; extra time carries on from the second half. At five the scorebug marks the team and
  the scorer phone says the next one is a direct free kick from the 10 m mark; from the sixth, every one is. A card
  for the same foul is recorded separately.
* *Timeout*: one per team in each half (60 s), none in extra time. Recording it stops the clock.
* A red card or second yellow leaves the team a player short for two minutes of playing time. The countdown runs
  only while the clock runs, carries across half time, and ends early when the other team scores while it has more
  players (5 v 4, 5 v 3 or 4 v 3 gives one player back); at level numbers, or when the short team scores, nothing
  changes. The scorer phone shows the players on the court and the time left. A substitute sent off from the bench
  does not reduce the team.
* Goals, penalties and 10 m kicks put the goal graphic on air, with the minute of play (18:30 left in the first
  half is the 2nd minute). The futsal starter plan is the football flow plus the timeout graphic and the match stats
  at a timeout; rolling substitutions put nothing on air.

Rolling-substitution sports let a player come back on; football does not. The scorer's player pickers only
offer players who can make the change (who is on the field is tracked from the line-up plus substitutions and
dismissals), and a season's player totals (appearances, goals, assists, points, cards) accumulate from the same
records.

## Looks

Themes → a look is one of ten styles (broadcast, premier, liga, major, southern, continental, primetime, meister, club, minimal) with the organisation's colours, logo and
team colours, previewed on real graphics. **Premier** is the top-flight football broadcast look, in the style of a
motion graphics pack: deep purple glass panels cut with angular facets, hot magenta kickers, electric teal accents, a
cyan-to-magenta rule, scores on white plates, crests on a glow of the team's colour and a geometric typeface (Outfit);
each graphic wipes in and a light sweep crosses it as it lands. It is an original design in that spirit and carries
no league marks; a club can retint it like any look. A Premier look published before 20 October 2026 keeps its old
typeface until it is published again. Six more looks follow other broadcasts in the same way: **Liga** (Spanish top
flight: white rounded cards, coral red, wide geometric type, a pill scorebug), **Major** (North American streaming:
smoked glass, event words in the scoring team's colour), **Southern** (Australian league: flat black, chunky capitals,
square blocks and a four-colour band), **Continental** (European club nights: navy, a starfield, silver hairlines,
light wide-tracked capitals), **Primetime** (US network: brushed metal, red, condensed italic capitals, a stacked
scorebug) and **Meister** (German top flight: white panels, red, slanted cuts and italic capitals). Each has its own
animated background. None carries a league's or broadcaster's marks, names or typefaces. A look also sets the **scorebug variant and position**, the **clock
style** (hide seconds; added time as "+3" or a label), **wording** overrides for on-air labels (bilingual
competitions), **audio stings** on goals and cards (the OBS browser source captures them) and a **custom font**
uploaded through the asset library. When two kits are too close in colour the away side switches to its
alternate colours automatically. Published versions are immutable: a match keeps the version it started with
until you apply the newer one on its OBS link tab.

**Choosing the look for a tournament and for a match.** Both pickers list your own looks, then all ten built-in
looks.

* *Competition → Graphics & production → Tournament look*: every match in the competition uses it unless it has
  a look of its own. New fixtures start with it, and upcoming matches that showed the previous tournament look (or
  no look) change to it straight away. A match under way, or finished, keeps the look it started with.
* *Match page → match-day checklist → Look*: a look for this match only, or *Same as the tournament* to put it
  back. It goes on the match's main output and on any other output showing the same look; an output given a
  different look on the OBS link tab keeps it.

Choosing a built-in look the first time saves it as a look of your organisation's, named after it ("Liga"), so it
can be given your logo, colours and wording under *Themes*; choosing it again uses that same look.

## Graphics

Twenty-nine built-in graphics render in every look: scorebug, match header (teams, ground and kick-off time with a
countdown before the match; the score, the break and a countdown to the restart during a break; the final score and
an optional closing message such as "Thank you for watching"), animated background, team line-up, formation, goal /
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

An organisation's first football match publishes the starter plan ("Football starter flow") if no football plan has
been published yet, so its OBS link shows the pre-match graphics straight away. Edit it under *Automation* like any plan.

The scorer's phase buttons drive the graphics. The output must be in *Auto*:

| Scorer presses | On air |
| --- | --- |
| *(nothing yet: the match has just been created)* | the animated background, then the match header on it: Home v Away, the ground and kick-off time, with a countdown to kick-off however far away ("3d 02:14:58" more than a day out). Both stay up, with no set time, until the players walk out |
| *Pre-match* | the same background and header stay up as they are (no second entrance) |
| *Players entering* | the header animates out, then the background 0.4 s later (each plays its exit animation, no hard cut); 15 s later the home line-up for 8 s, then the away line-up for 8 s, once each. *About to start* does not cut them short |
| *About to start* | the scorebug comes up, its clock at 0:00 |
| *1st Half* | the "Kick-off" banner, and the clock starts |
| *Half Time* | nothing changes for 10 s (the scorebug shows the half-time score); then the animated background animates in over everything, the scorebug goes, and the match header (score, HALF TIME, "2nd Half in 14:08") and the match stats take turns, 30 s each, header first, until the players come back out |
| *Players entering (2nd half)* | the board on air animates out, then the background 0.4 s later; the scorebug comes back 7 s later. No line-ups the second time |
| *2nd Half* | scorebug (already in) and the "Kick-off" banner |
| *Full Time* | the scorebug stays for 30 s, then the animated background, scorebug out, and the match header with the final score, FULL TIME and "Thank you for watching" |

A line-up board only goes to air for a team whose line-up has been entered (at least one starter). If a side has
no line-up its board is skipped, and the automation history says why; there is no empty "to be confirmed" board.
The half-time countdown runs from the moment *Half Time* was pressed, using the half-time length in the match
rules, and stops at zero rather than going negative.

**Layer order.** The animated background and the match header (and any other full-screen board) sit above every
in-play graphic: scorebug, event straps, lower thirds, ticker and sponsor logo. Only the stinger wipe plays over
them, and it no longer takes the header off when it runs. Taking the background in clears the small graphics; the
scorebug is taken off by its own step.

**Automation is on from the start.** A new match's own output takes the plan set on the match or the
competition; with neither, it takes the organisation's most recently published plan for that sport. The match-day
checklist shows which plan it is, and *Change plan…* picks another. Whenever an output gets a plan (at creation or
later), it catches up with the match straight away: before kick-off the background and header go up, during half
time the half-time boards start, and mid-half only the scorebug comes back (no kick-off banner at minute 30).

**Plans made before this flow.** A plan that is still exactly as an older starter flow left it (published as it
was created, nothing edited since) is brought up to the current starter flow when the worker starts after an update:
it gets a new version, the audit log says why, and the outputs of matches that have not started yet move to that
version and catch up (the background and header go up). Matches already under way keep the version they started
with. A plan someone has edited keeps its playlists: to switch it, open it under Automation, press *Use the latest
starter flow*, check it in *Rehearse*, and publish. A match keeps the plan version it was given, so after publishing,
its match-day checklist says a newer version is published and offers *Use v2* (or whichever is newest). Any phase
playlist can also be set to *Keep going when the scorer presses the next step*, which is how the line-ups survive
*About to start*; it still stops at kick-off, at a break or at full time.

During play only **goals, yellow and red cards and substitutions** put a graphic on air (then the goal partner
logo after a goal). Corners, shots, saves, fouls and offsides are recorded as statistics and appear on the
half-time and full-time stats board, not as graphics of their own. Every graphic builds in parts and animates
out; the scorebug's score, period and added-time indicators animate when they change. Automation only acts in
*Auto* mode. The other sports' starter plans keep their earlier shape with their own words (centre pass, first
bounce, push back, final siren); the animated background and match header can be added to them in the editor.

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
