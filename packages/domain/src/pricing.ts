// MatchFrame hosted plans and optional services: one catalogue for the public pricing page, the in-app plan
// screen and billing. Prices are whole dollars as published; yearly prices are ten months of the monthly price.

export type PaidPlanKey = 'starter' | 'club' | 'studio' | 'league';
export type PlanKey = 'free' | PaidPlanKey;
export type BillingInterval = 'monthly' | 'yearly';

export interface PricePlan {
  key: PaidPlanKey;
  name: string;
  audience: string;
  /** null: quoted (League / Enterprise) */
  monthly: number | null;
  yearly: number | null;
  /** "from $499/month" plans */
  fromMonthly?: number;
  popular?: boolean;
  /** online checkout; quoted plans go through a conversation instead */
  selfServe: boolean;
  /** null: agreed in the quote */
  limits: { liveMatches: number | null; staffAccounts: number | null };
  features: string[];
}

export const PRICE_PLANS: PricePlan[] = [
  {
    key: 'starter',
    name: 'Starter',
    audience: 'For individual teams and occasional broadcasters.',
    monthly: 29,
    yearly: 290,
    selfServe: true,
    limits: { liveMatches: 1, staffAccounts: 3 },
    features: [
      '1 simultaneous live match',
      '3 staff accounts',
      'Access to all supported sports',
      'Unlimited fixture preparation and rehearsals',
      'Live scoreboard, match clock and basic match graphics',
      'Custom team names, logos and colours',
      'Manual graphics controls',
      'One static sponsor placement',
      'Watermark-free graphics output for supported production software',
      'Documentation and standard email support',
    ],
  },
  {
    key: 'club',
    name: 'Club',
    audience: 'For clubs broadcasting regularly and wanting a more complete presentation.',
    monthly: 79,
    yearly: 790,
    popular: true,
    selfServe: true,
    limits: { liveMatches: 2, staffAccounts: 10 },
    features: [
      '2 simultaneous live matches',
      '10 staff accounts',
      'Access to all supported sports',
      'Unlimited fixture preparation and rehearsals',
      'Full standard graphics package: scoreboards, clocks, lineups, lower thirds, supported match-event graphics, statistics and match summary screens',
      'Custom team names, logos and colours',
      'Manual graphics controls and event-triggered automation',
      'Multiple sponsor placements with automatic rotation',
      'Sponsor placement and delivery reports',
      'Watermark-free graphics output for supported production software',
      'Documentation and standard email support',
    ],
  },
  {
    key: 'studio',
    name: 'Studio',
    audience: 'For production companies, larger clubs and organisations covering several matches.',
    monthly: 199,
    yearly: 1990,
    selfServe: true,
    limits: { liveMatches: 5, staffAccounts: 25 },
    features: [
      '5 simultaneous live matches',
      '25 staff accounts',
      'Access to all supported sports',
      'Unlimited fixture preparation and rehearsals',
      'Full standard graphics package: scoreboards, clocks, lineups, lower thirds, supported match-event graphics, statistics and match summary screens',
      'Multiple saved branding profiles for different clubs or productions',
      'Manual graphics controls and event-triggered automation',
      'Reusable production sequences for pre-match, half-time and post-match coverage',
      'Multiple sponsor campaigns, automatic rotation and expanded reporting',
      'Watermark-free graphics output for supported production software',
      'Documentation and priority email support during published business hours',
    ],
  },
  {
    key: 'league',
    name: 'League / Enterprise',
    audience: 'For organisations whose requirements exceed Studio.',
    monthly: null,
    yearly: null,
    fromMonthly: 499,
    selfServe: false,
    limits: { liveMatches: null, staffAccounts: null },
    features: [
      'Studio’s graphics, scoring, automation and sponsorship features',
      'Higher simultaneous-match and staff-account allowances, agreed in the quote',
      'Organisation-wide branding and production configuration',
      'Guided onboarding',
      'A separately agreed support arrangement',
      'Custom integrations and development quoted according to scope',
    ],
  },
];

export interface OptionalService {
  key: string;
  name: string;
  price: string;
  covers: string;
}

export const OPTIONAL_SERVICES: OptionalService[] = [
  { key: 'cloud-production', name: 'Cloud video production', price: '$10 per production hour', covers: 'One video input, output up to 1080p30 and delivery to up to three external streaming destinations' },
  { key: 'onboarding', name: 'Guided onboarding', price: '$149 once', covers: 'Up to one hour helping configure branding, a sample fixture and the production workflow' },
  { key: 'custom-graphics', name: 'Custom graphics design', price: 'Quoted per project', covers: 'Bespoke graphics beyond the included standard themes' },
];

/** Plan differences, row by row, for the comparison table (the same facts as each plan's feature list). */
export interface PlanComparisonRow {
  label: string;
  /** per plan: true (included), false (not included) or the words to show */
  values: Record<PaidPlanKey, boolean | string>;
}
export const PLAN_COMPARISON: { group: string; rows: PlanComparisonRow[] }[] = [
  {
    group: 'Allowances',
    rows: [
      { label: 'Simultaneous live matches', values: { starter: '1', club: '2', studio: '5', league: 'Agreed in quote' } },
      { label: 'Staff accounts', values: { starter: '3', club: '10', studio: '25', league: 'Agreed in quote' } },
      { label: 'All supported sports', values: { starter: true, club: true, studio: true, league: true } },
      { label: 'Unlimited fixture preparation and rehearsals', values: { starter: true, club: true, studio: true, league: true } },
    ],
  },
  {
    group: 'Graphics and scoring',
    rows: [
      { label: 'Live scoreboard and match clock', values: { starter: true, club: true, studio: true, league: true } },
      { label: 'Graphics package', values: { starter: 'Basic match graphics', club: 'Full standard package', studio: 'Full standard package', league: 'Full standard package' } },
      { label: 'Custom team names, logos and colours', values: { starter: true, club: true, studio: true, league: true } },
      { label: 'Several saved branding profiles', values: { starter: false, club: false, studio: true, league: 'Organisation-wide' } },
      { label: 'Watermark-free output', values: { starter: true, club: true, studio: true, league: true } },
    ],
  },
  {
    group: 'Automation and production',
    rows: [
      { label: 'Manual graphics controls', values: { starter: true, club: true, studio: true, league: true } },
      { label: 'Event-triggered automation', values: { starter: false, club: true, studio: true, league: true } },
      { label: 'Reusable pre-match, half-time and post-match sequences', values: { starter: false, club: false, studio: true, league: true } },
    ],
  },
  {
    group: 'Sponsors',
    rows: [
      { label: 'Sponsor placements', values: { starter: 'One static placement', club: 'Several, rotating', studio: 'Several campaigns, rotating', league: 'Several campaigns, rotating' } },
      { label: 'Delivery reports', values: { starter: false, club: true, studio: 'Expanded', league: 'Expanded' } },
    ],
  },
  {
    group: 'Help',
    rows: [
      { label: 'Documentation', values: { starter: true, club: true, studio: true, league: true } },
      { label: 'Support', values: { starter: 'Standard email', club: 'Standard email', studio: 'Priority email', league: 'Agreed arrangement' } },
      { label: 'Guided onboarding', values: { starter: 'Optional, $149', club: 'Optional, $149', studio: 'Optional, $149', league: 'Included' } },
    ],
  },
];

/**
 * Currency and tax as the owner has confirmed them. null: not confirmed, so the site shows dollar amounts as
 * published and says that checkout shows the currency, any tax and the total before payment. Set these (for
 * example 'AUD' and 'Prices include GST') once the Stripe prices and tax settings are final.
 */
export const PRICE_TERMS: { currency: string | null; tax: string | null } = { currency: null, tax: null };

export const pricePlan = (key: string) => PRICE_PLANS.find((p) => p.key === key);

/** "$29/month or $290/year", "From $499/month". */
export function priceLabel(p: PricePlan) {
  if (p.monthly == null) return p.fromMonthly ? `From $${p.fromMonthly.toLocaleString('en-AU')}/month` : 'Quoted';
  return `$${p.monthly.toLocaleString('en-AU')}/month or $${(p.yearly ?? p.monthly * 12).toLocaleString('en-AU')}/year`;
}

/** Months saved by paying yearly (whole months), e.g. 2 for $290 against $29 a month. */
export function monthsFreeYearly(p: PricePlan) {
  if (p.monthly == null || p.yearly == null) return 0;
  return Math.round((p.monthly * 12 - p.yearly) / p.monthly);
}
