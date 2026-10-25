// Tenant-owned tables. Every row carries organisation_id; high-risk relationships use composite
// (id, organisation_id) foreign keys so a row can never point at another tenant's entity.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './auth';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const created = () => ts('created_at').notNull().defaultNow();
const updated = () => ts('updated_at').notNull().defaultNow();
const pk = () => uuid('id').primaryKey().defaultRandom();
const org = () =>
  uuid('organisation_id')
    .notNull()
    .references((): AnyPgColumn => organisations.id, { onDelete: 'restrict' });

// ---------------------------------------------------------------- organisations & access
export const organisations = pgTable('organisations', {
  id: pk(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  locale: text('locale').notNull().default('en-AU'),
  timezone: text('timezone').notNull().default('Australia/Brisbane'),
  brandColor: text('brand_color'),
  logoAssetId: uuid('logo_asset_id'),
  status: text('status').notNull().default('active'), // active | suspended (by site staff) | deleted
  suspendedAt: ts('suspended_at'),
  suspendedReason: text('suspended_reason'),
  onboarding: jsonb('onboarding').$type<Record<string, unknown>>().notNull().default({}),
  /** white-label: a host that resolves to this organisation for public pages and overlays */
  customDomain: text('custom_domain').unique(),
  /** white-label branding for the operator app and public pages (product name, colours, logo) */
  branding: jsonb('branding').$type<Record<string, unknown>>().notNull().default({}),
  requireTwoFactor: boolean('require_two_factor').notNull().default(false),
  createdBy: text('created_by').references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
});

export const ROLES = ['owner', 'admin', 'producer', 'operator', 'scorer', 'club_manager', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const memberships = pgTable(
  'memberships',
  {
    id: pk(),
    organisationId: org(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<Role>().notNull(),
    status: text('status').notNull().default('active'), // active | revoked
    /** bumped on revoke/role change; sessions & sockets carry it to invalidate promptly */
    accessVersion: integer('access_version').notNull().default(1),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('memberships_user_org').on(t.organisationId, t.userId),
    unique('memberships_id_org').on(t.id, t.organisationId),
    check('memberships_role_chk', sql`${t.role} in ('owner','admin','producer','operator','scorer','club_manager','viewer')`),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: pk(),
    organisationId: org(),
    email: text('email').notNull(),
    role: text('role').$type<Role>().notNull(),
    scopeType: text('scope_type'), // competition | team | match | null
    scopeId: uuid('scope_id'),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    revokedAt: ts('revoked_at'),
    invitedBy: text('invited_by').references(() => users.id),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [check('invitations_role_chk', sql`${t.role} <> 'owner'`), index('invitations_org_idx').on(t.organisationId)],
);

export const permissionGrants = pgTable(
  'permission_grants',
  {
    id: pk(),
    organisationId: org(),
    membershipId: uuid('membership_id').notNull(),
    action: text('action').notNull(), // e.g. score, operate, media.edit, reports.read
    scopeType: text('scope_type').notNull(), // organisation | competition | team | match | overlay | output
    scopeId: uuid('scope_id'),
    expiresAt: ts('expires_at'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    foreignKey({ columns: [t.membershipId, t.organisationId], foreignColumns: [memberships.id, memberships.organisationId] }).onDelete('cascade'),
    index('grants_membership_idx').on(t.membershipId),
  ],
);

// ---------------------------------------------------------------- competitions & people
export const leagues = pgTable('leagues', {
  id: pk(),
  organisationId: org(),
  name: text('name').notNull(),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [unique('leagues_id_org').on(t.id, t.organisationId)]);

export const competitions = pgTable(
  'competitions',
  {
    id: pk(),
    organisationId: org(),
    leagueId: uuid('league_id'),
    name: text('name').notNull(),
    shortName: text('short_name'),
    sport: text('sport').notNull(),
    logoAssetId: uuid('logo_asset_id'),
    rulesVersion: text('rules_version').notNull(),
    rulesConfig: jsonb('rules_config').$type<Record<string, unknown>>().notNull(),
    defaultTimezone: text('default_timezone').notNull(),
    themeProfileId: uuid('theme_profile_id'),
    gamePlanVersionId: uuid('game_plan_version_id'),
    outputDefaults: jsonb('output_defaults').$type<Record<string, unknown>>().notNull().default({}),
    /** league table rules (points per result, tie-breakers); empty = the sport's default */
    standingsRules: jsonb('standings_rules').$type<Record<string, unknown>>().notNull().default({}),
    /** rules for finals matches; null = the competition's rules with a level score decided (extra time, penalties…) */
    finalsRulesConfig: jsonb('finals_rules_config').$type<Record<string, unknown>>(),
    status: text('status').notNull().default('active'), // active | archived
    createdBy: text('created_by'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('competitions_id_org').on(t.id, t.organisationId),
    foreignKey({ columns: [t.leagueId, t.organisationId], foreignColumns: [leagues.id, leagues.organisationId] }),
    check('competitions_sport_chk', sql`${t.sport} in ('football','basketball','netball','rugby_league','afl','hockey','futsal')`),
    index('competitions_org_idx').on(t.organisationId, t.status),
  ],
);

export const seasons = pgTable(
  'seasons',
  {
    id: pk(),
    organisationId: org(),
    competitionId: uuid('competition_id').notNull(),
    name: text('name').notNull(),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    status: text('status').notNull().default('active'), // active | archived
    archivedAt: ts('archived_at'),
    /** the season this one was rolled over from (teams and rosters copied) */
    rolledFromSeasonId: uuid('rolled_from_season_id'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('seasons_id_org').on(t.id, t.organisationId),
    unique('seasons_comp_name').on(t.competitionId, t.name),
    foreignKey({ columns: [t.competitionId, t.organisationId], foreignColumns: [competitions.id, competitions.organisationId] }),
  ],
);

export const clubs = pgTable('clubs', {
  id: pk(),
  organisationId: org(),
  name: text('name').notNull(),
  shortName: text('short_name'),
  logoAssetId: uuid('logo_asset_id'),
  status: text('status').notNull().default('active'),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [unique('clubs_id_org').on(t.id, t.organisationId)]);

export const teams = pgTable(
  'teams',
  {
    id: pk(),
    organisationId: org(),
    clubId: uuid('club_id'),
    name: text('name').notNull(),
    shortName: text('short_name').notNull(),
    abbreviation: text('abbreviation').notNull(),
    sport: text('sport').notNull(),
    logoAssetId: uuid('logo_asset_id'),
    primaryColor: text('primary_color').notNull().default('#3EA6FF'),
    secondaryColor: text('secondary_color').notNull().default('#0B1220'),
    awayPrimaryColor: text('away_primary_color'),
    awaySecondaryColor: text('away_secondary_color'),
    grade: text('grade'),
    /** saved starting lineup: { players: [{ playerId, number, position, starter, captain }], formation } */
    defaultLineup: jsonb('default_lineup').$type<Record<string, unknown>>(),
    status: text('status').notNull().default('active'), // active | archived
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('teams_id_org').on(t.id, t.organisationId),
    foreignKey({ columns: [t.clubId, t.organisationId], foreignColumns: [clubs.id, clubs.organisationId] }),
    check('teams_abbr_chk', sql`char_length(${t.abbreviation}) between 2 and 5`),
    index('teams_org_idx').on(t.organisationId, t.status),
  ],
);

export const players = pgTable(
  'players',
  {
    id: pk(),
    organisationId: org(),
    displayName: text('display_name').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    shortName: text('short_name'),
    defaultNumber: integer('default_number'),
    position: text('position'),
    photoAssetId: uuid('photo_asset_id'),
    /** private; never included in public graphics payloads */
    dateOfBirth: date('date_of_birth'),
    status: text('status').notNull().default('active'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [unique('players_id_org').on(t.id, t.organisationId), index('players_org_idx').on(t.organisationId)],
);

export const rosterMemberships = pgTable(
  'roster_memberships',
  {
    id: pk(),
    organisationId: org(),
    playerId: uuid('player_id').notNull(),
    teamId: uuid('team_id').notNull(),
    seasonId: uuid('season_id').notNull(),
    number: integer('number'),
    position: text('position'),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    status: text('status').notNull().default('active'), // active | left
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    foreignKey({ columns: [t.playerId, t.organisationId], foreignColumns: [players.id, players.organisationId] }),
    foreignKey({ columns: [t.teamId, t.organisationId], foreignColumns: [teams.id, teams.organisationId] }),
    foreignKey({ columns: [t.seasonId, t.organisationId], foreignColumns: [seasons.id, seasons.organisationId] }),
    index('roster_team_season_idx').on(t.teamId, t.seasonId),
  ],
);

export const venues = pgTable('venues', {
  id: pk(),
  organisationId: org(),
  name: text('name').notNull(),
  address: text('address'),
  timezone: text('timezone').notNull(),
  inputDefaults: jsonb('input_defaults').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').notNull().default('active'),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [unique('venues_id_org').on(t.id, t.organisationId)]);

// ---------------------------------------------------------------- matches & scoring
export const matches = pgTable(
  'matches',
  {
    id: pk(),
    organisationId: org(),
    competitionId: uuid('competition_id').notNull(),
    seasonId: uuid('season_id').notNull(),
    externalId: text('external_id'),
    round: text('round'),
    /** regular season (counts for the ladder) or finals (knockout, never in the ladder) */
    stage: text('stage').notNull().default('regular'),
    /** finals only: { format, week, slot, seeds: { home, away } } */
    bracket: jsonb('bracket').$type<Record<string, unknown>>(),
    homeTeamId: uuid('home_team_id').notNull(),
    awayTeamId: uuid('away_team_id').notNull(),
    venueId: uuid('venue_id'),
    scheduledAt: ts('scheduled_at').notNull(),
    timezone: text('timezone').notNull(),
    scheduleVersion: integer('schedule_version').notNull().default(1),
    sport: text('sport').notNull(),
    sportRulesVersion: text('sport_rules_version').notNull(),
    rulesConfig: jsonb('rules_config').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('scheduled'), // scheduled | live | completed | postponed | cancelled | abandoned | archived
    isDemo: boolean('is_demo').notNull().default(false),
    themeProfileVersion: jsonb('theme_profile_version').$type<Record<string, unknown>>(),
    gamePlanVersionId: uuid('game_plan_version_id'),
    scoringSource: text('scoring_source').notNull().default('courtside'), // courtside | watching_stream
    scorerSourceDelayMs: integer('scorer_source_delay_ms').notNull().default(0),
    attendance: integer('attendance'),
    /** { summary, tempC, condition } */
    weather: jsonb('weather').$type<Record<string, unknown>>(),
    /** [{ role, name }] */
    officials: jsonb('officials').$type<Record<string, unknown>[]>().notNull().default([]),
    /** capability token for the public match centre and the commentator view; null = not shared */
    publicToken: text('public_token').unique(),
    createdBy: text('created_by'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('matches_id_org').on(t.id, t.organisationId),
    uniqueIndex('matches_external_uq').on(t.organisationId, t.competitionId, t.externalId),
    foreignKey({ columns: [t.competitionId, t.organisationId], foreignColumns: [competitions.id, competitions.organisationId] }),
    foreignKey({ columns: [t.seasonId, t.organisationId], foreignColumns: [seasons.id, seasons.organisationId] }),
    foreignKey({ columns: [t.homeTeamId, t.organisationId], foreignColumns: [teams.id, teams.organisationId] }),
    foreignKey({ columns: [t.awayTeamId, t.organisationId], foreignColumns: [teams.id, teams.organisationId] }),
    foreignKey({ columns: [t.venueId, t.organisationId], foreignColumns: [venues.id, venues.organisationId] }),
    check('matches_teams_differ', sql`${t.homeTeamId} <> ${t.awayTeamId}`),
    check('matches_stage_chk', sql`${t.stage} in ('regular','finals')`),
    index('matches_org_sched_idx').on(t.organisationId, t.scheduledAt),
  ],
);

export const matchLineups = pgTable(
  'match_lineups',
  {
    matchId: uuid('match_id').primaryKey(),
    organisationId: org(),
    /** immutable-at-kickoff snapshot: names/numbers/photos and team branding */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    teams: jsonb('teams').$type<Record<string, unknown>>().notNull(),
    lockedAt: ts('locked_at'),
    version: integer('version').notNull().default(1),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [foreignKey({ columns: [t.matchId, t.organisationId], foreignColumns: [matches.id, matches.organisationId] })],
);

export const matchState = pgTable(
  'match_state',
  {
    matchId: uuid('match_id').primaryKey(),
    organisationId: org(),
    stateVersion: integer('state_version').notNull().default(0),
    sequence: integer('sequence').notNull().default(0),
    phase: text('phase').notNull().default('scheduled'),
    projection: jsonb('projection').$type<Record<string, unknown>>().notNull(),
    clocks: jsonb('clocks').$type<Record<string, unknown>>().notNull(),
    updatedAt: updated(),
  },
  (t) => [foreignKey({ columns: [t.matchId, t.organisationId], foreignColumns: [matches.id, matches.organisationId] })],
);

export const matchFacts = pgTable(
  'match_facts',
  {
    id: pk(),
    organisationId: org(),
    matchId: uuid('match_id').notNull(),
    sequence: integer('sequence').notNull(),
    category: text('category').notNull(), // event | phase | adjustment
    type: text('type').notNull(),
    side: text('side'),
    teamId: uuid('team_id'),
    playerId: uuid('player_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    periodId: text('period_id').notNull(),
    clockMs: integer('clock_ms'),
    occurredAt: ts('occurred_at').notNull(),
    acceptedAt: ts('accepted_at').notNull().defaultNow(),
    source: text('source').notNull(), // scorer | producer | offline_sync | rehearsal | api
    actorUserId: text('actor_user_id'),
    deviceId: text('device_id'),
    commandId: uuid('command_id').notNull(),
    revision: integer('revision').notNull().default(1),
    voided: boolean('voided').notNull().default(false),
    /** true when accepted outside the live-trigger freshness window (historical sync) */
    historical: boolean('historical').notNull().default(false),
    createdAt: created(),
  },
  (t) => [
    unique('match_facts_seq').on(t.matchId, t.sequence),
    unique('match_facts_id_org').on(t.id, t.organisationId),
    foreignKey({ columns: [t.matchId, t.organisationId], foreignColumns: [matches.id, matches.organisationId] }),
    check('match_facts_side_chk', sql`${t.side} is null or ${t.side} in ('home','away')`),
    index('match_facts_match_idx').on(t.matchId, t.sequence),
  ],
);

export const factCorrections = pgTable(
  'fact_corrections',
  {
    id: pk(),
    organisationId: org(),
    matchId: uuid('match_id').notNull(),
    factId: uuid('fact_id').notNull(),
    kind: text('kind').notNull(), // void | correct
    fromRevision: integer('from_revision').notNull(),
    toRevision: integer('to_revision').notNull(),
    before: jsonb('before').$type<Record<string, unknown>>().notNull(),
    after: jsonb('after').$type<Record<string, unknown>>().notNull(),
    reason: text('reason').notNull(),
    actorUserId: text('actor_user_id'),
    commandId: uuid('command_id').notNull(),
    createdAt: created(),
  },
  (t) => [
    foreignKey({ columns: [t.factId, t.organisationId], foreignColumns: [matchFacts.id, matchFacts.organisationId] }),
    index('fact_corrections_fact_idx').on(t.factId),
  ],
);

export const scorerLeases = pgTable(
  'scorer_leases',
  {
    matchId: uuid('match_id').primaryKey(),
    organisationId: org(),
    holderUserId: text('holder_user_id'),
    holderDeviceId: text('holder_device_id'),
    /** fencing version, strictly increasing; writes carry it */
    leaseVersion: integer('lease_version').notNull().default(0),
    expiresAt: ts('expires_at'),
    takenOverFrom: text('taken_over_from'),
    takeoverReason: text('takeover_reason'),
    updatedAt: updated(),
  },
  (t) => [foreignKey({ columns: [t.matchId, t.organisationId], foreignColumns: [matches.id, matches.organisationId] })],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    organisationId: org(),
    scope: text('scope').notNull(), // e.g. match:<id>, overlay:<id>
    key: uuid('key').notNull(),
    intentHash: text('intent_hash').notNull(),
    commandType: text('command_type').notNull(),
    response: jsonb('response').$type<Record<string, unknown>>().notNull(),
    statusCode: integer('status_code').notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.organisationId, t.scope, t.key] })],
);

// ---------------------------------------------------------------- themes, templates, overlays
export const themes = pgTable('themes', {
  id: pk(),
  organisationId: uuid('organisation_id').references(() => organisations.id), // null = built-in
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [uniqueIndex('themes_key_uq').on(t.organisationId, t.key)]);

export const themeVersions = pgTable('theme_versions', {
  id: pk(),
  themeId: uuid('theme_id').notNull().references(() => themes.id),
  version: integer('version').notNull(),
  supportedSports: jsonb('supported_sports').$type<string[]>().notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  publishedAt: ts('published_at').notNull().defaultNow(),
  createdAt: created(),
}, (t) => [unique('theme_versions_uq').on(t.themeId, t.version)]);

export const themeProfiles = pgTable(
  'theme_profiles',
  {
    id: pk(),
    organisationId: org(),
    name: text('name').notNull(),
    competitionId: uuid('competition_id'),
    status: text('status').notNull().default('active'),
    currentVersion: integer('current_version').notNull().default(0),
    draft: jsonb('draft').$type<Record<string, unknown>>().notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [unique('theme_profiles_id_org').on(t.id, t.organisationId)],
);

export const themeProfileVersions = pgTable(
  'theme_profile_versions',
  {
    id: pk(),
    organisationId: org(),
    profileId: uuid('profile_id').notNull(),
    version: integer('version').notNull(),
    themeVersionId: uuid('theme_version_id').notNull().references(() => themeVersions.id),
    /** colours, typography, approved logos, sponsor slot config, control-room layout id */
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    publishedBy: text('published_by'),
    publishedAt: ts('published_at').notNull().defaultNow(),
  },
  (t) => [
    unique('tpv_uq').on(t.profileId, t.version),
    unique('tpv_id_org').on(t.id, t.organisationId),
    foreignKey({ columns: [t.profileId, t.organisationId], foreignColumns: [themeProfiles.id, themeProfiles.organisationId] }),
  ],
);

export const graphicTemplates = pgTable(
  'graphic_templates',
  {
    id: pk(),
    organisationId: org(),
    name: text('name').notNull(),
    category: text('category').notNull(), // Scorebug | Match | Teams | Events | Stats | People | Sponsors | Media
    draft: jsonb('draft').$type<Record<string, unknown>>().notNull(),
    currentVersion: integer('current_version').notNull().default(0),
    status: text('status').notNull().default('active'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [unique('graphic_templates_id_org').on(t.id, t.organisationId)],
);

export const templateVersions = pgTable(
  'template_versions',
  {
    id: pk(),
    organisationId: org(),
    templateId: uuid('template_id').notNull(),
    version: integer('version').notNull(),
    scene: jsonb('scene').$type<Record<string, unknown>>().notNull(),
    variables: jsonb('variables').$type<unknown[]>().notNull(),
    layers: jsonb('layers').$type<string[]>().notNull(),
    assetIds: jsonb('asset_ids').$type<string[]>().notNull(),
    publishedBy: text('published_by'),
    publishedAt: ts('published_at').notNull().defaultNow(),
  },
  (t) => [
    unique('template_versions_uq').on(t.templateId, t.version),
    unique('template_versions_id_org').on(t.id, t.organisationId),
    foreignKey({ columns: [t.templateId, t.organisationId], foreignColumns: [graphicTemplates.id, graphicTemplates.organisationId] }),
  ],
);

/** An organisation's own rules preset for a sport ("Futsal 2×18, 5-minute half time"), offered beside the built-in ones. */
export const rulesPresets = pgTable(
  'rules_presets',
  {
    id: pk(),
    organisationId: org(),
    sport: text('sport').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    createdBy: text('created_by'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [unique('rules_presets_id_org').on(t.id, t.organisationId), uniqueIndex('rules_presets_name_uq').on(t.organisationId, t.sport, t.name)],
);

export const controlRoomLayouts = pgTable('control_room_layouts', {
  id: pk(),
  organisationId: org(),
  name: text('name').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  createdAt: created(),
  updatedAt: updated(),
});

export const overlays = pgTable(
  'overlays',
  {
    id: pk(),
    organisationId: org(),
    matchId: uuid('match_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('graphics'), // graphics (browser source) | programme (cloud output)
    /** 16:9 (broadcast), 9:16 (vertical social) or venue (big screen, large type) */
    format: text('format').notNull().default('16:9'),
    outputId: uuid('output_id'),
    /** pinned effective versions (snapshot at creation / explicit apply) */
    themeProfileVersionId: uuid('theme_profile_version_id'),
    themeVersionId: uuid('theme_version_id'),
    gamePlanVersionId: uuid('game_plan_version_id'),
    pendingThemeProfileVersionId: uuid('pending_theme_profile_version_id'),
    publicId: text('public_id').notNull().unique(),
    status: text('status').notNull().default('active'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('overlays_id_org').on(t.id, t.organisationId),
    foreignKey({ columns: [t.matchId, t.organisationId], foreignColumns: [matches.id, matches.organisationId] }),
    index('overlays_match_idx').on(t.matchId),
  ],
);

export const overlayState = pgTable(
  'overlay_state',
  {
    overlayId: uuid('overlay_id').primaryKey(),
    organisationId: org(),
    revision: integer('revision').notNull().default(0),
    mode: text('mode').notNull().default('auto'), // auto | manual
    inhibited: boolean('inhibited').notNull().default(false),
    scorebugVisible: boolean('scorebug_visible').notNull().default(false),
    layers: jsonb('layers').$type<Record<string, unknown>>().notNull().default({}),
    /** sponsor slot assignments shown inside templates (e.g. scorebug_logo), rotated by automation */
    slots: jsonb('slots').$type<Record<string, unknown>>().notNull().default({}),
    displayedRevision: integer('displayed_revision').notNull().default(0),
    displayedAt: ts('displayed_at'),
    /** fenced live owner of automation for this overlay */
    ownerWorker: text('owner_worker'),
    ownerFence: bigint('owner_fence', { mode: 'number' }).notNull().default(0),
    updatedAt: updated(),
  },
  (t) => [foreignKey({ columns: [t.overlayId, t.organisationId], foreignColumns: [overlays.id, overlays.organisationId] }).onDelete('cascade')],
);

export const overlayCredentials = pgTable(
  'overlay_credentials',
  {
    id: pk(),
    organisationId: org(),
    overlayId: uuid('overlay_id').notNull(),
    purpose: text('purpose').notNull(), // production | monitor | rehearsal
    tokenHash: text('token_hash').notNull().unique(),
    tokenVersion: integer('token_version').notNull(),
    revokedAt: ts('revoked_at'),
    lastUsedAt: ts('last_used_at'),
    createdAt: created(),
  },
  (t) => [
    foreignKey({ columns: [t.overlayId, t.organisationId], foreignColumns: [overlays.id, overlays.organisationId] }).onDelete('cascade'),
    index('overlay_credentials_overlay_idx').on(t.overlayId, t.purpose),
  ],
);

/**
 * A stream link: one OBS link for a day of back-to-back matches at one place (a ground, a competition, or both).
 * The link shows the graphics output of whichever of today's matches is on, so OBS keeps one browser source all day
 * (packages/services/src/channels.ts decides which). The token is stored hashed, like an overlay credential.
 */
export const streamChannels = pgTable(
  'stream_channels',
  {
    id: pk(),
    organisationId: org(),
    name: text('name').notNull(),
    /** today's matches at this ground (null: any ground) */
    venueId: uuid('venue_id').references((): AnyPgColumn => venues.id, { onDelete: 'set null' }),
    /** today's matches of this competition (null: any competition) */
    competitionId: uuid('competition_id').references((): AnyPgColumn => competitions.id, { onDelete: 'set null' }),
    publicId: text('public_id').notNull().unique(),
    tokenHash: text('token_hash').notNull().unique(),
    tokenVersion: integer('token_version').notNull().default(1),
    /** a match put on by hand; null = follow the day automatically */
    pinnedMatchId: uuid('pinned_match_id').references((): AnyPgColumn => matches.id, { onDelete: 'set null' }),
    /** how many minutes before the next kick-off the link moves on from a finished match */
    switchBeforeMinutes: integer('switch_before_minutes').notNull().default(10),
    /** last time an OBS page asked which match is on */
    lastSeenAt: ts('last_seen_at'),
    createdBy: text('created_by'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('stream_channels_org_idx').on(t.organisationId)],
);

export const overlayCommands = pgTable(
  'overlay_commands',
  {
    id: pk(),
    organisationId: org(),
    overlayId: uuid('overlay_id').notNull(),
    commandId: uuid('command_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    source: text('source').notNull(), // operator | automation | system
    actorUserId: text('actor_user_id'),
    resultRevision: integer('result_revision'),
    status: text('status').notNull(), // accepted | rejected
    reason: text('reason'),
    createdAt: created(),
  },
  (t) => [
    unique('overlay_commands_uq').on(t.overlayId, t.commandId),
    foreignKey({ columns: [t.overlayId, t.organisationId], foreignColumns: [overlays.id, overlays.organisationId] }).onDelete('cascade'),
    index('overlay_commands_overlay_idx').on(t.overlayId, t.createdAt),
  ],
);

/** One renderer connection per row; the reporting authority is nominated per output session. */
export const rendererSessions = pgTable(
  'renderer_sessions',
  {
    id: pk(),
    organisationId: org(),
    overlayId: uuid('overlay_id').notNull(),
    purpose: text('purpose').notNull(), // production | monitor | preview | rehearsal | compositor
    instanceId: text('instance_id').notNull(),
    isReportingAuthority: boolean('is_reporting_authority').notNull().default(false),
    displayedRevision: integer('displayed_revision').notNull().default(0),
    connectedAt: ts('connected_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    disconnectedAt: ts('disconnected_at'),
  },
  (t) => [
    foreignKey({ columns: [t.overlayId, t.organisationId], foreignColumns: [overlays.id, overlays.organisationId] }).onDelete('cascade'),
    uniqueIndex('renderer_authority_uq').on(t.overlayId).where(sql`${t.isReportingAuthority} and ${t.disconnectedAt} is null`),
  ],
);

// ---------------------------------------------------------------- automation
export const gamePlans = pgTable(
  'game_plans',
  {
    id: pk(),
    organisationId: org(),
    name: text('name').notNull(),
    sport: text('sport').notNull(),
    draft: jsonb('draft').$type<Record<string, unknown>>().notNull(),
    currentVersion: integer('current_version').notNull().default(0),
    status: text('status').notNull().default('active'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [unique('game_plans_id_org').on(t.id, t.organisationId)],
);

/** Published graph (playlists/items/triggers) is stored as one immutable validated document per version. */
export const gamePlanVersions = pgTable(
  'game_plan_versions',
  {
    id: pk(),
    organisationId: org(),
    gamePlanId: uuid('game_plan_id').notNull(),
    version: integer('version').notNull(),
    sport: text('sport').notNull(),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    publishedBy: text('published_by'),
    publishedAt: ts('published_at').notNull().defaultNow(),
  },
  (t) => [
    unique('gpv_uq').on(t.gamePlanId, t.version),
    unique('gpv_id_org').on(t.id, t.organisationId),
    foreignKey({ columns: [t.gamePlanId, t.organisationId], foreignColumns: [gamePlans.id, gamePlans.organisationId] }),
  ],
);

export const automationRuns = pgTable(
  'automation_runs',
  {
    id: pk(),
    organisationId: org(),
    overlayId: uuid('overlay_id').notNull(),
    matchId: uuid('match_id').notNull(),
    gamePlanVersionId: uuid('game_plan_version_id').notNull(),
    playlistId: text('playlist_id').notNull(),
    triggerId: text('trigger_id').notNull(),
    iteration: text('iteration').notNull(),
    executionKey: text('execution_key').notNull(),
    priority: integer('priority').notNull(),
    playlistKind: text('playlist_kind').notNull().default('in_play'),
    promotional: boolean('promotional').notNull().default(false),
    layers: jsonb('layers').$type<string[]>().notNull(),
    triggerContext: jsonb('trigger_context').$type<Record<string, unknown>>().notNull(),
    sourceFactId: uuid('source_fact_id'),
    sourceFactRevision: integer('source_fact_revision'),
    state: text('state').notNull(), // queued | running | completed | cancelled | skipped | preempted
    reason: text('reason'),
    deadlineAt: ts('deadline_at'),
    rehearsal: boolean('rehearsal').notNull().default(false),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    createdAt: created(),
  },
  (t) => [
    unique('automation_runs_exec_uq').on(t.executionKey),
    unique('automation_runs_id_org').on(t.id, t.organisationId),
    foreignKey({ columns: [t.overlayId, t.organisationId], foreignColumns: [overlays.id, overlays.organisationId] }).onDelete('cascade'),
    index('automation_runs_overlay_idx').on(t.overlayId, t.createdAt),
  ],
);

export const automationCues = pgTable(
  'automation_cues',
  {
    id: pk(),
    organisationId: org(),
    runId: uuid('run_id').notNull(),
    overlayId: uuid('overlay_id').notNull(),
    cueKey: text('cue_key').notNull(),
    itemIndex: integer('item_index').notNull(),
    action: text('action').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull(),
    dueAt: ts('due_at').notNull(),
    deadlineAt: ts('deadline_at'),
    durationMs: integer('duration_ms'),
    state: text('state').notNull(), // pending | dispatched | done | cancelled | skipped | failed
    reason: text('reason'),
    dispatchedRevision: integer('dispatched_revision'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('automation_cues_key_uq').on(t.cueKey),
    foreignKey({ columns: [t.runId, t.organisationId], foreignColumns: [automationRuns.id, automationRuns.organisationId] }).onDelete('cascade'),
    index('automation_cues_due_idx').on(t.state, t.dueAt),
  ],
);

/** Durable trigger bookkeeping: fired/skipped crossings so pause/resume/corrections never duplicate. */
export const triggerOccurrences = pgTable(
  'trigger_occurrences',
  {
    organisationId: org(),
    overlayId: uuid('overlay_id').notNull(),
    occurrenceKey: text('occurrence_key').notNull(),
    outcome: text('outcome').notNull(), // fired | skipped
    reason: text('reason'),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.overlayId, t.occurrenceKey] })],
);

export const workerLeases = pgTable('worker_leases', {
  resource: text('resource').primaryKey(),
  owner: text('owner').notNull(),
  fence: bigint('fence', { mode: 'number' }).notNull(),
  expiresAt: ts('expires_at').notNull(),
});

// ---------------------------------------------------------------- sponsors
export const brands = pgTable('brands', {
  id: pk(),
  organisationId: org(),
  name: text('name').notNull(),
  category: text('category'),
  status: text('status').notNull().default('active'),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [unique('brands_id_org').on(t.id, t.organisationId)]);

export const creativeSets = pgTable('creative_sets', {
  id: pk(),
  organisationId: org(),
  brandId: uuid('brand_id').notNull(),
  name: text('name').notNull(),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  unique('creative_sets_id_org').on(t.id, t.organisationId),
  foreignKey({ columns: [t.brandId, t.organisationId], foreignColumns: [brands.id, brands.organisationId] }),
]);

export const creatives = pgTable(
  'creatives',
  {
    id: pk(),
    organisationId: org(),
    creativeSetId: uuid('creative_set_id').notNull(),
    assetId: uuid('asset_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(), // image | banner | video
    width: integer('width'),
    height: integer('height'),
    aspectRatio: doublePrecision('aspect_ratio'),
    mimeType: text('mime_type'),
    durationMs: integer('duration_ms'),
    approvalStatus: text('approval_status').notNull().default('pending'), // pending | approved | rejected
    expiresAt: ts('expires_at'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('creatives_id_org').on(t.id, t.organisationId),
    foreignKey({ columns: [t.creativeSetId, t.organisationId], foreignColumns: [creativeSets.id, creativeSets.organisationId] }),
  ],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: pk(),
    organisationId: org(),
    brandId: uuid('brand_id').notNull(),
    creativeSetId: uuid('creative_set_id').notNull(),
    name: text('name').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    priority: integer('priority').notNull().default(3),
    weight: integer('weight').notNull().default(1),
    totalCap: integer('total_cap'),
    perMatchCap: integer('per_match_cap'),
    minSpacingSeconds: integer('min_spacing_seconds').notNull().default(0),
    excludedCategories: jsonb('excluded_categories').$type<string[]>().notNull().default([]),
    eventSponsorship: jsonb('event_sponsorship').$type<string[]>().notNull().default([]), // e.g. ['goal']
    status: text('status').notNull().default('active'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('campaigns_id_org').on(t.id, t.organisationId),
    foreignKey({ columns: [t.brandId, t.organisationId], foreignColumns: [brands.id, brands.organisationId] }),
    foreignKey({ columns: [t.creativeSetId, t.organisationId], foreignColumns: [creativeSets.id, creativeSets.organisationId] }),
    check('campaigns_dates_chk', sql`${t.endsAt} > ${t.startsAt}`),
    check('campaigns_priority_chk', sql`${t.priority} between 1 and 4`),
    check('campaigns_weight_chk', sql`${t.weight} between 1 and 1000`),
  ],
);

export const allocations = pgTable(
  'allocations',
  {
    id: pk(),
    organisationId: org(),
    campaignId: uuid('campaign_id').notNull(),
    scopeType: text('scope_type').notNull(), // organisation | competition | team | match
    scopeId: uuid('scope_id'),
    placement: text('placement').notNull(), // scorebug_logo | lower_third_banner | event_partner | detached_logo | full_frame_image | full_frame_video | clip_intro | clip_outro
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    foreignKey({ columns: [t.campaignId, t.organisationId], foreignColumns: [campaigns.id, campaigns.organisationId] }).onDelete('cascade'),
    index('allocations_campaign_idx').on(t.campaignId),
  ],
);

export const sponsorDecisions = pgTable('sponsor_decisions', {
  id: pk(),
  organisationId: org(),
  matchId: uuid('match_id').notNull(),
  overlayId: uuid('overlay_id'),
  placement: text('placement').notNull(),
  campaignId: uuid('campaign_id'),
  creativeId: uuid('creative_id'),
  outcome: text('outcome').notNull(), // selected | fallback | empty
  reason: text('reason'),
  inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull(),
  requestKey: text('request_key').notNull().unique(),
  rehearsal: boolean('rehearsal').notNull().default(false),
  createdAt: created(),
});

export const sponsorExposures = pgTable(
  'sponsor_exposures',
  {
    id: pk(),
    organisationId: org(),
    matchId: uuid('match_id').notNull(),
    overlayId: uuid('overlay_id').notNull(),
    outputSessionId: uuid('output_session_id'),
    decisionId: uuid('decision_id'),
    campaignId: uuid('campaign_id'),
    creativeId: uuid('creative_id').notNull(),
    placement: text('placement').notNull(),
    cueId: text('cue_id').notNull(),
    revision: integer('revision').notNull(),
    evidenceType: text('evidence_type').notNull(), // renderer | compositor
    rendererSessionId: uuid('renderer_session_id'),
    /** dedup: one interval per (overlay, cue, revision, evidence authority) */
    intervalKey: text('interval_key').notNull().unique(),
    firstVisibleAt: ts('first_visible_at').notNull(),
    lastConfirmedAt: ts('last_confirmed_at').notNull(),
    closedAt: ts('closed_at'),
    closeReason: text('close_reason'), // ended | disconnected | interrupted | heartbeat_lost
    visibleArea: doublePrecision('visible_area'),
    destinationStatuses: jsonb('destination_statuses').$type<Record<string, unknown>[]>().notNull().default([]),
    createdAt: created(),
  },
  (t) => [index('sponsor_exposures_match_idx').on(t.organisationId, t.matchId)],
);

// ---------------------------------------------------------------- streaming
export const inputs = pgTable(
  'inputs',
  {
    id: pk(),
    organisationId: org(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('rtmp'),
    teamId: uuid('team_id'),
    venueId: uuid('venue_id'),
    streamKeyEnc: text('stream_key_enc'),
    keyVersion: integer('key_version').notNull().default(1),
    /** current binding to a broadcast session; prevents routing to two rooms */
    boundSessionId: uuid('bound_session_id'),
    bindingVersion: integer('binding_version').notNull().default(0),
    sourceDelayMs: integer('source_delay_ms').notNull().default(0),
    calibrationMs: integer('calibration_ms').notNull().default(0),
    status: text('status').notNull().default('idle'), // idle | bound | receiving | error | blocked
    lastHealth: jsonb('last_health').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [unique('inputs_id_org').on(t.id, t.organisationId)],
);

export const streamOutputs = pgTable(
  'stream_outputs',
  {
    id: pk(),
    organisationId: org(),
    matchId: uuid('match_id').notNull(),
    inputId: uuid('input_id'),
    overlayId: uuid('overlay_id'),
    mode: text('mode').notNull(), // PROGRAMME | CLEAN
    name: text('name').notNull(),
    preset: text('preset').notNull().default('720p30'),
    record: boolean('record').notNull().default(true),
    hls: boolean('hls').notNull().default(true),
    holdingSlate: text('holding_slate').notNull().default('waiting'),
    prerollSeconds: integer('preroll_seconds').notNull().default(0),
    postrollSeconds: integer('postroll_seconds').notNull().default(120),
    calibrationMs: integer('calibration_ms').notNull().default(0),
    scheduleVersion: integer('schedule_version').notNull().default(1),
    autoSchedule: boolean('auto_schedule').notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('stream_outputs_id_org').on(t.id, t.organisationId),
    foreignKey({ columns: [t.matchId, t.organisationId], foreignColumns: [matches.id, matches.organisationId] }),
    foreignKey({ columns: [t.inputId, t.organisationId], foreignColumns: [inputs.id, inputs.organisationId] }),
    check('stream_outputs_mode_chk', sql`${t.mode} in ('PROGRAMME','CLEAN')`),
    uniqueIndex('stream_outputs_match_mode_uq').on(t.matchId, t.mode),
  ],
);

export const destinations = pgTable(
  'destinations',
  {
    id: pk(),
    organisationId: org(),
    outputId: uuid('output_id').notNull(),
    name: text('name').notNull(),
    platform: text('platform').notNull().default('custom'), // youtube | facebook | twitch | custom
    serverUrl: text('server_url').notNull(),
    streamKeyEnc: text('stream_key_enc').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    lastStatus: jsonb('last_status').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [foreignKey({ columns: [t.outputId, t.organisationId], foreignColumns: [streamOutputs.id, streamOutputs.organisationId] }).onDelete('cascade')],
);

export const broadcastSessions = pgTable(
  'broadcast_sessions',
  {
    id: pk(),
    organisationId: org(),
    matchId: uuid('match_id').notNull(),
    inputId: uuid('input_id'),
    roomName: text('room_name').notNull().unique(),
    state: text('state').notNull(), // DRAFT | SCHEDULED | WAITING_FOR_INPUT | STARTING | LIVE | DEGRADED | STOPPING | STOPPED | FAILED
    scheduleVersion: integer('schedule_version').notNull().default(1),
    scheduledStartAt: ts('scheduled_start_at'),
    scheduledStopAt: ts('scheduled_stop_at'),
    error: jsonb('error').$type<Record<string, unknown>>(),
    demo: boolean('demo').notNull().default(false),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    createdBy: text('created_by'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [unique('broadcast_sessions_id_org').on(t.id, t.organisationId), index('broadcast_sessions_match_idx').on(t.matchId)],
);

export const outputSessions = pgTable(
  'output_sessions',
  {
    id: pk(),
    organisationId: org(),
    broadcastSessionId: uuid('broadcast_session_id').notNull(),
    outputId: uuid('output_id').notNull(),
    state: text('state').notNull(),
    fence: integer('fence').notNull().default(1),
    preset: jsonb('preset').$type<Record<string, unknown>>().notNull(),
    reportingAuthority: text('reporting_authority').notNull(), // compositor | renderer
    error: jsonb('error').$type<Record<string, unknown>>(),
    startedAt: ts('started_at'),
    liveAt: ts('live_at'),
    endedAt: ts('ended_at'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('output_sessions_id_org').on(t.id, t.organisationId),
    foreignKey({ columns: [t.broadcastSessionId, t.organisationId], foreignColumns: [broadcastSessions.id, broadcastSessions.organisationId] }),
    foreignKey({ columns: [t.outputId, t.organisationId], foreignColumns: [streamOutputs.id, streamOutputs.organisationId] }),
    // at most one active output session per output
    uniqueIndex('output_sessions_active_uq').on(t.outputId).where(sql`${t.state} not in ('STOPPED','FAILED')`),
  ],
);

export const providerResources = pgTable(
  'provider_resources',
  {
    id: pk(),
    organisationId: org(),
    provider: text('provider').notNull(),
    kind: text('kind').notNull(), // ingress | room | egress
    providerId: text('provider_id').notNull(),
    resourceType: text('resource_type').notNull(), // input | broadcast_session | output_session
    resourceId: uuid('resource_id').notNull(),
    fence: integer('fence').notNull().default(1),
    state: text('state').notNull().default('active'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('provider_resources_uq').on(t.provider, t.kind, t.providerId), index('provider_resources_res_idx').on(t.resourceType, t.resourceId)],
);

export const providerWebhookEvents = pgTable('provider_webhook_events', {
  id: text('id').primaryKey(), // provider event id (dedup)
  provider: text('provider').notNull(),
  event: text('event').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  processedAt: ts('processed_at'),
  createdAt: created(),
});

export const capacityReservations = pgTable(
  'capacity_reservations',
  {
    id: pk(),
    organisationId: org(),
    outputSessionId: uuid('output_session_id').notNull().unique(),
    units: integer('units').notNull().default(1),
    releasedAt: ts('released_at'),
    createdAt: created(),
  },
  (t) => [index('capacity_active_idx').on(t.releasedAt)],
);

// ---------------------------------------------------------------- recordings & highlights
export const recordings = pgTable(
  'recordings',
  {
    id: pk(),
    organisationId: org(),
    matchId: uuid('match_id').notNull(),
    outputSessionId: uuid('output_session_id'),
    outputId: uuid('output_id'),
    kind: text('kind').notNull().default('programme'), // programme | clean | upload
    title: text('title').notNull(),
    state: text('state').notNull(), // PENDING | RECORDING | FINALISING | READY | FAILED | PARTIAL
    storagePrefix: text('storage_prefix').notNull(),
    mp4Key: text('mp4_key'),
    playlistKey: text('playlist_key'),
    durationMs: integer('duration_ms'),
    probe: jsonb('probe').$type<Record<string, unknown>>(),
    bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
    retainUntil: ts('retain_until'),
    pinned: boolean('pinned').notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [unique('recordings_id_org').on(t.id, t.organisationId), index('recordings_match_idx').on(t.organisationId, t.matchId)],
);

export const recordingParts = pgTable(
  'recording_parts',
  {
    id: pk(),
    organisationId: org(),
    recordingId: uuid('recording_id').notNull(),
    partIndex: integer('part_index').notNull(),
    egressId: text('egress_id'),
    /** capture-start anchor (UTC) of media offset 0 in this part */
    captureStartAt: ts('capture_start_at'),
    playlistKey: text('playlist_key'),
    mp4Key: text('mp4_key'),
    inputDelayMs: integer('input_delay_ms').notNull().default(0),
    calibrationMs: integer('calibration_ms').notNull().default(0),
    discontinuities: jsonb('discontinuities').$type<unknown[]>().notNull().default([]),
    state: text('state').notNull().default('RECORDING'),
    durationMs: integer('duration_ms'),
    endedAt: ts('ended_at'),
    createdAt: created(),
  },
  (t) => [
    unique('recording_parts_uq').on(t.recordingId, t.partIndex),
    foreignKey({ columns: [t.recordingId, t.organisationId], foreignColumns: [recordings.id, recordings.organisationId] }).onDelete('cascade'),
  ],
);

export const recordingSegments = pgTable(
  'recording_segments',
  {
    id: pk(),
    organisationId: org(),
    recordingId: uuid('recording_id').notNull(),
    partId: uuid('part_id').notNull(),
    seq: integer('seq').notNull(),
    objectKey: text('object_key').notNull(),
    startAt: ts('start_at').notNull(), // program-date-time
    durationMs: integer('duration_ms').notNull(),
    mediaOffsetMs: integer('media_offset_ms').notNull(),
    discontinuity: boolean('discontinuity').notNull().default(false),
    objectExists: boolean('object_exists').notNull().default(true),
    createdAt: created(),
  },
  (t) => [unique('recording_segments_uq').on(t.partId, t.seq), index('recording_segments_time_idx').on(t.recordingId, t.startAt)],
);

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: pk(),
    organisationId: org(),
    kind: text('kind').notNull(), // image | video | audio | font | logo
    name: text('name').notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    originalKey: text('original_key').notNull(),
    originalMime: text('original_mime'),
    detectedMime: text('detected_mime'),
    bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
    expectedBytes: bigint('expected_bytes', { mode: 'number' }),
    checksum: text('checksum'),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    state: text('state').notNull(), // UPLOADING | PROCESSING | READY | FAILED | ARCHIVED
    error: text('error'),
    ownerTeamId: uuid('owner_team_id'),
    retainUntil: ts('retain_until'),
    pinned: boolean('pinned').notNull().default(false),
    createdBy: text('created_by'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [unique('media_assets_id_org').on(t.id, t.organisationId), index('media_assets_org_idx').on(t.organisationId, t.kind, t.state)],
);

export const assetDerivatives = pgTable(
  'asset_derivatives',
  {
    id: pk(),
    organisationId: org(),
    assetId: uuid('asset_id').notNull(),
    purpose: text('purpose').notNull(), // broadcast | thumbnail | preview
    objectKey: text('object_key').notNull(),
    mime: text('mime').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    checksum: text('checksum'),
    createdAt: created(),
  },
  (t) => [
    unique('asset_derivatives_uq').on(t.assetId, t.purpose),
    foreignKey({ columns: [t.assetId, t.organisationId], foreignColumns: [mediaAssets.id, mediaAssets.organisationId] }).onDelete('cascade'),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * Stored files kept in the database when object storage cannot take them (not configured, unreachable): small
 * files only (images, logos, fonts). Keyed by the same object key, so reads fall back here transparently.
 */
export const mediaBlobs = pgTable(
  'media_blobs',
  {
    key: text('key').primaryKey(),
    organisationId: org(),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    data: bytea('data').notNull(),
    createdAt: created(),
  },
  (t) => [index('media_blobs_org_idx').on(t.organisationId)],
);

/**
 * A video of a whole match, for the highlights generator (Match → Highlights): uploaded in parts (S3 multipart
 * through the API) and kept as uploaded; the media worker reads its length and makes a small copy for the browser.
 * `sync` holds, per period of play, the video time it kicked off (ms).
 */
export const matchVideos = pgTable(
  'match_videos',
  {
    id: pk(),
    organisationId: org(),
    matchId: uuid('match_id').notNull(),
    name: text('name').notNull(),
    objectKey: text('object_key').notNull(),
    mime: text('mime').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    uploadId: text('upload_id'),
    /** the ETag of each part received, in part order */
    parts: jsonb('parts').$type<(string | null)[]>().notNull().default([]),
    partSize: integer('part_size').notNull(),
    state: text('state').notNull(), // UPLOADING | PROCESSING | READY | FAILED
    error: text('error'),
    durationMs: integer('duration_ms'),
    width: integer('width'),
    height: integer('height'),
    fps: doublePrecision('fps'),
    proxyKey: text('proxy_key'),
    thumbnailKey: text('thumbnail_key'),
    sync: jsonb('sync').$type<Record<string, number>>().notNull().default({}),
    createdBy: text('created_by'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('match_videos_match_idx').on(t.organisationId, t.matchId)],
);

export const highlightRequests = pgTable(
  'highlight_requests',
  {
    id: pk(),
    organisationId: org(),
    matchId: uuid('match_id').notNull(),
    factId: uuid('fact_id'),
    factRevision: integer('fact_revision').notNull().default(0),
    outputId: uuid('output_id').notNull(),
    recipeVersion: text('recipe_version').notNull(),
    requestKey: text('request_key').notNull().unique(), // (event_id, event_revision, output_id, recipe_version)
    label: text('label').notNull(),
    targetCaptureAt: ts('target_capture_at').notNull(),
    prerollMs: integer('preroll_ms').notNull(),
    postrollMs: integer('postroll_ms').notNull(),
    mappingVersion: integer('mapping_version').notNull().default(1),
    mappingConfidence: text('mapping_confidence').notNull().default('calibrated'),
    state: text('state').notNull(), // WAITING_FOR_MEDIA | QUEUED | PROCESSING | READY | STALE | NEEDS_ALIGNMENT | FAILED
    reason: text('reason'),
    attempts: integer('attempts').notNull().default(0),
    clipId: uuid('clip_id'),
    shortened: boolean('shortened').notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('highlight_requests_state_idx').on(t.state)],
);

export const clips = pgTable(
  'clips',
  {
    id: pk(),
    organisationId: org(),
    matchId: uuid('match_id'),
    recordingId: uuid('recording_id'),
    sourceClipId: uuid('source_clip_id'),
    title: text('title').notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    partId: uuid('part_id'),
    inMs: integer('in_ms').notNull(),
    outMs: integer('out_ms').notNull(),
    markers: jsonb('markers').$type<unknown[]>().notNull().default([]),
    edit: jsonb('edit').$type<Record<string, unknown>>().notNull().default({}),
    objectKey: text('object_key'),
    thumbnailKey: text('thumbnail_key'),
    probe: jsonb('probe').$type<Record<string, unknown>>(),
    bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
    state: text('state').notNull(), // PROCESSING | READY | STALE | FAILED
    stale: boolean('stale').notNull().default(false),
    ownerTeamId: uuid('owner_team_id'),
    createdBy: text('created_by'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [unique('clips_id_org').on(t.id, t.organisationId), check('clips_range_chk', sql`${t.outMs} > ${t.inMs}`), index('clips_org_idx').on(t.organisationId, t.matchId)],
);

export const compilations = pgTable('compilations', {
  id: pk(),
  organisationId: org(),
  title: text('title').notNull(),
  clipIds: jsonb('clip_ids').$type<string[]>().notNull(),
  options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: text('created_by'),
  createdAt: created(),
  updatedAt: updated(),
});

export const exportJobs = pgTable(
  'export_jobs',
  {
    id: pk(),
    organisationId: org(),
    kind: text('kind').notNull(), // clip_extract | clip_export | compilation | asset_normalise | recording_finalise
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    jobKey: text('job_key').notNull().unique(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull(),
    state: text('state').notNull(), // QUEUED | RUNNING | COMPLETED | FAILED | CANCELLED
    progress: doublePrecision('progress').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    outputKey: text('output_key'),
    outputProbe: jsonb('output_probe').$type<Record<string, unknown>>(),
    outputBytes: bigint('output_bytes', { mode: 'number' }),
    workerPid: integer('worker_pid'),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    expiresAt: ts('expires_at'),
    createdBy: text('created_by'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [unique('export_jobs_id_org').on(t.id, t.organisationId), index('export_jobs_state_idx').on(t.organisationId, t.state)],
);

export const shareLinks = pgTable(
  'share_links',
  {
    id: pk(),
    organisationId: org(),
    resourceType: text('resource_type').notNull(), // clip | recording | export
    resourceId: uuid('resource_id').notNull(),
    publicId: text('public_id').notNull().unique(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    accessCount: integer('access_count').notNull().default(0),
    createdBy: text('created_by'),
    createdAt: created(),
  },
  (t) => [index('share_links_resource_idx').on(t.resourceType, t.resourceId)],
);

export const apiKeys = pgTable('api_keys', {
  id: pk(),
  organisationId: org(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull().unique(),
  keyHash: text('key_hash').notNull(),
  scopes: jsonb('scopes').$type<{ action: string; resourceType?: string; resourceId?: string }[]>().notNull(),
  expiresAt: ts('expires_at'),
  revokedAt: ts('revoked_at'),
  lastUsedAt: ts('last_used_at'),
  createdBy: text('created_by'),
  createdAt: created(),
});

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: pk(),
  organisationId: org(),
  url: text('url').notNull(),
  events: jsonb('events').$type<string[]>().notNull(),
  secretEnc: text('secret_enc').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: created(),
  updatedAt: updated(),
});

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: pk(),
    organisationId: org(),
    endpointId: uuid('endpoint_id').notNull().references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    eventType: text('event_type').notNull(),
    /** the body that was (or will be) signed and sent */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer('attempts').notNull().default(0),
    state: text('state').notNull(), // pending | delivered | failed | dead
    lastStatus: integer('last_status'),
    lastError: text('last_error'),
    nextAttemptAt: ts('next_attempt_at'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [unique('webhook_deliveries_uq').on(t.endpointId, t.eventId)],
);

// ---------------------------------------------------------------- platform plumbing
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    position: bigint('position', { mode: 'number' }).generatedAlwaysAsIdentity(),
    organisationId: org(),
    topic: text('topic').notNull(), // e.g. match.fact.accepted
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    aggregateSeq: integer('aggregate_seq'),
    schemaVersion: integer('schema_version').notNull().default(1),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    state: text('state').notNull().default('pending'), // pending | dispatched | dead
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    availableAt: ts('available_at').notNull().defaultNow(),
    dispatchedAt: ts('dispatched_at'),
    createdAt: created(),
  },
  (t) => [index('outbox_pending_idx').on(t.state, t.position), index('outbox_aggregate_idx').on(t.aggregateType, t.aggregateId, t.position)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organisationId: org(),
    actorUserId: text('actor_user_id'),
    actorType: text('actor_type').notNull().default('user'), // user | system | api_key | worker
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    requestId: text('request_id'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    reason: text('reason'),
    createdAt: created(),
  },
  (t) => [index('audit_org_idx').on(t.organisationId, t.createdAt), index('audit_resource_idx').on(t.resourceType, t.resourceId)],
);

export const entitlements = pgTable('entitlements', {
  organisationId: uuid('organisation_id').primaryKey().references(() => organisations.id),
  plan: text('plan').notNull().default('self-hosted'),
  features: jsonb('features').$type<Record<string, boolean>>().notNull(),
  limits: jsonb('limits').$type<Record<string, number>>().notNull(),
  updatedBy: text('updated_by'),
  updatedAt: updated(),
});

export const usageLedger = pgTable(
  'usage_ledger',
  {
    id: pk(),
    organisationId: org(),
    module: text('module').notNull(), // graphics | streaming | storage | highlights | media_jobs
    sessionRef: text('session_ref'),
    quantity: doublePrecision('quantity').notNull(),
    unit: text('unit').notNull(), // output_seconds | gb_days | job_seconds | bytes
    intervalStart: ts('interval_start').notNull(),
    intervalEnd: ts('interval_end').notNull(),
    dedupKey: text('dedup_key').notNull().unique(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: created(),
  },
  (t) => [index('usage_org_idx').on(t.organisationId, t.module, t.intervalStart)],
);

export const notifications = pgTable('notifications', {
  id: pk(),
  organisationId: org(),
  userId: text('user_id'),
  severity: text('severity').notNull(), // info | warning | error
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  readAt: ts('read_at'),
  createdAt: created(),
});

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  prefs: jsonb('prefs').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: updated(),
});

// ---------------------------------------------------------------- match-day collaboration, notifications, metering
/** Run-sheet notes and timed comments the production team shares on a match. */
export const matchNotes = pgTable(
  'match_notes',
  {
    id: pk(),
    organisationId: org(),
    matchId: uuid('match_id').notNull(),
    kind: text('kind').notNull().default('note'), // note | runsheet
    /** run sheet timing label, e.g. "KO-10" or "HT" */
    atLabel: text('at_label'),
    body: text('body').notNull(),
    done: boolean('done').notNull().default(false),
    authorUserId: text('author_user_id'),
    position: integer('position').notNull().default(0),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [foreignKey({ columns: [t.matchId, t.organisationId], foreignColumns: [matches.id, matches.organisationId] }).onDelete('cascade'), index('match_notes_match_idx').on(t.matchId, t.position)],
);

/** Web Push subscriptions (one per browser) for reminders. Keys are opaque to us; the endpoint is the identity. */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: pk(),
    organisationId: org(),
    userId: text('user_id').notNull(),
    endpoint: text('endpoint').notNull().unique(),
    keys: jsonb('keys').$type<{ p256dh: string; auth: string }>().notNull(),
    userAgent: text('user_agent'),
    createdAt: created(),
  },
  (t) => [index('push_subs_user_idx').on(t.userId)],
);

/** Reminders already sent for a match (kick-off, left live), so each is sent once. */
export const matchReminders = pgTable(
  'match_reminders',
  {
    id: pk(),
    organisationId: org(),
    matchId: uuid('match_id').notNull(),
    kind: text('kind').notNull(), // kickoff_scorer | kickoff_operator | left_live
    sentAt: ts('sent_at').notNull().defaultNow(),
  },
  (t) => [unique('match_reminders_once').on(t.matchId, t.kind), foreignKey({ columns: [t.matchId, t.organisationId], foreignColumns: [matches.id, matches.organisationId] }).onDelete('cascade')],
);

/** Time on air per graphic, derived from overlay state changes (open row = still on air). */
export const graphicAirtime = pgTable(
  'graphic_airtime',
  {
    id: pk(),
    organisationId: org(),
    matchId: uuid('match_id').notNull(),
    overlayId: uuid('overlay_id').notNull(),
    cueId: text('cue_id').notNull(),
    templateKey: text('template_key').notNull(),
    layer: text('layer').notNull(),
    source: text('source').notNull(), // operator | automation | api
    sponsorCreativeId: uuid('sponsor_creative_id'),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at'),
    durationMs: integer('duration_ms'),
    createdAt: created(),
  },
  (t) => [
    unique('graphic_airtime_cue').on(t.overlayId, t.cueId, t.startedAt),
    foreignKey({ columns: [t.matchId, t.organisationId], foreignColumns: [matches.id, matches.organisationId] }).onDelete('cascade'),
    index('graphic_airtime_match_idx').on(t.matchId, t.startedAt),
  ],
);

/** A demo match that scores itself (worker-driven), for onboarding and training. */
export const demoRuns = pgTable(
  'demo_runs',
  {
    matchId: uuid('match_id').primaryKey(),
    organisationId: org(),
    status: text('status').notNull().default('running'), // running | paused | finished | stopped
    step: integer('step').notNull().default(0),
    speed: integer('speed').notNull().default(1), // 1 = real time per scripted step, 10 = ten times faster
    nextAt: ts('next_at').notNull().defaultNow(),
    startedBy: text('started_by'),
    startedAt: created(),
    updatedAt: updated(),
  },
  (t) => [foreignKey({ columns: [t.matchId, t.organisationId], foreignColumns: [matches.id, matches.organisationId] }).onDelete('cascade'), index('demo_runs_due_idx').on(t.status, t.nextAt)],
);

/** Billing state per organisation (provider-agnostic; Stripe is the first adapter). */
export const billingAccounts = pgTable('billing_accounts', {
  organisationId: uuid('organisation_id').primaryKey().references((): AnyPgColumn => organisations.id, { onDelete: 'restrict' }),
  provider: text('provider').notNull().default('stripe'),
  customerId: text('customer_id'),
  subscriptionId: text('subscription_id'),
  plan: text('plan').notNull().default('free'),
  status: text('status').notNull().default('none'), // none | trialing | active | past_due | cancelled
  currentPeriodEnd: ts('current_period_end'),
  /** monthly | yearly, for a Stripe subscription */
  interval: text('interval'),
  /** the subscription ends at currentPeriodEnd instead of renewing */
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  lastEventId: text('last_event_id'),
  /**
   * A plan given by site staff: it takes precedence over `plan` (the paid or owner-chosen one) until grantEndsAt
   * (null = permanent), when the worker removes it and the organisation goes back to `plan`.
   */
  grantPlan: text('grant_plan'),
  grantEndsAt: ts('grant_ends_at'),
  grantedBy: text('granted_by'),
  grantedAt: ts('granted_at'),
  grantReason: text('grant_reason'),
  updatedAt: updated(),
});

/** Database backup runs (worker-only; not tenant data). */
export const backupRuns = pgTable('backup_runs', {
  id: pk(),
  status: text('status').notNull(), // running | ok | failed
  location: text('location'),
  bytes: bigint('bytes', { mode: 'number' }),
  error: text('error'),
  startedAt: created(),
  finishedAt: ts('finished_at'),
});
