// Streaming lifecycle rules against real PostgreSQL with the deterministic fake provider (labelled demo).
// Real media behaviour (pixels/audio) is covered separately by tests/media against LiveKit.
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { broadcastSessions, createDb, destinations, recordings, withTenant } from '@bs/db';
import { createFakeProvider } from '@bs/media';
import { catalog, matchesSvc, mediaControl, streamsSvc, type Ctx } from '@bs/services';
import { makeOrg, testDeps } from '../helpers';

const deps = testDeps();
const worker = createDb(deps.config.DATABASE_WORKER_URL, { max: 4 });
const fake = createFakeProvider();
let A: Awaited<ReturnType<typeof makeOrg>>;
let B: Awaited<ReturnType<typeof makeOrg>>;
let ctx: Ctx;
const D = () => ({ db: worker.db, config: { ...deps.config, MAX_CONCURRENT_PROGRAMMES: 4 }, media: fake, inputWaitMs: 60_000 });

async function newMatch(c: Ctx) {
  const comp = await catalog.createCompetition(c, { name: `Stream League ${crypto.randomUUID().slice(0, 4)}`, sport: 'football', defaultTimezone: 'Australia/Brisbane' });
  const season = await catalog.createSeason(c, comp.id, { name: '2026' });
  const h = await catalog.createTeam(c, { name: 'Harbour City FC', shortName: 'Harbour', abbreviation: 'HCF', sport: 'football' });
  const a = await catalog.createTeam(c, { name: 'Ridgeback United', shortName: 'Ridge', abbreviation: 'RBU', sport: 'football' });
  return matchesSvc.createMatch(c, { competitionId: comp.id, seasonId: season.id, homeTeamId: h.id, awayTeamId: a.id, kickoffLocal: '2026-11-07 15:00', timezone: 'Australia/Brisbane' });
}

async function setupOutputs(c: Ctx, inputId: string) {
  const m = await newMatch(c);
  const prog = await streamsSvc.saveOutput(c, m.id, { mode: 'PROGRAMME', inputId });
  const clean = await streamsSvc.saveOutput(c, m.id, { mode: 'CLEAN', inputId });
  return { m, prog, clean };
}
const ingressOf = (inputId: string) => [...fake.controls.inputs.entries()].find(([, v]) => v.identity === `input_${inputId}`)![0];

beforeAll(async () => {
  A = await makeOrg(deps, 'Streams A');
  B = await makeOrg(deps, 'Streams B');
  ctx = { ...A.ctx, media: fake, config: { ...deps.config, MAX_CONCURRENT_PROGRAMMES: 4 } };
});
afterAll(async () => {
  await worker.pool.end();
  await deps.close();
});

describe('destinations and secrets', () => {
  it('rejects unsafe destinations (A48) and never returns keys in lists (A53)', async () => {
    const input = await streamsSvc.createInput(ctx, { name: 'Cam 1' });
    expect(JSON.stringify(await streamsSvc.listInputs(ctx))).not.toContain((await streamsSvc.revealInputKey(ctx, input.id)).streamKey);
    const { prog } = await setupOutputs(ctx, input.id);
    for (const bad of ['http://example.com/live', 'rtmp://127.0.0.1/live', 'rtmp://10.1.2.3/app', 'rtmp://[::1]/x', 'rtmp://user:pw@example.com/live', 'rtmp://169.254.169.254/latest']) {
      await expect(streamsSvc.addDestination(ctx, prog.id, { name: 'x', serverUrl: bad, streamKey: 'k' })).rejects.toMatchObject({ status: 422 });
    }
    await expect(streamsSvc.checkDestinationUrl('rtmp://evil.example/live', '', async () => ['192.168.1.5'])).rejects.toMatchObject({ code: 'DESTINATION_BLOCKED' });
    expect((await streamsSvc.checkDestinationUrl('rtmp://127.0.0.1:1936/live', '127.0.0.1:1936')).allowlisted).toBe(true);
    const d = await streamsSvc.addDestination(ctx, prog.id, { name: 'Sink', serverUrl: 'rtmp://127.0.0.1:1936/live', streamKey: 'super-secret-key-123' });
    expect(JSON.stringify(d)).not.toContain('super-secret-key-123');
    const [row] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(destinations).where(eq(destinations.id, d.id)));
    expect(row!.streamKeyEnc).not.toContain('super-secret-key-123');
    await streamsSvc.addDestination(ctx, prog.id, { name: 'Sink 2', serverUrl: 'rtmp://127.0.0.1:1936/live', streamKey: 'k2' });
    await streamsSvc.addDestination(ctx, prog.id, { name: 'Sink 3', serverUrl: 'rtmp://127.0.0.1:1936/live', streamKey: 'k3' });
    await expect(streamsSvc.addDestination(ctx, prog.id, { name: 'Sink 4', serverUrl: 'rtmp://127.0.0.1:1936/live', streamKey: 'k4' })).rejects.toMatchObject({ code: 'DESTINATION_LIMIT' });
    const s = await streamsSvc.matchStreams(ctx, prog.matchId);
    expect(JSON.stringify(s)).not.toMatch(/k2|k3|super-secret/);
  });

  it('another tenant cannot read streams, keys or HLS (A03/A46)', async () => {
    const input = await streamsSvc.createInput(ctx, { name: 'Cam private' });
    const { m } = await setupOutputs(ctx, input.id);
    const bctx = { ...B.ctx, media: fake };
    await expect(streamsSvc.revealInputKey(bctx, input.id)).rejects.toMatchObject({ status: 404 });
    await expect(streamsSvc.matchStreams(bctx, m.id)).rejects.toMatchObject({ status: 404 });
    await streamsSvc.startSession(ctx, m.id);
    const st = await streamsSvc.matchStreams(ctx, m.id);
    const osId = st.outputs[0]!.session!.id;
    await expect(streamsSvc.hlsObjectKey(bctx, osId, 'live.m3u8')).rejects.toMatchObject({ status: 404 });
    await expect(streamsSvc.hlsObjectKey(ctx, osId, '../../secret')).rejects.toMatchObject({ status: 404 });
    expect(await streamsSvc.hlsObjectKey(ctx, osId, 'seg_00003.ts')).toContain(`org/${A.org.id}/live/${osId}/`);
    await streamsSvc.stopSession(ctx, m.id);
    await mediaControl.reconcileSession(D(), A.org.id, st.session!.id);
  });
});

describe('session lifecycle', () => {
  it('starts idempotently, waits for source, goes LIVE only from provider state, isolates a failed destination (A40/A41)', async () => {
    const input = await streamsSvc.createInput(ctx, { name: 'Cam lifecycle' });
    const { m, prog } = await setupOutputs(ctx, input.id);
    await streamsSvc.addDestination(ctx, prog.id, { name: 'Good', serverUrl: 'rtmp://127.0.0.1:1936/live', streamKey: 'good' });
    await streamsSvc.addDestination(ctx, prog.id, { name: 'Bad', serverUrl: 'rtmp://127.0.0.1:1936/live', streamKey: 'bad' });
    const r1 = await streamsSvc.startSession(ctx, m.id);
    const r2 = await streamsSvc.startSession(ctx, m.id);
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    expect(r2.session.id).toBe(r1.session.id);
    await mediaControl.startSessionJob(D(), A.org.id, r1.session.id);
    await mediaControl.startSessionJob(D(), A.org.id, r1.session.id); // duplicate job
    let st = await streamsSvc.matchStreams(ctx, m.id);
    expect(st.session!.state).toBe('WAITING_FOR_INPUT');
    expect(st.outputs.every((o) => o.session!.state === 'PENDING')).toBe(true);
    fake.controls.setPublishing(ingressOf(input.id), true);
    await mediaControl.reconcileSession(D(), A.org.id, r1.session.id);
    st = await streamsSvc.matchStreams(ctx, m.id);
    expect(st.session!.state).not.toBe('LIVE'); // egress requested but not yet active
    const egresses = [...fake.controls.outputs.entries()].filter(([, o]) => o.room === r1.session.roomName);
    expect(egresses).toHaveLength(2);
    const progEgress = egresses.find(([, o]) => o.rtmp.length === 2)!;
    expect(progEgress[1].rtmp[0]).toBe('rtmp://127.0.0.1:1936/live/good');
    for (const [id] of egresses) fake.controls.setOutputState(id, 'active');
    fake.controls.failStream(progEgress[0], 'rtmp://127.0.0.1:1936/live/bad');
    await mediaControl.reconcileSession(D(), A.org.id, r1.session.id);
    st = await streamsSvc.matchStreams(ctx, m.id);
    const p = st.outputs.find((o) => o.mode === 'PROGRAMME')!;
    expect(p.session!.state).toBe('LIVE');
    expect(p.destinations.find((d) => d.name === 'Good')!.lastStatus.status).toBe('active');
    expect(p.destinations.find((d) => d.name === 'Bad')!.lastStatus.status).toBe('failed');
    expect(st.session!.state).toBe('DEGRADED');
    expect(st.outputs.find((o) => o.mode === 'CLEAN')!.session!.state).toBe('LIVE');
    // duplicate provider webhooks are processed once
    const ev = { id: `EV_${crypto.randomUUID()}`, event: 'egress_updated', createdAt: Date.now(), roomName: r1.session.roomName, raw: {} };
    expect((await mediaControl.handleWebhook(D(), ev)).duplicate).toBe(false);
    expect((await mediaControl.handleWebhook(D(), ev)).duplicate).toBe(true);
    // input loss → DEGRADED with holding slate; recovery → LIVE (bad destination aside)
    fake.controls.setPublishing(ingressOf(input.id), false);
    await mediaControl.reconcileSession(D(), A.org.id, r1.session.id);
    st = await streamsSvc.matchStreams(ctx, m.id);
    expect(st.session).toMatchObject({ state: 'DEGRADED', error: { code: 'INPUT_LOST' } });
    fake.controls.setPublishing(ingressOf(input.id), true);
    // stop: outputs end, recordings finalise, capacity and input are released, room deleted
    await streamsSvc.stopSession(ctx, m.id);
    expect(await mediaControl.reconcileSession(D(), A.org.id, r1.session.id)).toBe('STOPPING'); // stop requested, provider still finishing
    expect(await mediaControl.reconcileSession(D(), A.org.id, r1.session.id)).toBe('STOPPED');
    st = await streamsSvc.matchStreams(ctx, m.id);
    expect(st.session!.state).toBe('STOPPED');
    expect(fake.controls.rooms.has(r1.session.roomName)).toBe(false);
    const recs = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(recordings).where(eq(recordings.matchId, m.id)));
    expect(recs.map((x) => x.state).sort()).toEqual(['READY', 'READY']);
    const ins = await streamsSvc.listInputs(ctx);
    expect(ins.find((i) => i.id === input.id)!.boundSessionId).toBeNull();
  });

  it('one input cannot be routed into two match rooms; capacity is enforced', async () => {
    const input = await streamsSvc.createInput(ctx, { name: 'Shared cam' });
    const a = await setupOutputs(ctx, input.id);
    const b = await setupOutputs(ctx, input.id);
    const s = await streamsSvc.startSession(ctx, a.m.id);
    await expect(streamsSvc.startSession(ctx, b.m.id)).rejects.toMatchObject({ code: 'INPUT_IN_USE' });
    const other = await streamsSvc.createInput(ctx, { name: 'Other cam' });
    const c = await setupOutputs(ctx, other.id);
    const tight = { ...ctx, config: { ...ctx.config, MAX_CONCURRENT_PROGRAMMES: 1 } };
    await expect(streamsSvc.startSession(tight, c.m.id)).rejects.toMatchObject({ code: 'CAPACITY_REACHED' });
    // the refused start left no binding behind
    expect((await streamsSvc.listInputs(ctx)).find((i) => i.id === other.id)!.boundSessionId).toBeNull();
    await streamsSvc.stopSession(ctx, a.m.id);
    await mediaControl.reconcileSession(D(), A.org.id, s.session.id);
  });

  it('a stale scheduled start for an older fixture version is refused (A41)', async () => {
    const input = await streamsSvc.createInput(ctx, { name: 'Sched cam' });
    const { m, prog } = await setupOutputs(ctx, input.id);
    const v1 = prog.scheduleVersion;
    await streamsSvc.saveOutput(ctx, m.id, { mode: 'PROGRAMME', inputId: input.id, autoSchedule: true });
    await expect(streamsSvc.startSession(ctx, m.id, { outputIds: [prog.id], scheduleVersion: v1, scheduled: true })).rejects.toMatchObject({ code: 'STALE_SCHEDULE' });
  });

  it('fails a session with no source after the bounded wait and releases everything', async () => {
    const input = await streamsSvc.createInput(ctx, { name: 'Silent cam' });
    const { m } = await setupOutputs(ctx, input.id);
    const s = await streamsSvc.startSession(ctx, m.id);
    await mediaControl.startSessionJob({ ...D(), inputWaitMs: 0, now: () => Date.now() + 1000 }, A.org.id, s.session.id);
    await mediaControl.reconcileSession({ ...D(), inputWaitMs: 0, now: () => Date.now() + 1000 }, A.org.id, s.session.id);
    const [row] = await withTenant(deps.db, { organisationId: A.org.id }, (t) => t.select().from(broadcastSessions).where(eq(broadcastSessions.id, s.session.id)));
    expect(row).toMatchObject({ state: 'FAILED', error: { code: 'NO_INPUT' } });
    expect((await streamsSvc.listInputs(ctx)).find((i) => i.id === input.id)!.boundSessionId).toBeNull();
  });

  it('after a restart, unknown provider outputs in our rooms are stopped (A50)', async () => {
    const input = await streamsSvc.createInput(ctx, { name: 'Restart cam' });
    const { m } = await setupOutputs(ctx, input.id);
    const s = await streamsSvc.startSession(ctx, m.id);
    await mediaControl.startSessionJob(D(), A.org.id, s.session.id);
    const rogue = await fake.startOutput({ roomName: s.session.roomName, templateUrl: 'x', preset: '720p30', rtmp: [] });
    fake.controls.setOutputState(rogue.providerId, 'active');
    expect(await mediaControl.reconcileOrphans(D())).toBeGreaterThanOrEqual(1);
    expect((await fake.outputStatus(rogue.providerId)).state).toBe('complete');
    await streamsSvc.stopSession(ctx, m.id);
    await mediaControl.reconcileSession(D(), A.org.id, s.session.id);
  });
});
