#!/usr/bin/env python3
"""Quantitative media check for the generated test source.

The fixture flashes the whole frame white and emits a 1 kHz beep at the start of
every source second. For a recorded/composited file this reports:
  * video flash onsets (luma of a central region jumps above a threshold)
  * audio beep onsets (RMS of 5 ms windows rises above a threshold)
  * paired audio-minus-video skew statistics (ms)
Output is JSON so harnesses and ACCEPTANCE_RESULTS can cite it.
Usage: analyze_markers.py FILE [--region x:y:w:h]
"""
import json, struct, subprocess, sys, statistics


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels',
                          '-show_entries', 'format=duration', '-of', 'json', path], capture_output=True, check=True, text=True).stdout
    return json.loads(out)


def video_onsets(path, region):
    # Down-sample a region to 8x8 grey per frame; use frame pts from showinfo-free constant timestamps.
    cmd = ['ffmpeg', '-v', 'error', '-i', path, '-an', '-vf', f'crop={region},scale=8:8,format=gray',
           '-vsync', 'passthrough', '-f', 'rawvideo', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    ts = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', path],
                        capture_output=True, check=True, text=True).stdout.replace(',', ' ').split()
    n = len(raw) // 64
    onsets, prev = [], 0.0
    for i in range(min(n, len(ts))):
        y = sum(raw[i * 64:(i + 1) * 64]) / 64
        if y > 225 and prev <= 225:
            onsets.append(float(ts[i]))
        prev = y
    return onsets


def audio_onsets(path, rate=8000):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', str(rate), '-f', 's16le', '-'],
                         capture_output=True, check=True).stdout
    samples = struct.unpack(f'<{len(raw)//2}h', raw)
    win = rate // 200  # 5 ms
    onsets, prev_on, last = [], False, -10.0
    for i in range(0, len(samples) - win, win):
        rms = (sum(s * s for s in samples[i:i + win]) / win) ** 0.5
        on = rms > 3000
        t = i / rate
        if on and not prev_on and t - last > 0.5:
            onsets.append(t)
            last = t
        prev_on = on
    return onsets


def main():
    path = sys.argv[1]
    region = '200:200:860:300'
    if '--region' in sys.argv:
        region = sys.argv[sys.argv.index('--region') + 1]
    info = probe(path)
    v, a = video_onsets(path, region), audio_onsets(path)
    pairs = []
    for t in v:
        if a:
            near = min(a, key=lambda x: abs(x - t))
            if abs(near - t) < 0.5:
                pairs.append((near - t) * 1000)
    res = {'file': path, 'probe': info, 'videoFlashes': len(v), 'audioBeeps': len(a), 'pairs': len(pairs)}
    if pairs:
        res['avSkewMs'] = {'mean': round(statistics.mean(pairs), 1), 'median': round(statistics.median(pairs), 1),
                           'min': round(min(pairs), 1), 'max': round(max(pairs), 1), 'stdev': round(statistics.pstdev(pairs), 1)}
        first, last = pairs[: len(pairs) // 4 or 1], pairs[-(len(pairs) // 4 or 1):]
        res['driftMs'] = round(statistics.mean(last) - statistics.mean(first), 1)
    res['firstVideoOnsets'] = [round(x, 3) for x in v[:5]]
    res['firstAudioOnsets'] = [round(x, 3) for x in a[:5]]
    print(json.dumps(res, indent=2))


if __name__ == '__main__':
    main()
