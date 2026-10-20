// Server-side configuration. Loads the repository .env (with ${VAR} interpolation) without overriding
// variables already present in the process environment, then validates with zod.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  return start;
}

export function parseEnvText(text: string, base: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (!/^["']/.test(val)) val = val.replace(/\s+#.*$/, '');
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k: string) => base[k] ?? out[k] ?? '');
  }
  return out;
}

let loaded = false;
export function loadDotEnv(): void {
  if (loaded) return;
  loaded = true;
  const root = findRoot(process.cwd());
  const file = process.env.BS_ENV_FILE ?? path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  const parsed = parseEnvText(fs.readFileSync(file, 'utf8'), process.env);
  for (const [k, v] of Object.entries(parsed)) if (process.env[k] === undefined) process.env[k] = v;
}

const bool = z.union([z.boolean(), z.string()]).transform((v) => v === true || v === 'true' || v === '1');
const int = (d: number) => z.coerce.number().int().default(d);

export const configSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PRODUCT_NAME: z.string().default('Broadcast Studio'),
  PRODUCT_SHORT_NAME: z.string().default('Studio'),
  DEFAULT_LOCALE: z.string().default('en-AU'),
  DEFAULT_TIMEZONE: z.string().default('Australia/Brisbane'),
  PUBLIC_WEB_URL: z.string().url(),
  PUBLIC_API_URL: z.string().url(),
  PUBLIC_REALTIME_URL: z.string().url(),
  PUBLIC_LIVEKIT_URL: z.string().default(''),
  PUBLIC_RTMP_URL: z.string().default(''),
  INTERNAL_API_URL: z.string().url().default('http://127.0.0.1:4000'),
  INTERNAL_RENDER_BASE_URL: z.string().url().default('http://127.0.0.1:3000'),
  INTERNAL_LIVEKIT_HTTP: z.string().url().default('http://127.0.0.1:7880'),
  INTERNAL_LIVEKIT_WS: z.string().default('ws://127.0.0.1:7880'),
  API_PORT: int(4000),
  TRUSTED_ORIGINS: z.string().default(''),
  DATABASE_URL: z.string(),
  DATABASE_WORKER_URL: z.string(),
  DATABASE_ADMIN_URL: z.string().optional(),
  DB_APP_PASSWORD: z.string().optional(),
  DB_WORKER_PASSWORD: z.string().optional(),
  REDIS_URL: z.string(),
  BETTER_AUTH_SECRET: z.string().min(16),
  SESSION_MAX_AGE_DAYS: int(14),
  AUTH_LOG_EMAIL_LINKS: bool.default(false),
  SMTP_HOST: z.string().default('127.0.0.1'),
  SMTP_PORT: int(1025),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Broadcast Studio <no-reply@studio.localhost>'),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_FORCE_PATH_STYLE: bool.default(true),
  ENCRYPTION_KEY: z.string().min(40),
  MEDIA_TOKEN_SECRET: z.string().min(16),
  // false = graphics-only deployment: no LiveKit, no stream inputs/outputs, recordings or live highlights.
  STREAMING_ENABLED: bool.default(true),
  LIVEKIT_API_KEY: z.string().default(''),
  LIVEKIT_API_SECRET: z.string().default(''),
  MEDIA_PROVIDER: z.enum(['livekit', 'fake']).default('livekit'),
  MAX_CONCURRENT_PROGRAMMES: int(1),
  MAX_DESTINATIONS_PER_OUTPUT: int(3),
  ENABLE_1080P_PRESETS: bool.default(false),
  INPUT_WAIT_TIMEOUT_SECONDS: int(120),
  UPLOAD_MAX_BYTES: int(524_288_000),
  UPLOAD_MAX_IMAGE_PIXELS: int(25_000_000),
  UPLOAD_MAX_VIDEO_SECONDS: int(600),
  RECORDING_RETENTION_DAYS: int(90),
  EXPORT_RETENTION_DAYS: int(30),
  LIVE_EVENT_FRESHNESS_MS: int(10_000),
  DEV_DESTINATION_ALLOWLIST: z.string().default(''),
  RTMP_SINK_PASSWORD: z.string().optional(),
  MEDIA_TMP_DIR: z.string().optional(),
}).superRefine((c, ctx) => {
  if (c.STREAMING_ENABLED && c.MEDIA_PROVIDER === 'livekit' && !c.LIVEKIT_API_SECRET)
    ctx.addIssue({ code: 'custom', path: ['LIVEKIT_API_SECRET'], message: 'required while STREAMING_ENABLED=true' });
});

export type AppConfig = z.infer<typeof configSchema>;

let cached: AppConfig | null = null;
export function getConfig(): AppConfig {
  if (cached) return cached;
  loadDotEnv();
  const r = configSchema.safeParse(withDerivedDefaults(process.env));
  if (!r.success) {
    const missing = r.error.issues.filter((i) => process.env[i.path.join('.')] === undefined).map((i) => i.path.join('.'));
    const invalid = r.error.issues
      .filter((i) => !missing.includes(i.path.join('.')))
      .map((i) => {
        const v = process.env[i.path.join('.')] ?? '';
        const why = i.code === 'too_small' ? `${v.length} characters, needs at least ${String(i.minimum)}` : i.message;
        return `${i.path.join('.')} (${/^(\.\.\.|__GENERATE__)$/.test(v) ? 'still a placeholder' : why})`;
      });
    const parts = [missing.length && `missing: ${missing.join(', ')}`, invalid.length && `invalid: ${invalid.join(', ')}`];
    const hint = missing.includes('PUBLIC_WEB_URL')
      ? ' PUBLIC_WEB_URL comes from the platform domain (Railway: Settings → Networking → Generate domain) or set it.'
      : '';
    throw new Error(
      `Invalid configuration (${parts.filter(Boolean).join('; ')}).${hint} Locally run \`pnpm setup\`; ` +
        'on a hosting platform set these as service variables (docs/deploy-hosted.md).',
    );
  }
  // the web origin is always trusted (auth CSRF checks and Socket.IO CORS)
  const origins = new Set(r.data.TRUSTED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean));
  origins.add(new URL(r.data.PUBLIC_WEB_URL).origin);
  cached = { ...r.data, TRUSTED_ORIGINS: [...origins].join(',') };
  return cached;
}

/**
 * Single-origin deployments (hosted platforms) only need PUBLIC_WEB_URL: the API and realtime endpoints default
 * to the same origin. Railway and Render expose the service's public address, which seeds PUBLIC_WEB_URL.
 */
export function withDerivedDefaults(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out = { ...env };
  const platformUrl = env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : env.RENDER_EXTERNAL_URL;
  out.PUBLIC_WEB_URL ||= platformUrl;
  out.PUBLIC_API_URL ||= out.PUBLIC_WEB_URL;
  out.PUBLIC_REALTIME_URL ||= out.PUBLIC_WEB_URL;
  const roles = roleDatabaseUrls(env);
  if (roles) {
    out.DATABASE_URL = roles.app.url;
    out.DATABASE_WORKER_URL = roles.worker.url;
  }
  return out;
}

/**
 * Connection URLs and passwords for the least-privilege roles bs_app and bs_worker, as created by the migration.
 * Each role's password is DB_*_PASSWORD, else the one inside its connection URL, else derived from the admin
 * password (HMAC), so a hosted deploy needs only DATABASE_ADMIN_URL. A missing URL is the admin URL with the
 * role's user. Null without DATABASE_ADMIN_URL (the app processes then use their URLs as given).
 */
export function roleDatabaseUrls(env: Record<string, string | undefined>) {
  if (!env.DATABASE_ADMIN_URL) return null;
  let admin: URL;
  try {
    admin = new URL(env.DATABASE_ADMIN_URL);
  } catch {
    return null;
  }
  const role = (user: string, urlVar: string, pwVar: string) => {
    let url: URL;
    try {
      url = new URL(env[urlVar] || admin.href);
    } catch {
      url = new URL(admin.href);
    }
    if (!env[urlVar] || url.href === admin.href) {
      url.username = user;
      url.password = '';
    }
    const password =
      env[pwVar] ||
      decodeURIComponent(url.password) ||
      crypto.createHmac('sha256', decodeURIComponent(admin.password)).update(`broadcast-studio:${user}`).digest('base64url');
    url.password = encodeURIComponent(password);
    return { url: url.href, password };
  };
  return {
    app: role('bs_app', 'DATABASE_URL', 'DB_APP_PASSWORD'),
    worker: role('bs_worker', 'DATABASE_WORKER_URL', 'DB_WORKER_PASSWORD'),
  };
}

export const isProduction = () => process.env.NODE_ENV === 'production';
