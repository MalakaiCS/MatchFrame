// Public navigation, shared by the header, the mobile menu, the footer and the sitemap.
export interface NavLink {
  label: string;
  href: string;
  note?: string;
}
export interface NavGroup {
  label: string;
  links: NavLink[];
}

export const NAV: (NavGroup | NavLink)[] = [
  {
    label: 'Product',
    links: [
      { label: 'Features', href: '/features', note: 'Everything MatchFrame does, and where it is available' },
      { label: 'How it works', href: '/how-it-works', note: 'Before the match, during it and after' },
      { label: 'Graphics showcase', href: '/showcase', note: 'Every graphic in every look, live' },
    ],
  },
  {
    label: 'Sports',
    links: [
      { label: 'Football', href: '/sports/football', note: 'Tested end to end' },
      { label: 'Basketball', href: '/sports/basketball', note: 'Tested end to end' },
      { label: 'All sports', href: '/sports', note: 'Netball, rugby league, AFL and hockey in beta' },
    ],
  },
  { label: 'Pricing', href: '/pricing' },
  {
    label: 'Resources',
    links: [
      { label: 'Documentation', href: '/docs', note: 'Set up your first match and fix common problems' },
      { label: 'FAQ', href: '/faq', note: 'Equipment, sports, connectivity and pricing questions' },
    ],
  },
  { label: 'Contact', href: '/contact' },
];

export const FOOTER: NavGroup[] = [
  { label: 'Product', links: [{ label: 'Features', href: '/features' }, { label: 'How it works', href: '/how-it-works' }, { label: 'Graphics showcase', href: '/showcase' }, { label: 'Pricing', href: '/pricing' }] },
  { label: 'Sports', links: [{ label: 'Football', href: '/sports/football' }, { label: 'Basketball', href: '/sports/basketball' }, { label: 'All sports', href: '/sports' }] },
  { label: 'Help', links: [{ label: 'Documentation', href: '/docs' }, { label: 'First match guide', href: '/docs/getting-started/first-match' }, { label: 'FAQ', href: '/faq' }, { label: 'System status', href: '/status' }] },
  { label: 'MatchFrame', links: [{ label: 'Contact', href: '/contact' }, { label: 'Self-hosting', href: '/pricing#self-hosting' }, { label: 'Log in', href: '/login' }, { label: 'Create an account', href: '/register' }] },
];

export const isGroup = (x: NavGroup | NavLink): x is NavGroup => 'links' in x;
