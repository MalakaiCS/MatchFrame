import type { NextConfig } from 'next';
import path from 'node:path';
import fs from 'node:fs';

// Load the repository .env for server-side values (never exposed to the client bundle unless NEXT_PUBLIC_*).
const root = path.resolve(process.cwd(), '../..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/\s+#.*$/, '').replace(/^"(.*)"$/, '$1');
  }
}
const apiInternal = process.env.INTERNAL_API_URL ?? 'http://127.0.0.1:4000';

const adminCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  `connect-src 'self' ${process.env.PUBLIC_REALTIME_URL ?? ''} ${(process.env.PUBLIC_REALTIME_URL ?? '').replace(/^http/, 'ws')} ${process.env.PUBLIC_LIVEKIT_URL ?? ''}`,
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  devIndicators: false,
  poweredByHeader: false,
  // capability tokens travel in renderer/egress URLs: never write those requests to logs
  logging: { incomingRequests: { ignore: [/^\/render\//, /^\/overlay\//, /^\/embed\//, /^\/watch\//] } },
  transpilePackages: ['@bs/domain', '@bs/graphics', '@bs/ui'],
  env: {
    NEXT_PUBLIC_REALTIME_URL: process.env.PUBLIC_REALTIME_URL ?? 'http://localhost:4000',
    NEXT_PUBLIC_LIVEKIT_URL: process.env.PUBLIC_LIVEKIT_URL ?? 'ws://localhost:7880',
    NEXT_PUBLIC_PRODUCT_NAME: process.env.PRODUCT_NAME ?? 'MatchFrame',
    NEXT_PUBLIC_RTMP_URL: process.env.PUBLIC_RTMP_URL ?? '',
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternal}/api/:path*` }];
  },
  async headers() {
    return [
      { source: '/((?!overlay|render|embed).*)', headers: [{ key: 'Content-Security-Policy', value: adminCsp }, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Referrer-Policy', value: 'no-referrer' }] },
      // Production overlays / egress template: embeddable by OBS/browser sources, never leak the URL token.
      { source: '/overlay/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }, { key: 'X-Robots-Tag', value: 'noindex' }] },
      { source: '/render/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }, { key: 'X-Robots-Tag', value: 'noindex' }] },
      { source: '/embed/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Content-Security-Policy', value: "frame-ancestors *" }] },
    ];
  },
};

export default nextConfig;
