// Demo seed: two organisations (isolation), football + basketball, fictional rosters, venues and fixtures.
// Owners are created with random passwords printed once; nothing shared or hardcoded.
import type { Sport } from '@bs/domain';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { users, type Db } from '@bs/db';
import type { AppConfig } from '@bs/config';
import { createAuth } from './auth';
import { resolveActor, type Ctx } from './context';
import * as orgs from './orgs';
import * as catalog from './catalog';
import * as matches from './matches';

const FIRST = ['Mia', 'Noah', 'Aria', 'Kai', 'Zoe', 'Liam', 'Isla', 'Leo', 'Ava', 'Finn', 'Maya', 'Eli', 'Ruby', 'Theo', 'Nina', 'Oscar', 'Léa', 'Mateo', 'Ana', 'Søren', 'Chloé', 'Tane', 'Aroha', 'Ngozi', 'Hiro', 'Priya', 'Jonas', 'Imogen'];
const LAST = ['Torres', 'Nguyen', 'Walker', 'Okafor', 'Haddad', 'Rossi', 'Kowalski', 'Ángel', 'Ó Briain', 'Fitzgerald-Montgomery', 'Ito', 'Mbeki', 'Larsen', 'Dubois', 'Patel', 'Ramírez', 'Te Huia', 'Volkov', 'Silva', 'Andersson', 'Kim', 'Moreau'];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export interface SeedResult {
  organisations: { id: string; name: string; owner: { email: string; password: string } }[];
}

export async function createVerifiedUser(db: Db, config: AppConfig, email: string, name: string, password?: string) {
  const auth = createAuth({ db, config, mailer: { send: async () => undefined } });
  const pw = password ?? crypto.randomBytes(12).toString('base64url');
  const existing = await db.select().from(users).where(eq(users.email, email));
  if (!existing.length) {
    const r = await auth.api.signUpEmail({ body: { email, password: pw, name } });
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, r.user.id));
    return { id: r.user.id, email, password: pw, created: true };
  }
  return { id: existing[0]!.id, email, password: '(unchanged — existing user)', created: false };
}

async function seedOrg(db: Db, config: AppConfig, label: string, ownerEmail: string, sports: Sport[], r: () => number, opts: { password?: string } = {}) {
  const owner = await createVerifiedUser(db, config, ownerEmail, `${label} Owner`, opts.password);
  const { organisation } = await orgs.createOrganisation({ db, config }, owner.id, { name: label, timezone: 'Australia/Brisbane' });
  const actor = (await resolveActor(db, owner.id, organisation.id))!;
  const ctx: Ctx = { db, config, actor };
  const venue1 = await catalog.createVenue(ctx, { name: 'Bayside Oval', address: '1 Esplanade, Bayside QLD', timezone: 'Australia/Brisbane' });
  const venue2 = await catalog.createVenue(ctx, { name: 'Northgate Arena', address: '40 Station Rd, Northgate QLD', timezone: 'Australia/Brisbane' });
  const name = () => `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
  const created: { sport: string; competitionId: string; matchIds: string[] }[] = [];

  for (const sport of sports) {
    const football = sport === 'football';
    const comp = await catalog.createCompetition(ctx, {
      name: football ? `${label.split(' ')[0]} Premier League` : `${label.split(' ')[0]} Basketball League`,
      shortName: football ? 'CPL' : 'MBL',
      sport,
      defaultTimezone: 'Australia/Brisbane',
    });
    const season = await catalog.createSeason(ctx, comp.id, { name: '2026', startsOn: '2026-02-01', endsOn: '2026-12-15' });
    const teamDefs = football
      ? [
          ['Harbour City FC', 'Harbour', 'HCF', '#1F6FEB', '#FFFFFF'],
          ['Ridgeback United', 'Ridgeback', 'RBU', '#E5484D', '#1A1A1A'],
          ['Saltmarsh Rovers Football & Sporting Club', 'Saltmarsh', 'SMR', '#2BB673', '#0B1220'],
          ['Northgate Wanderers', 'Northgate', 'NGW', '#F5A524', '#1C1C1C'],
        ]
      : [
          ['Bayside Breakers', 'Breakers', 'BAY', '#45D6E8', '#0B1220'],
          ['Metro Comets', 'Comets', 'COM', '#8E4EC6', '#FFFFFF'],
          ['Eastside Ironbarks', 'Ironbarks', 'EIB', '#D9822B', '#111111'],
          ['Riverside Kookaburras', 'Kookaburras', 'RKB', '#30A46C', '#FFFFFF'],
        ];
    const teams = [];
    for (const [n, s, a, p, c] of teamDefs) teams.push(await catalog.createTeam(ctx, { name: n!, shortName: s!, abbreviation: a!, sport, primaryColor: p!, secondaryColor: c! }));
    const perTeam = football ? 16 : 10;
    const positions = football ? ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW', 'GK', 'DF', 'MF', 'FW', 'MF'] : ['PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SG', 'SF', 'PF', 'C'];
    for (const t of teams) {
      for (let i = 0; i < perTeam; i++) {
        const nm = name();
        const p = await catalog.createPlayer(ctx, { displayName: nm, shortName: nm.split(' ').slice(-1)[0]!, defaultNumber: i + 1, position: positions[i] ?? null });
        await catalog.addToRoster(ctx, { playerId: p.id, teamId: t.id, seasonId: season.id, number: i + 1, position: positions[i] ?? null });
      }
    }
    const matchIds: string[] = [];
    const now = Date.now();
    const pairs: [number, number][] = [[0, 1], [2, 3], [0, 2], [1, 3], [3, 0], [1, 2]];
    for (const [k, [h, a]] of pairs.entries()) {
      const when = new Date(now + (k - 2) * 7 * 86_400_000);
      when.setUTCHours(football ? 5 : 9, 0, 0, 0);
      const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(when).replace(',', '');
      const m = await matches.createMatch(ctx, {
        competitionId: comp.id,
        seasonId: season.id,
        homeTeamId: teams[h]!.id,
        awayTeamId: teams[a]!.id,
        venueId: k % 2 ? venue2.id : venue1.id,
        round: `Round ${k + 1}`,
        externalId: `${football ? 'CPL' : 'MBL'}-2026-R${k + 1}`,
        kickoffLocal: local,
        timezone: 'Australia/Brisbane',
      });
      matchIds.push(m.id);
    }
    // labelled demo fixture: separate from real fixtures and reports
    const demo = await matches.createMatch(ctx, {
      competitionId: comp.id,
      seasonId: season.id,
      homeTeamId: teams[0]!.id,
      awayTeamId: teams[1]!.id,
      venueId: venue1.id,
      round: 'Demo',
      externalId: `${football ? 'CPL' : 'MBL'}-DEMO`,
      kickoffLocal: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now + 3600_000)).replace(',', ''),
      timezone: 'Australia/Brisbane',
      isDemo: true,
    });
    matchIds.push(demo.id);
    created.push({ sport, competitionId: comp.id, matchIds });
  }
  return { organisation, owner, ctx, created };
}

export type SeedHook = (org: Awaited<ReturnType<typeof seedOrg>>) => Promise<void>;

export async function seedDemo(db: Db, config: AppConfig, opts: { ownerEmailA: string; ownerEmailB: string; passwordA?: string; passwordB?: string; hooks?: SeedHook[] }): Promise<SeedResult> {
  const r = rng(20261019);
  const a = await seedOrg(db, config, 'Coastal Sports Media', opts.ownerEmailA, ['football', 'basketball'], r, { password: opts.passwordA });
  const b = await seedOrg(db, config, 'Valley Community Broadcasts', opts.ownerEmailB, ['football'], r, { password: opts.passwordB });
  for (const h of opts.hooks ?? []) {
    await h(a);
    await h(b);
  }
  return {
    organisations: [
      { id: a.organisation.id, name: a.organisation.name, owner: { email: a.owner.email, password: a.owner.password } },
      { id: b.organisation.id, name: b.organisation.name, owner: { email: b.owner.email, password: b.owner.password } },
    ],
  };
}
