// Who is in each control room and which layers they are preparing. In-process (one API instance per
// installation); entries expire on their own so a dropped tab never leaves a stale lock.
export interface PresenceUser { userId: string; name: string; since: number }
export interface LayerLock { layer: string; userId: string; name: string; until: number }

const rooms = new Map<string, Map<string, PresenceUser & { socketId: string }>>(); // overlayId → socketId → user
const locks = new Map<string, Map<string, LayerLock>>(); // overlayId → layer → lock

export function join(overlayId: string, socketId: string, user: Omit<PresenceUser, 'since'>) {
  const r = rooms.get(overlayId) ?? new Map();
  r.set(socketId, { ...user, since: Date.now(), socketId });
  rooms.set(overlayId, r);
}
export function leave(overlayId: string, socketId: string) {
  rooms.get(overlayId)?.delete(socketId);
}
export function leaveAll(socketId: string): string[] {
  const touched: string[] = [];
  for (const [overlayId, r] of rooms) if (r.delete(socketId)) touched.push(overlayId);
  return touched;
}

export function snapshot(overlayId: string): { users: PresenceUser[]; locks: LayerLock[] } {
  const seen = new Map<string, PresenceUser>();
  for (const u of rooms.get(overlayId)?.values() ?? []) if (!seen.has(u.userId)) seen.set(u.userId, { userId: u.userId, name: u.name, since: u.since });
  const now = Date.now();
  const ls = locks.get(overlayId);
  if (ls) for (const [layer, l] of ls) if (l.until <= now) ls.delete(layer);
  return { users: [...seen.values()], locks: [...(ls?.values() ?? [])] };
}

/** Take or refresh a layer lock. Returns the holder when someone else has it. */
export function lock(overlayId: string, layer: string, user: { userId: string; name: string }, ttlMs = 20_000): { ok: true; lock: LayerLock } | { ok: false; holder: LayerLock } {
  const ls = locks.get(overlayId) ?? new Map<string, LayerLock>();
  locks.set(overlayId, ls);
  const cur = ls.get(layer);
  if (cur && cur.until > Date.now() && cur.userId !== user.userId) return { ok: false, holder: cur };
  const l = { layer, userId: user.userId, name: user.name, until: Date.now() + ttlMs };
  ls.set(layer, l);
  return { ok: true, lock: l };
}
export function unlock(overlayId: string, layer: string, userId: string) {
  const cur = locks.get(overlayId)?.get(layer);
  if (cur && cur.userId === userId) locks.get(overlayId)!.delete(layer);
}
/** The lock another operator holds on this layer right now, if any. */
export function heldByOther(overlayId: string, layer: string, userId: string | null): LayerLock | null {
  const cur = locks.get(overlayId)?.get(layer);
  return cur && cur.until > Date.now() && cur.userId !== userId ? cur : null;
}
