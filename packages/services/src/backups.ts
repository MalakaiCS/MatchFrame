// Scheduled database backups: pg_dump (custom format) to the object store, with a retention count and a record
// of every run. Restore: `pg_restore --clean --if-exists -d "$DATABASE_ADMIN_URL" backup.dump`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { backupRuns, type Db } from '@bs/db';
import type { AppConfig } from '@bs/config';
import type { Storage } from './storage';
import { assertCan } from './authz';
import type { Ctx } from './context';

export interface BackupDeps {
  db: Db;
  config: AppConfig;
  storage?: Storage;
}

const PREFIX = 'backups/';

function pgDump(databaseUrl: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', out, databaseUrl], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => (err += String(c)));
    p.on('error', (e) => reject(new Error(`pg_dump could not start: ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump exited ${code}: ${err.slice(-400)}`))));
  });
}

/** Run one backup now. Returns the stored object key. */
export async function runBackup(d: BackupDeps): Promise<{ id: string; location: string | null; bytes: number | null; error: string | null }> {
  const [row] = await d.db.insert(backupRuns).values({ status: 'running' }).returning();
  const dir = fs.mkdtempSync(path.join(d.config.MEDIA_TMP_DIR ?? os.tmpdir(), 'bs-backup-'));
  const file = path.join(dir, 'db.dump');
  try {
    if (!d.storage) throw new Error('object storage is not configured');
    const url = d.config.DATABASE_ADMIN_URL ?? d.config.DATABASE_WORKER_URL;
    await pgDump(url, file);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `${PREFIX}${stamp}.dump`;
    const bytes = await d.storage.putFile(key, file, 'application/octet-stream');
    await d.db.update(backupRuns).set({ status: 'ok', location: key, bytes, finishedAt: new Date() }).where(eq(backupRuns.id, row!.id));
    await prune(d);
    return { id: row!.id, location: key, bytes, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await d.db.update(backupRuns).set({ status: 'failed', error: error.slice(0, 500), finishedAt: new Date() }).where(eq(backupRuns.id, row!.id));
    return { id: row!.id, location: null, bytes: null, error };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function prune(d: BackupDeps) {
  const ok = await d.db.select().from(backupRuns).where(eq(backupRuns.status, 'ok')).orderBy(desc(backupRuns.startedAt));
  for (const old of ok.slice(d.config.BACKUP_KEEP)) {
    if (old.location && d.storage) await d.storage.delete?.(old.location).catch(() => undefined);
    await d.db.update(backupRuns).set({ status: 'pruned' }).where(eq(backupRuns.id, old.id));
  }
}

/** Worker loop: run when enabled and the last successful run is older than the configured interval. */
export async function backupTick(d: BackupDeps) {
  if (!d.config.BACKUP_ENABLED) return false;
  const [last] = await d.db.select().from(backupRuns).where(eq(backupRuns.status, 'ok')).orderBy(desc(backupRuns.startedAt)).limit(1);
  const [running] = await d.db.select().from(backupRuns).where(eq(backupRuns.status, 'running')).limit(1);
  if (running && Date.now() - running.startedAt.getTime() < 2 * 3600_000) return false;
  if (last && Date.now() - last.startedAt.getTime() < d.config.BACKUP_EVERY_HOURS * 3600_000) return false;
  await runBackup(d);
  return true;
}

/** Owners see the run history; the dumps themselves stay in the object store. */
export async function listBackups(ctx: Ctx) {
  assertCan(ctx.actor, 'org.own');
  const rows = await ctx.db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(30);
  return { enabled: ctx.config.BACKUP_ENABLED, everyHours: ctx.config.BACKUP_EVERY_HOURS, keep: ctx.config.BACKUP_KEEP, runs: rows };
}
