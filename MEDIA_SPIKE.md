# Milestone 0 — media spike

Status: **PASS for the local single-session pipeline** (RTMP in → private room → custom programme
template with live-changing scorebug → HLS + local RTMP receiver + MP4 recording → clip).
Two-session capacity and 30-minute soak are measured separately (see A51 in `ACCEPTANCE_RESULTS.md`).

Run date: 2026-10-19, in the Claude Code cloud container (4 vCPU, 15 GiB RAM, Docker 29.8.2, cgroup v1,
no GPU). This is a development container, not reference production hardware.

## Pinned versions

| Component | Version | Image digest |
| --- | --- | --- |
| LiveKit server | v1.13.8 | `sha256:ad961c9b4b064298cc08d618d772671f7c783e036001388079fa813929cc357e` |
| LiveKit Ingress | v1.5.0 | `sha256:2e1d3fcf10bfaebddaea74dc8b965410cda6377ed154451361b86ab3a9ee9f99` |
| LiveKit Egress | v1.14.1 | `sha256:bf2b648b947349c3e9ff7aa8c718f00378d5c06af7624652a3653318e00333ce` |
| MediaMTX (test RTMP receiver) | 1.21.2 | `sha256:c7540465f868a02652118bea5a0daab12a29ac0f6cb8485abd535939ecddf886` |
| Redis | 7.4.6-alpine | `sha256:3b73847e72874be07e6657b129a94761662b79bc0f679273757d4218573b2a98` |
| `livekit-server-sdk` (Node) | 2.19.1 | pins `@livekit/protocol` 1.51.0 |
| `livekit-client` (template) | 2.22.4 | |
| FFmpeg (host) | 6.1.1 | |

Compatibility check: the server SDK 2.19.1 and protocol 1.51.0 expose the source-based
`StartEgress` request (`source = template | web | media`, `outputs[]`). Egress v1.14.1 accepted it and logged
`requestType: template, sourceType: EGRESS_SOURCE_TYPE_WEB`. **Chosen API: `StartEgress` with
`TemplateSource{customBaseUrl}`.** The legacy `StartRoomCompositeEgress` path remains in the spike as a
fallback but was not needed.

## Topology and ports (local profile, host networking)

| Service | Port(s) | Notes |
| --- | --- | --- |
| LiveKit HTTP/WS | 7880/tcp | Twirp API and client signalling |
| LiveKit RTC | 7881/tcp, 50000–50200/udp | `rtc.node_ip` must be a **non-loopback** interface address (see findings) |
| Ingress RTMP | 1935/tcp | `rtmp://<host>:1935/live/<streamKey>` |
| Ingress WHIP | 8085/tcp | not used in P0 |
| Ingress RTC | 51000–51200/udp | |
| Egress health | 9193/tcp | Chrome + GStreamer; needs `cap_add: SYS_ADMIN` |
| MediaMTX RTMP | 1936/tcp | publish requires `user=publisher&pass=…` |
| MediaMTX HLS/API | 8888, 9997/tcp | API restricted to loopback |
| Spike template/data server | 4100/tcp | host Node process |

Host networking is used because LiveKit RTC needs predictable UDP addressing; bridge networking requires
`node_ip`/port-range mapping and was not needed for the local profile.

## Reproduce

```bash
dockerd &                                  # only if the daemon is not already running
tests/media/gen-fixture.sh                 # 60 s 720p30 source with flash+beep markers
cd infra/media-spike
sed -i "s/node_ip: .*/node_ip: $(hostname -I | awk '{print $1}')/" config/livekit.yaml config/ingress.yaml
chmod 1777 out && docker compose up -d
pnpm build:template
node run-spike.ts                          # SPIKE_SECONDS=40 by default
python3 -I ../../tests/media/analyze_markers.py out/<room>/programme.mp4
```

## Observed result (run `spike-1792408575096`)

- Ingress created with generated stream key; FFmpeg published H.264/AAC; the room showed the input participant
  with one audio and one video track within 1.5 s.
- `StartEgress` → `EGRESS_STARTING` → `EGRESS_ACTIVE` 3.0 s after the request (the template signals `START_RECORDING` once the input video plays).
- Stop → `EGRESS_COMPLETE`. Webhooks received in order: `room_started, ingress_started, participant_joined,
  track_published×2, egress_started, participant_joined, egress_updated, participant_left, egress_updated,
  egress_ended, …, room_finished`.
- **MP4 recording**: H.264 1280×720 30 fps yuv420p + AAC 44.1 kHz stereo, 41.10 s, 3.2 Mb/s.
- **HLS**: 2 s TS segments, `index.m3u8` (EVENT) and `live.m3u8`, each segment carries
  `EXT-X-PROGRAM-DATE-TIME` (used as the capture anchor for timeline mapping).
- **RTMP receiver**: MediaMTX path `live/<room>` ready with `H264, MPEG-4 Audio`; its own recording probed
  41 s with identical marker results.
- **Pixels**: scorebug-region hashes differ at 3/13/23/33 s; the frame comparison
  (`docs/evidence/m0/programme-frames-3s-vs-33s.png`) shows the source video (burned timer, moving bars)
  under a scorebug that changed from `0 0 / 00:07` to `3 1 / 00:35` from the data endpoint.
- **Audio**: the 1 kHz marker beep is present once per second in the recording and the RTMP receiver
  (42 beeps / 42 flashes paired).
- **Clip**: `ffmpeg -ss 10 -i hls/index.m3u8 -t 8` re-encode → valid 8.008 s H.264/AAC MP4.

### A/V alignment (flash vs beep)

`tests/media/analyze_markers.py` (validated on the source: 60/60 pairs, 0 ms skew):

| File | Pairs | Median skew (audio − video) | Mean | Stdev | Min / max | Drift first→last quarter |
| --- | --- | --- | --- | --- | --- | --- |
| programme.mp4 | 42 | +78.7 ms | +91.3 ms | 137.9 ms | −393 / +439 ms | −37.8 ms |
| RTMP receiver copy | 42 | +79.0 ms | +91.7 ms | 137.8 ms | −392 / +439 ms | −38.1 ms |

Median skew is inside the 150 ms target, but individual beeps jitter by up to ±400 ms. Video flash spacing
is regular (1.000 s); audio onsets are irregular, which points at WebRTC audio jitter-buffer
time-stretching inside the egress Chrome capture under high CPU load (egress ~108 % CPU, ingress ~83 %
of one core each sample). **Not yet acceptable as a strict ≤150 ms absolute-skew pass**; tracked under A51.

### Resource sample (single 720p30 session, 10 s interval `docker stats`)

| Container | CPU | Memory |
| --- | --- | --- |
| egress | 108 % | 421 MiB |
| ingress | 83 % | 115 MiB |
| livekit | 5 % | 56 MiB |
| redis / sink | <3 % | <25 MiB |

Egress self-reported `avgCPU ≈ 0.2`, `maxCPU 1.5`, max memory 1.37 GB for its handler process.

## Findings that changed the configuration

1. `ingress.rtmp_base_url` must be set in the **LiveKit server** config, otherwise `CreateIngress` returns
   an empty URL and nothing publishes.
2. Ingress logs `max cost: 0` without an explicit `cpu_cost` block and rejects work; P0 sets
   `rtmp_cpu_cost: 1.0`. With 4 cores this gives a ceiling of one transcoding RTMP input per ingress
   instance — capacity is enforced in the app accordingly until measured otherwise.
3. `rtc.node_ip: 127.0.0.1` makes every browser peer connection fail (`could not establish pc connection`):
   loopback ICE candidates are excluded. Use a real interface address (docker0 `172.17.0.1` here).
4. Egress runs as uid 1001; the local file-output volume must be writable for that user.
5. The template is loaded with egress-supplied `url`, `token` and `layout` query parameters added to our
   own `customBaseUrl` query; our parameters are preserved.

## Open items carried forward

- S3/MinIO upload from egress (production path) — exercised in Milestone 5.
- Two concurrent 720p sessions and the 30-minute soak (A51).
- Audio jitter above the absolute-skew target (A51/A35 evidence).
- Sponsor video audio policies in the egress browser (A38).
