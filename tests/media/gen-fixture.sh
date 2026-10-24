#!/usr/bin/env bash
# Generates the licence-free media validation source: timer, motion, colour bars,
# and a 100 ms white flash + 1 kHz beep at the start of every second (alignment markers).
set -euo pipefail
OUT="${1:-$(dirname "$0")/fixtures/test-source-720p30.mp4}"
DUR="${DUR:-60}"
mkdir -p "$(dirname "$OUT")"
FONT=$(fc-match -f '%{file}' 'DejaVu Sans:bold' 2>/dev/null || echo /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf)
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=30" \
  -f lavfi -i "aevalsrc='0.5*sin(2*PI*1000*t)*lt(mod(t\,1)\,0.1)':s=48000:c=stereo" \
  -t "$DUR" -filter_complex "[0:v]drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(mod(t,1),0.1)',drawtext=fontfile=$FONT:text='%{pts\:hms}':x=40:y=h-120:fontsize=72:fontcolor=yellow:box=1:boxcolor=black@0.7[v]" \
  -map "[v]" -map 1:a -c:v libx264 -preset veryfast -profile:v high -pix_fmt yuv420p -g 60 -b:v 2500k \
  -c:a aac -b:a 128k -ar 48000 "$OUT"
echo "$OUT"
