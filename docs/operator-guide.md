# Operator and producer guide

## Getting around

The sidebar has **Home**, **Live**, **Matches** and **Competitions** at the top; **Graphics** (Looks, Automation,
Library); **Sponsors** (Sponsors, Reports); and, when streaming is on, **Video** (Streams, Videos). Settings, Help and
guides and (for site staff) the Staff console are at the bottom, and **New match** is always at the top. *Collapse*
folds the sidebar to icons; on a phone the menu button opens the same list, with your organisations at its top.
**Ctrl K** (⌘ K on a Mac), or the *Jump to or search* box, goes to any page, or searches matches by team or
competition.

The same few words are used everywhere: a **look** is the style of the graphics; the **desk** is the screen where an
operator sends graphics to air for one output; the **Library** holds teams, players, venues, clubs and files; and
**Videos** holds highlights packages and other exports (plus recordings and clips when streaming is on).

**Matches** lists the newest kick-off first (the competition's *Fixtures and results → All matches* and the scorer's
*Not played* and *Results* tabs too); a click on the *Kick-off* heading turns it round and is remembered for you.
*All*, *Upcoming*, *Today*, *This week* and *Past* pick the dates in one click (*Dates…* for your own); *Upcoming*
lists the soonest first unless you chose an order. Each row's *Status* says how ready a match is (*3 of 5 ready ·
Needs line-ups, OBS*, from the match-day checklist), who is scoring a live match, or the result, and a click anywhere
on a row opens the match. Lists of what is coming up (Home, Live, the scorer's *Now & next*) keep the next match at
the top.

**Home** shows the next match (scorer, desk and OBS link), what is live now and what is coming up. Matches still
marked live with nothing recorded for hours are one line (*Close them*) that opens Live's *Needs closing* list.

The sun/moon button in the top bar switches between light and dark; the account menu (your initial) has
*Appearance* (Light, Dark or System, which follows the device), *Account and sign-in*, Help and Sign out. The choice
is kept on each device. The scorer's *Sunlight* mode is separate and stays as it was.

**Signing in**: with a code by email (no password needed; a new address creates an account), a password, a passkey,
a code by text message (once a mobile number is added under Settings → Security → *Ways to sign in*), or Google,
Apple, Microsoft or Facebook where the installation has them set up. Settings → Security lists every way in,
adds passkeys and a mobile number, connects or disconnects providers, and sets a password by email link for an
account that has none. With two-step sign-in on, every way in except a passkey also asks for the authenticator
code.

## Before the match

0. **Rules** — a competition's rules start from a preset chosen when it is created, and its **match timing** can be
   changed right there in *New competition*: halves or quarters (basketball, netball, hockey), the length of each,
   the half-time interval and the breaks between quarters, with a picture of the match underneath (each period and
   break to scale, minutes of play and the total with breaks). *Extra time and the other rules* opens the rest:
   extra time or overtime with the breaks before and between its periods, golden point, shoot-outs, timeouts and so
   on. Changed rules are named from their timing ("Own rules 2×18, 5-minute half time") until you type a name.
   Later, *Competition → Overview → Rules → Edit rules and timing* changes any setting the same way, grouped as
   *Match timing*, *When the scores are level* and *Other rules*, shows the rules it makes, and refuses settings
   the sport does not allow. The break lengths drive the countdown to the restart ("2ND HALF IN 4:12") on the
   graphics and on the scorer's phone during every break. *Keep as one of your presets* saves them, under the name at the top,
   for other competitions: they are listed under *Your presets* when a competition is created and in *Apply
   preset*, and can be deleted from the same form. *Also use for upcoming matches nobody has started scoring*
   (on by default) gives the new rules to fixtures that have nothing recorded yet, not even a phase step, and
   resets their untouched clock to the new length; a match with anything recorded keeps the rules it has.
   **Finals rules**: finals matches use the competition's rules with a level score decided (extra time and
   penalties in football and futsal, a shoot-out in hockey, golden point in rugby league, extra time in AFL and
   netball). *Competition → Finals → Edit finals rules* gives the finals their own rules (for example extra time
   2×10); *Use the competition's rules* goes back. A single match can be made a **knockout** (Match → Overview →
   Rules → *Knockout*) before scoring starts, and from the scorer's phone once it has started.
1. **Fixture** — Matches → open the fixture. *New match* has a **Stage**: *Regular season* (counts for the
   ladder) or *Finals* (knockout rules; never counts for the ladder; the round is a name such as Quarter-final,
   Semi-final or Grand Final). The stage of an upcoming match can be changed on its Overview tab. Check teams, venue, kickoff (shown in the organisation timezone,
   stored in UTC) and the lineup snapshot. Lineups lock at kickoff; later roster changes never rewrite them.
   *Create a round* on the competition's Fixtures tab makes a whole round at once and can copy another match's
   look, automation and output format.
2. **Match day checklist** — at the top of the match page: line-ups entered, a look chosen, automation set, a
   scorer assigned, OBS connected. Each line has its action in place, and a choice (a look, a plan, a scorer)
   applies as soon as it is picked; *Copy OBS link* is on the OBS line and *Send scorer link* (with a QR code) at
   the top. Once all five are done the checklist folds to one line (*Ready to go*). The match page's tabs are
   *Overview*, *Line-ups*, *Timeline* (the event log and the activity), *Graphics* (the OBS link, more outputs and
   the run sheet) and *Media* (highlights and thumbnails; recordings too when streaming is on). Home shows the
   next match with its scorer, desk and OBS link buttons.
3. **Line-ups** — the Line-ups tab (or the scorer's phone) sets starters, bench, captain and formation from the
   season roster. *Use last line-up* and *Use team default* fill a side in one tap; *Save as team default* keeps a
   side for next time. The usual number of starters for the sport is shown as a hint, never enforced.
4. **Match information** — officials, attendance and weather on the Overview tab feed the match information
   strap, the officials graphic and the public match centre.
5. **OBS link** — every match has one graphics output from the moment it is created. *Copy OBS link* in the
   match-day checklist, or Match → *Graphics* → *Copy link*, then in OBS add a Browser Source (1920×1080, or 1080×1920 for a vertical output; transparent, no
   custom CSS). The status turns green once OBS is showing the page. *Download OBS scene collection* gives OBS a
   ready-made scene per output. *Advanced → create a new link* if the link leaks; the old one stops at once.
   A second output (a clean feed, a vertical social stream, a venue screen) is under *More outputs*.
   Streaming several matches back to back from one ground? Use one **stream link** for the whole day instead
   (*Live → Stream links*, below): OBS keeps the same browser source and the graphics move from match to match,
   and its **intermission link** gives you a screen of today's matches to transition to in between.
6. **Output format** — each output is 16:9 broadcast, 9:16 vertical (scorebug at the top, events at the bottom,
   boards scaled to the width) or venue screen (large type, no ticker). The same graphics render in all three.
7. **Automation** — choose a published plan on the match (checklist) or as the competition default. Plans are
   edited in plain language under Automation (when it runs, which steps, how long). Each playlist can carry
   **conditions** (*Only when… the score gap is at least 3*, a statistic threshold, the match minute, quiet time
   since the last graphic, the number of matches today in the same place) and **Ask the producer before
   sending**, which parks its cues on the desk until someone presses *Send now*. A plan opens with *What this
   plan does*, one plain line per playlist; priority, repeats, delays, conditions and approval sit under each
   playlist's *Fine-tune*, and the JSON view is for owners and admins. *Rehearse* plays the draft through the real graphics against a made-up match, with nothing sent to any
   output. Starter plans exist for all six sports; *Reset to the starter flow* puts a plan back to it.
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
| Football | goals (with assist and type), penalties, own goals, yellow/second yellow/red, substitutions, added time, shoot-out | score, running added time and the announced *+N*, shoot-out tally |
| Basketball | +1/+2/+3 with the scorer named afterwards, foul types, timeouts, possession, rebounds, assists | team fouls and bonus, timeouts remaining, shot clock |
| Netball | goals and missed shots, intercepts, rebounds, turnovers, penalties, centre pass, rolling substitutions | quarter and score |
| Rugby league | try, penalty try, conversion, penalty goal, field goal, sin bin, send off, interchange, six again, video review | score, sin-bin countdowns under the scorebug, the video review graphic |
| AFL | goal, behind, rushed behind, interchange, marks, tackles, inside 50s, clearances | the "12.7 (79)" score line |
| Hockey | goals, green/yellow/red cards, substitutions, penalty corners and strokes, shoot-out | quarter and score |
| Futsal (beta) | goals (with assist and type), penalties and 10 m kicks, accumulated fouls, one timeout per half, yellow/second yellow/red with the two-minute send-off, rolling substitutions, kicks from the penalty mark | count-down clock, accumulated fouls (marked at five), timeouts, the send-off countdown |

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

Looks → a look is one of eleven styles (broadcast, premier, liga, major, southern, continental, primetime, meister, derby, club, minimal) with the organisation's colours, logo and
team colours, previewed on real graphics. **Premier** is the top-flight football broadcast look, in the style of a
motion graphics pack: deep purple glass panels cut with angular facets, hot magenta kickers, electric teal accents, a
cyan-to-magenta rule, scores on white plates, crests on a glow of the team's colour and a geometric typeface (Outfit);
each graphic wipes in and a light sweep crosses it as it lands. It is an original design in that spirit and carries
no league marks; a club can retint it like any look. A Premier look published before 20 October 2026 keeps its old
typeface until it is published again. Seven more looks follow other broadcasts in the same way: **Liga** (Spanish top
flight: white rounded cards, coral red, wide geometric type, a pill scorebug), **Major** (North American streaming:
smoked glass, event words in the scoring team's colour), **Southern** (Australian league: flat black, chunky capitals,
square blocks and a four-colour band), **Continental** (European club nights: navy, a starfield, silver hairlines,
light wide-tracked capitals), **Primetime** (US network: brushed metal, red, condensed italic capitals, a stacked
scorebug), **Meister** (German top flight: white panels, red, slanted cuts and italic capitals) and **Derby** (Australian club
football: each team's block in its own colour with the crest breaking out of the end, a white score plate with the
clock in a grey tab under it that reads HALF TIME at half time and FULL TIME after the match; goals, cards and
substitutions are part of the scorebug: for a goal the new score shows first, then the scoring team's block runs
across the whole scorebug with GOOOOAL! (the clock stays underneath; a few seconds in, the scorer), and for a card
or substitution the team's block stays while the card (or SUBSTITUTION) runs across the rest with the player in a
row underneath; each runs back to the team's end and the scorebug is as before; the half-time and full-time board is the kick-off banner headed
by the break; and a full-screen half-time statistics board between the two teams' colour panels lists each team's
scorers). Each has its own
animated background. None carries a league's or broadcaster's marks, names or typefaces. A look also sets the **scorebug variant and position**, the **clock
style** (hide seconds; added time as "+3" or a label), **wording** overrides for on-air labels (bilingual
competitions) and a **custom font** uploaded through the asset library. Graphics make no sound: the OBS browser
source carries pictures only, so goals and cards come in silently and any sound is yours to add in OBS. When two kits are too close in colour the away side switches to its
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
can be given your logo, colours and wording under *Looks → Your looks*; choosing it again uses that same look.

**Competition logo.** *Competition → Overview → Logo*: upload the tournament's logo (PNG with a transparent
background works best, JPEG and WebP too) or choose one of your images. It shows beside the competition's name in
the app, and on the graphics of every match in the competition, whichever look they use: in the title bar of
full-screen graphics (line-ups, stats, tables) and on the holding slate, in place of the look's own logo. Outputs
that are open pick it up straight away; *Remove* goes back to the look's logo.

**Logos and photos everywhere they are used.** Every image field has *Upload*, *Choose from your images* and
*Remove* (each picture has one button, *Change logo* or *Add a logo*, whose menu uploads, picks from your images or
removes): competition logo (Overview), team logo and colours (*Library → Teams*, click the team, or in the
*New team* form; the colours the crest uses are offered as swatches, a new team takes its main and second colour
from its crest until you pick colours by hand, and *Use crest colours* sets both for an existing team), player photo (*Library → Players*, click the player), club logo (*Library → Clubs*), organisation
logo (*Settings → Branding*), sponsor artwork (*Sponsors → Add artwork*) and the look's logo (*Looks*). Any
image the browser opens works (PNG, JPEG, WebP, SVG, GIF, AVIF…): it is converted on the device to a PNG (logos,
keeping transparency) or JPEG photo no larger than 2048 px, and is **ready as soon as it has uploaded**, with no
wait for the media worker. A new team logo or player photo reaches the graphics of the team's upcoming and live
matches at once; finished matches keep the logo they were played with. When object storage is not configured or
cannot be reached, images, logos and fonts (up to 25 MB) are kept in the database instead, so uploads still work;
video and recordings need object storage.

## Graphics

The built-in graphics render in every look: scorebug, match header (teams, ground and kick-off time with a
countdown before the match; the score, the break and a countdown to the restart during a break; the final score and
an optional closing message such as "Thank you for watching"), animated background, team line-up, formation, goal /
score event, score update, card, substitution, kick-off and period banners, lower third, player card (with
headshots from the asset library), match statistics, live statistic comparison, break and final score, match
summary, head to head and form, league table, fixtures and results, matches today (the day's matches at the
ground: results, live scores and kick-off times), the intermission (the next match with its countdown over today's
matches), top scorers, player of the match, match
information strap, shoot-out tracker, timeout, added time (football), video review (rugby league), sponsor
graphic, stinger wipe, replay transition, the highlights title panel, holding slate, full-frame media and the ticker (which can carry the other
live scores of the round). Goal, card and substitution
graphics can carry a "presented by" sponsor; those appearances count in the sponsor delivery report.

**Penalty shoot-out tracker.** One bar with both crests at its ends, the names and the shoot-out score in the
middle, and under each name a marker per kick: green with a tick for a goal, red with a cross for a miss, dark for a
kick still to take, and the next kick ringed. The first five kicks always show (futsal: the number in the rules);
sudden death adds a marker per round after a divider. The line below says where it stands: *Kick 3 of 5 · Harbour
to kick*, *Sudden death · round 7*, *Harbour score to win* or *Harbour must score to stay in* when the next kick
decides it, and *Northgate win 4–3 on penalties* as soon as one team can no longer be caught with the kicks it has
left (so a shoot-out can end before all five are taken). After that no more kicks are accepted; kicks that were not
needed are dimmed. It updates live as the scorer records each kick, in every look (football, futsal and hockey), and the starter
flows put it on air by themselves when the shoot-out starts. An existing plan that is still an untouched copy of an
older starter flow gets this step when the worker next starts; an edited plan does not (add a *Penalty Shootout*
phase step that shows the shoot-out tracker).

**Added time, sin bins and send-offs on the scorebug.** When the football scorer enters added time, the fourth
official's board (the minutes lit on a dark board, in the look's strip) goes on air for 8 s, and every look's
scorebug carries a small *ADDED +4* tab under it for the rest of the half. A rugby league sin bin puts a tab under
the scorebug with the team, *SIN BIN* and the playing time left (*6:22*), counting down with the match clock; two at
once read *2× SIN BIN* with the one that ends first. Futsal's send-off shows the team's time a player short the same
way (*SENT OFF 1:11*). The tabs sit under the scorebug on whichever side the look puts it, and go when the time is
up. The sin bin's length is in the competition's rules (*Sin bin: minutes of playing time off the field*).

**Red cards on the scorebug.** A red card (football's second yellow too, hockey's red, a rugby league send-off)
puts a small red card on that team's side of the scorebug, standing up out of its edge beside the crest (out of the
end of the team's row in the stacked scorebugs). A second one shows its number on the card (*2*, *3*). It stays
for the rest of the match, in every look and in highlights packages.

**Video review (rugby league).** While the video referee checks a try (or a captain's challenge), a bar comes up in
the lower middle of the frame: the team's crest and name, *Checking*, and *TRY?* (*CHALLENGE*). When the scorer
gives the decision it flips to **TRY** in green or **NO TRY** in red (*SUCCESSFUL* / *UNSUCCESSFUL*), and the try
strap follows when a try is awarded; the starter flow takes the bar off 6 s later. From the desk it can
also be put up by hand, choosing the team, what is checked and what it shows (*Shows: auto* follows the scorer).

**Replay transition (OBS or vMix stinger).** In every look, a wall of slanted bands in the look's colours, edged
with a bright stripe, sweeps in, covers the whole frame with REPLAY in the middle, then sweeps on and away (2 s).
The bands move as one, so the picture never shows through between them on the way in or out. It comes in two
versions:
* *Plain*: the look only. *Looks → a look → Replay transition (WebM)* (opened from one of your own looks, it
  carries your colours and logo).
* *This match*: home's colours, crest and name on the left, away's on the right. *Match → OBS link → Replay
  transition → Export replay transition*, in that output's look; the same dialog also offers the plain version.

Choose the size (1920×1080 or 1280×720), the frame rate (25, 30, 50 or 60, the same as your OBS or vMix output)
and, if you like, your own word instead of REPLAY, then *Export WebM*. Every frame is drawn exactly as a still at its
instant (plain styles, not the browser's animations, so the file is the same whichever browser exports it) and
encoded on the server as a transparent WebM (VP9 with alpha). A stinger exported before 22 October whose word or
crests come back after leaving needs exporting again. In OBS: *Scene Transitions → + → Stinger*, choose the file, set
*Transition Point Type* to *Time* and *Transition Point* to **1000 ms** (the frame is fully covered from 500 ms
to 1440 ms). In vMix: set a Stinger transition to the file with its transition point (delay) at 1000 ms. The replay
transition is also one of the look's graphics, so it can be put on air on the output's transition layer.

## On the desk

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
  ticked off live by anyone on the match; the same sheet is on the match page (*Graphics*) and in the commentator view.
* **The header** — the output, Auto/Manual, one status (the most important of *Offline*, *OBS not connected*,
  *OBS catching up* or *OBS showing the latest*; hover for both details), *Copy OBS link*, *More* (export, keyboard
  shortcuts) and *Hold to clear*. Graphics are listed by name (*List*), or as pictures (*Tiles*).
* **Export** (*More → Export a graphic*) — renders the preview or what is on air as a transparent PNG, or a short WebM clip of the animation,
  at the output's native size, for the club's social accounts. Made in the browser; nothing is uploaded.
* **Emergency clear** — press and hold: every layer and the scorebug go out and automation is inhibited until
  you press *Resume*.
* **Priorities** — a goal (priority 1) interrupts a sponsor loop (priority 3); equal priorities queue in order;
  promotional items that lose priority are skipped and the reason appears in the automation history.
* **Programme monitor** — for cloud outputs the desk shows the *actual* programme from HLS with its
  latency label; the local preview is labelled Preview and is not proof of what went out.
* **Stream Deck and hotkeys** — the match's Graphics tab lists one web request per button (scorebug on/off, clear,
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
| *Half Time* | the half-time banner for 10 s (the kick-off banner's design, headed HALF TIME, over the scorebug with the half-time score); then the animated background animates in over everything, the scorebug goes, and the match header (score, HALF TIME, "2nd Half in 14:08") and the match stats take turns, 30 s each, header first, until the players come back out |
| *Players entering (2nd half)* | the board on air animates out, then the background 0.4 s later; the scorebug comes back 7 s later. No line-ups the second time |
| *2nd Half* | scorebug (already in) and the "Kick-off" banner |
| *Penalty Shootout* | the shoot-out tracker comes up under the scorebug and stays, updating with every kick, until full time (also in the futsal and hockey starter flows) |
| *Added time* (under the clock) | the fourth official's board for 8 s; the scorebug keeps *ADDED +N* until the end of the half |
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
Full time stays the match's own in every starter flow: between back-to-back matches, today's matches are on the
intermission screen, a separate link (see *Stream links* below). A plan can still show the *Matches today* board
at full time when more matches follow, with a *Full time* playlist and the condition *the number of matches today
in the same place is at least 2*.

## Live and companion views

* **Live** (menu) — every live match and today's fixtures on one screen, one card each: score and phase, the
  **Desk** button for each output, *Scorer* and *Commentator*, and only what needs acting on (no scorer on a live
  match, OBS not showing an output, manual mode, cues waiting for approval). Matches still marked live but quiet
  for hours are under *Needs closing*; *Desk layouts* (favourite graphics shown first on the desk) are at the
  bottom. The old Control rooms and Producer board addresses open Live.
* **Stream links** (Live → *Stream links*) — for several matches streamed back to back from one ground. *New
  stream link*, give it a name (Court 1), choose the ground (and a competition if the ground is shared), and save.
  It gives two OBS links, both 1920×1080 Browser Sources, added once and the same every day:
  * the **stream link**, over your camera in your match scene, in place of each match's own OBS link. It shows, by
    itself:
    1. a match put on by hand (*Put on now* beside it, until *Back to automatic*);
    2. otherwise the match under way;
    3. otherwise the match just finished (its full time and thank-you) until 10 minutes before the next kick-off
       (*Move to the next match*, 0–120 minutes) or until the next match's scorer starts the run-down, whichever is
       first;
    4. otherwise the next match to come, or else the last one of the day.
  * the **intermission link**, in a scene of its own (for example *Intermission*, with no camera). It always shows
    the **intermission screen** over the animated background: the next match large, with its crests, kick-off time
    and *KICK-OFF IN* countdown, then today's matches with FT and the final score, the live score with the period,
    or the kick-off time. Results and live scores update while it is up (every 20 s), and once the next match's
    run-down starts it moves on to the match after. It is drawn in the next match's look.

  Between matches, after the thank-you, switch OBS to the intermission scene with whatever transition you use (the
  replay stinger works well), and back to the match scene before the next kick-off. Each match's own graphics
  follow its own scorer and automation; the stream link swaps between them without a gap or a flash (what comes
  next is drawn out of sight first). If you would rather not change scenes, *Edit → Also switch the stream link to
  the intermission by itself* (off by default) makes the stream link show the intermission a set number of minutes
  after full time, and *More → Show the intermission on the stream link now* puts it on by hand (*Back to automatic*
  ends it). The card shows whether OBS has the stream link open, what is on and why, and today's matches in order
  with their score or kick-off time; *Copy stream link* and *Copy intermission link* copy them again. The match-day
  checklist counts OBS as connected for each of today's matches on a stream link OBS has open. *Make new OBS links*
  stops both old links at once; *?mode=monitor* on a link adds a small label for checking it off air. The links only
  ever show graphics, so they need no streaming set-up.
* **Matches today** (a graphic in every look) — the day's matches in the same place in kick-off order: FT with
  the final score, the live score with the period, or the kick-off time, the match on this output highlighted, the
  competition at the end of the row. *The same place* is the stream link the match is on (its ground and
  competition), otherwise the match's ground, or its competition when it has no ground; the heading says which
  (*TODAY AT NORTHGATE ARENA*, *TODAY · NPL*), or type a title of your own. It updates while it is on air (every
  20 s). Up to eight matches show, centred on the one live or next. The **Intermission** graphic (the intermission
  link's screen, with a title and a message of your own) can also be sent from any match's desk.
* **Commentator view** (match page → *Commentator view*) — a read-only, large-type page for the commentary
  position: line-ups with what each player has done, key events, statistics, head-to-head, form, the table
  around both teams, officials and the run sheet. Text size and full screen are one tap away.
* **Match centre for fans** (match page → Overview) — a public link with the live score, events, line-ups,
  statistics and the table, plus a JSON feed for club websites. Create, rotate or switch it off at any time.
* **Activity** (match page → *Timeline*, under the event log) — one timeline in plain words: scoring, desk commands, graphics on and off air,
  set-up changes, with who did what.

## Season data

Competition → *Table*, *Fixtures and results* (*By round*, or *All matches* as a list) and *Players* show the league table (points for a win, draw, loss
and bye and the tiebreakers are set under *Table rules*; only regular-season matches count), every round with
scores (the finals after the regular season, shoot-outs shown as pens), and player totals across the season.

**Finals series** — Competition → *Finals*. Choose a format: *Top 2* (Grand Final), *Top 4* (semi-finals 1st v
4th and 2nd v 3rd, then the Grand Final), *Top 6* (elimination finals 3rd v 6th and 4th v 5th while 1st and 2nd
have the week off; 1st then meets the lower-placed winner) or *Top 8* (quarter-finals 1v8, 4v5, 2v7, 3v6, then
semi-finals and the Grand Final). The first round comes from the ladder (a warning shows while regular-season
matches are still to be played); give each match a kick-off and venue and press *Create*. Each next round is
offered as soon as every match of the last one has a winner (a level score is decided by extra time and
penalties), with the better-placed team at home. The matches are ordinary fixtures with an OBS link from the
start, and their graphics show the round beside the competition (*Coastal League · Grand Final*). A finals match
can also be added by hand (New match, Stage *Finals*). *Roll over* on an active season creates the next one, carries rosters forward and archives the old
season with its results and tables intact. The same table, fixtures and top scorers are available as graphics.

## Sponsors and reports

Sponsors → brands, creatives (images/videos from the asset library; approve before use), campaigns (flight,
priority, weight, caps, spacing, placements). Reports → *Sponsor delivery* shows confirmed on-air occurrences and
seconds per output, the evidence type (compositor pixels or render delivery) and per-destination status;
*Graphics on air* shows the same confirmed timing for every graphic, by graphic, match, sponsor artwork and
source. Neither shows audience numbers. Export CSV for partners (formula-safe).

## After the match

Videos → highlights are created automatically for goals/key events from the recorded programme once the
post-roll has been recorded (usually within ~30 s). *Edit* to trim, choose 16:9 / 9:16 / 1:1 with a crop
position and add intro/outro creatives, then download from Exports. *Share* creates an expiring link (revocable).
A corrected event marks its clip **stale** — review it before publishing.

### Highlights package from a video of the match

Match → *Media* → **Highlights** makes a highlights video (1920×1080 MP4) from a recording of the whole match and the
scorer's log, with this match's graphics. Football, futsal, hockey, rugby league and AFL; basketball and netball
score too often to pick moments from the log.

1. **Upload the video** (MP4, MOV, MKV or WebM, up to 40 GB): the recording from OBS, a camera or the stream. It
   goes up in parts; if the connection drops, choose the same file again and it carries on from where it stopped.
   A small preview is made once it is in.
2. **Mark the kick-off**: play the preview to the kick-off and press *Kick-off is here*, or type the time (*m:ss*
   or *h:mm:ss*). A period without its own mark follows the one before it (a recording that ran through half
   time); mark each half if the recording was stopped at the break. *Save kick-off times*.
3. **Check the moments.** Goals, tries and red cards always go in, each goal with a slow-motion replay; chances
   (shots on target, saves) fill the package to the length chosen. Untick a moment to leave it out, or move it by
   2 s if the scorer recorded it early or late; the play button shows it in the preview.
4. **Make the highlights.** Choose about how long, the title, the end board's message, the replay speed and which
   parts to show (title panel, scorebug, replay transition, full time, end board; turn the scorebug off when the
   video already shows one). The browser then draws the graphics — **keep the page open until it says the graphics
   are in** — and the media worker makes the video. It appears under *Highlights made* to download, share (a
   7-day link) or make a thumbnail for.

The package: the title panel over the first clip, the clips in match order with the scorebug (the score, clock and
red cards as they were at that moment), each goal's replay behind the replay transition with the goal strap (the
scorebug comes off for the replay), the red card strap with its clip, the final whistle with the full-time score,
and the end board. Clips are joined with short crossfades and keep the match sound.

**Title graphics for your edit.** Under the package, *Title graphics for your edit* has the title panel on its own
— *Match Highlights* and *Extended Match Highlights* (the title can be changed) — in this match's look, with the
competition, both teams, the round, the ground, and the date with the kick-off time. The rest of the frame is
see-through, so it lays over your footage in an editing program. Download it as a **MOV** (ProRes 4444 with
transparency: Premiere Pro, Final Cut Pro and DaVinci Resolve keep the see-through part), a **WebM** (VP9 with
transparency) or a transparent **PNG**; choose the size (1920×1080 or 1280×720), the frame rate of your edit and how
long it stays on screen (3–10 s) before it animates out. The video starts and ends clear, so it can go straight on
a track above the first clip. It is offered for every sport, including those without highlights packages. The
ground and kick-off time come from the match: change them there and the title follows.

### Thumbnails

Match → *Media* → **Thumbnails** has a thumbnail for each kind of video of the match — *Live stream*, *Highlights*,
*Extended highlights*, *Full match* and one with your own words (*MATCH REPLAY*, *GRAND FINAL*) — in this match's
look: the competition's logo, round, date and name across the top with the kind of video on a tag, and both teams
below on their colours with their crests and names. Download one as a PNG, or *Download all*; 1280×720 is
YouTube's size, 1920×1080 is also offered. *Show the score* puts the score between the crests (off by default, so
the thumbnail keeps the result back); the team names can be left off. They follow the crests, team colours, look
and wording you set, so upload crests and the competition's logo first. A made highlights package has its own
*Thumbnail* button (*Extended highlights* for one of 7 minutes or longer).

## Trying it out

*Start a demo match* (dashboard quick actions, or a competition page) creates a match between two of your teams
that scores itself through the real scoring path at the speed you choose. It is labelled *Demo* everywhere and
left out of tables and reports. Open the scorer, the desk and the OBS link to watch everything move.

## Common problems

See the failure runbooks in [`operations.md`](operations.md#failure-runbooks).
