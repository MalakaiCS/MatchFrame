# Operator and producer guide

## Before the match

1. **Fixture** — Matches → open the fixture. Check teams, venue, kickoff (shown in the organisation timezone,
   stored in UTC) and the lineup snapshot. Lineups lock at kickoff; later roster changes never rewrite them.
2. **Match day checklist** — at the top of the match page: lineups entered, a look chosen, automation set, a
   scorer assigned, OBS connected. Each line has its action in place; *Copy OBS link* and *Send scorer link*
   (with a QR code) sit beside it. The dashboard shows the next match with the same three buttons.
3. **OBS link** — every match has one graphics output from the moment it is created. Match → *OBS link* →
   *Copy link*, then in OBS add a Browser Source at 1920×1080 (transparent; no custom CSS). The status turns
   green once OBS is showing the page. *Advanced → create a new link* if the link leaks; the old one stops at
   once. A second output (for example a clean feed) is under *More outputs*.
4. **Automation** — choose a published plan on the match (checklist) or as the competition default. Plans are
   edited in plain language under Automation (when it runs, which steps, how long); *Rehearse* plays the draft
   through the real graphics against a made-up match, with nothing sent to any output.
5. **Streaming (optional)** — Streams → *New input*; give the encoder the RTMP URL and key (reveal is audited;
   the transport is labelled unencrypted). On the match *Streams* tab add a **Programme** output (with graphics)
   and optionally a **Clean** output (no graphics), pick the input and preset, add up to three destinations
   (YouTube/Facebook/Twitch: paste the server URL and stream key from the platform) and *Start stream*.
   The state goes STARTING → WAITING_FOR_INPUT → LIVE only when the media provider reports the output active.

## In the control room

* **Preview vs To Air** — selecting a graphic and editing its fields changes only the preview. *To air* (F8)
  sends it; *Out* (F9) takes it out; the buttons stay pinned at the bottom of the form. *Sent from this desk*
  shows *requested → accepted → displayed*; *displayed* means OBS acknowledged the change. Press **?** for the
  shortcut list. *What happens next* tells you which graphics run when the scorer presses the next phase.
* **Auto / Manual** — Manual pauses automatic takes and cancels pending automatic cues; what is on air stays.
  Returning to Auto does not replay anything that happened meanwhile; the default scorebug is restored in play.
* **Emergency clear** — press and hold: every layer and the scorebug go out and automation is inhibited until
  you press *Resume*.
* **Priorities** — a goal (priority 1) interrupts a sponsor loop (priority 3); equal priorities queue in order;
  promotional items that lose priority are skipped and the reason appears in the automation history.
* **Programme monitor** — for cloud outputs the control room shows the *actual* programme from HLS with its
  latency label; the local preview is labelled Preview and is not proof of what went out.

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
half-time and full-time stats board (shots on target, shots off target, corners, fouls, offsides, yellow cards),
not as graphics of their own. Every graphic builds in parts and animates out; the scorebug's score, period and
added-time indicators animate when they change. Automation only acts in *Auto* mode.

## Sponsors and reports

Sponsors → brands, creatives (images/videos from the asset library; approve before use), campaigns (flight,
priority, weight, caps, spacing, placements). Reports → sponsor delivery shows confirmed on-air occurrences and
seconds per output, the evidence type (compositor pixels or render delivery) and per-destination status.
It never shows audience numbers. Export CSV for partners (formula-safe).

## After the match

Media → highlights are created automatically for goals/key events from the recorded programme once the
post-roll has been recorded (usually within ~30 s). *Edit* to trim, choose 16:9 / 9:16 / 1:1 with a crop
position and add intro/outro creatives, then download from Exports. *Share* creates an expiring link (revocable).
A corrected event marks its clip **stale** — review it before publishing.

## Common problems

See the failure runbooks in [`operations.md`](operations.md#failure-runbooks).
