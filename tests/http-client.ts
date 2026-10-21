// An HTTP client for integration tests against the API in-process (Fastify inject), keeping its own cookies.
import type { AppBundle } from '../apps/api/src/app';

export class Client {
  cookies = new Map<string, string>();
  constructor(
    private bundle: () => AppBundle,
    private origin: string,
    /** e.g. x-forwarded-for, so each test account signs up from its own address (sign-up is rate limited) */
    private defaults: Record<string, string> = {},
  ) {}
  private header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async req(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const res = await this.bundle().app.inject({
      method,
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: { origin: this.origin, ...this.defaults, ...(this.cookies.size ? { cookie: this.header() } : {}), ...extraHeaders },
    });
    const sc = res.headers['set-cookie'];
    for (const c of Array.isArray(sc) ? sc : sc ? [sc] : []) {
      const [pair, ...attrs] = c.split(';');
      const [k, v] = pair!.split('=');
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
      if (expired || v === '') this.cookies.delete(k!.trim());
      else this.cookies.set(k!.trim(), v!);
    }
    let json: unknown = null;
    try {
      json = res.json();
    } catch {
      json = res.body;
    }
    return { status: res.statusCode, json: json as Record<string, unknown> & { error?: { code: string; message?: string } }, headers: res.headers };
  }
}
