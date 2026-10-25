// Shared typed API client (same-origin /api via rewrite or reverse proxy; cookies carry the session).
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public fields?: { field: string; message: string }[],
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
  fieldError(name: string) {
    return this.fields?.find((f) => f.field === name || f.field.endsWith(`.${name}`))?.message ?? null;
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path.startsWith('/') ? path : `/api/v1/${path}`, {
      credentials: 'include',
      ...rest,
      headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and retry.');
  }
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const e = (body as { error?: { code: string; message: string; requestId?: string; fields?: { field: string; message: string }[] } } | null)?.error;
    const be = body as { message?: string; code?: string } | null;
    throw new ApiError(res.status, e?.code ?? be?.code ?? `HTTP_${res.status}`, e?.message ?? be?.message ?? `Request failed (${res.status})`, e?.requestId ?? res.headers.get('x-request-id') ?? undefined, e?.fields, (e as Record<string, unknown>) ?? {});
  }
  return body as T;
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export const v1 = (p: string) => `/api/v1/${p.replace(/^\//, '')}`;

export const get = <T>(p: string) => api<T>(v1(p));
export const post = <T>(p: string, json?: unknown) => api<T>(v1(p), { method: 'POST', json: json ?? {} });
export const patch = <T>(p: string, json: unknown) => api<T>(v1(p), { method: 'PATCH', json });
export const put = <T>(p: string, json: unknown) => api<T>(v1(p), { method: 'PUT', json });
export const del = <T>(p: string) => api<T>(v1(p), { method: 'DELETE' });

export function uuid(): string {
  return crypto.randomUUID();
}
