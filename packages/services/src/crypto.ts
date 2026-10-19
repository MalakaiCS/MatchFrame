import crypto from 'node:crypto';

/** AES-256-GCM for recoverable secrets (stream keys, webhook secrets). Format: v1.<iv>.<tag>.<ciphertext> */
export function encryptSecret(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (base64)');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(blob: string, keyB64: string): string {
  const [v, iv, tag, data] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const hmac = (secret: string, s: string) => crypto.createHmac('sha256', secret).update(s).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Canonical JSON (sorted keys, no undefined) for semantic intent hashing. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;
}

export const intentHash = (type: string, payload: unknown) => sha256(`${type}\n${canonicalJson(payload)}`);

/** Signed, expiring, narrowly scoped token: base64url(json).sig */
export function signToken(secret: string, claims: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${hmac(secret, body)}`;
}

export function verifyToken<T extends Record<string, unknown>>(secret: string, token: string): (T & { exp: number }) | null {
  const [body, sig] = token.split('.');
  if (!body || !sig || !safeEqual(sig, hmac(secret, body))) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    if (typeof claims.exp !== 'number' || claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

export function publicId(prefix: string, bytes = 9): string {
  return `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`;
}

/** Redact secrets in strings destined for logs or error messages. */
export function redact(s: string): string {
  return s
    .replace(/(rtmps?:\/\/[^\s/]+\/[^\s/]+\/)[^\s?]+/gi, '$1[redacted]')
    .replace(/([?&](?:t|bt|s|token|key|access_token|pass|password|secret|bootstrap|sig)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(\/overlay\/)[A-Za-z0-9_-]{20,}/g, '$1[redacted]');
}
