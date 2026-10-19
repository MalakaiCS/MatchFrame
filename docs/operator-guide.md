# Operator and producer guide

## Before the match

1. **Fixture** — Matches → open the fixture. Check teams, venue, kickoff (shown in the organisation timezone,
   stored in UTC) and the lineup snapshot. Lineups lock at kickoff; later roster changes never rewrite them.
2. **Graphics output** — Match → *Overlays* → *New overlay*. Each overlay is an independent output with its own
   mode, layers and production URL. Copy the **Production URL** into OBS as a Browser Source at 1920×1080
   (transparent; no custom CSS needed). Rotate the URL if it leaks — the old link stops immediately.
3. **Automation** — in the control room, *Automation queue & history* → choose a published game plan, or leave
   *No automation* to run manually. Rehearse a plan first: Automation → plan → *Rehearse* (isolated, nothing is
   sent to outputs, sponsors, streams or usage).
4. **Streaming (optional)** — Streams → *New input*; give the encoder the RTMP URL and key (reveal is audited;
   the transport is labelled unencrypted). On the match *Streams* tab add a **Programme** output (with graphics)
   and optionally a **Clean** output (no graphics), pick the input and preset, add up to three destinations
   (YouTube/Facebook/Twitch: paste the server URL and stream key from the platform) and *Start stream*.
   The state goes STARTING → WAITING_FOR_INPUT → LIVE only when the media provider reports the output active.

## In the control room

* **Preview vs To Air** — selecting a graphic and editing its fields changes only the preview. *To air* (F8)
  sends it; *Out* (F9) takes it out. The command list shows *requested → accepted → displayed*; *displayed* means
  the output renderer acknowledged the revision.
* **Auto / Manual** — Manual pauses automatic takes and cancels pending automatic cues; what is on air stays.
  Returning to Auto does not replay anything that happened meanwhile; the default scorebug is restored in play.
* **Emergency clear** — press and hold: every layer and the scorebug go out and automation is inhibited until
  you press *Resume*.
* **Priorities** — a goal (priority 1) interrupts a sponsor loop (priority 3); equal priorities queue in order;
  promotional items that lose priority are skipped and the reason appears in the automation history.
* **Programme monitor** — for cloud outputs the control room shows the *actual* programme from HLS with its
  latency label; the local preview is labelled Preview and is not proof of what went out.

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
