// Share image for the public site: the MatchFrame mark, wordmark and tagline on deep navy.
import fs from 'node:fs';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { markSvg } from '@/components/site/brand';

export const alt = 'MatchFrame: Every game. Broadcast ready.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// the wordmark's face: Outfit ExtraBold (the share image is rendered once, at build time)
const outfit = () => fs.readFileSync(path.join(process.cwd(), 'node_modules/@fontsource/outfit/files/outfit-latin-800-normal.woff'));

export default function OgImage() {
  const mark = `data:image/svg+xml;base64,${Buffer.from(markSvg(false)).toString('base64')}`;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0A1020 0%, #0d1a3a 60%, #10245a 100%)', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          <img src={mark} width={190} height={176} alt="" />
          <div style={{ fontSize: 124, fontWeight: 800, letterSpacing: -3, fontFamily: 'Outfit' }}>MatchFrame</div>
        </div>
        <div style={{ marginTop: 28, fontSize: 44, display: 'flex', gap: 14 }}>
          <span>Every game.</span>
          <span style={{ color: '#00D2FF' }}>Broadcast ready.</span>
        </div>
        <div style={{ marginTop: 26, fontSize: 26, color: '#a7b4c8' }}>Live scoring · broadcast graphics · automation · sponsors</div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Outfit', data: outfit(), weight: 800, style: 'normal' }] },
  );
}
