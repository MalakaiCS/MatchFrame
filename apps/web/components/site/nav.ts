// Public navigation, shared by the header, the mobile menu, the footer and the sitemap.
import type { LucideIcon } from 'lucide-react';
import { BookOpen, CircleHelp, ListChecks, PlayCircle, Sparkles, Workflow } from 'lucide-react';

export interface NavLink {
  label: string;
  href: string;
  note?: string;
  icon?: LucideIcon;
}
export interface NavGroup {
  label: string;
  links: NavLink[];
}

export const NAV: (NavGroup | NavLink)[] = [
  {
    label: 'Product',
    links: [
      { label: 'Try the live demo', href: '/showcase', note: 'Every graphic in every look, drawn live in your browser', icon: PlayCircle },
      { label: 'Features', href: '/features', note: 'Scoring, graphics, automation and sponsors, and where each is available', icon: Sparkles },
      { label: 'How it works', href: '/how-it-works', note: 'Prepare the match, run it from a phone and OBS, share the moments', icon: Workflow },
    ],
  },
  {
    label: 'Sports',
    links: [
      { label: 'Football', href: '/sports/football', note: 'Available' },
      { label: 'Basketball', href: '/sports/basketball', note: 'Available' },
      { label: 'Futsal', href: '/sports/futsal', note: 'Beta' },
      { label: 'All seven sports', href: '/sports', note: 'Netball, rugby league, AFL and hockey are in beta too' },
    ],
  },
  { label: 'Pricing', href: '/pricing' },
  {
    label: 'Resources',
    links: [
      { label: 'Documentation', href: '/docs', note: 'Set up your first match and fix common problems', icon: BookOpen },
      { label: 'First match guide', href: '/docs/getting-started/first-match', note: 'From a new account to graphics in OBS, step by step', icon: ListChecks },
      { label: 'FAQ', href: '/faq', note: 'Equipment, sports, connectivity and pricing questions', icon: CircleHelp },
    ],
  },
  { label: 'Contact', href: '/contact' },
];

export const FOOTER: NavGroup[] = [
  { label: 'Product', links: [{ label: 'Live demo', href: '/showcase' }, { label: 'Features', href: '/features' }, { label: 'How it works', href: '/how-it-works' }, { label: 'Pricing', href: '/pricing' }] },
  { label: 'Sports', links: [{ label: 'Football', href: '/sports/football' }, { label: 'Basketball', href: '/sports/basketball' }, { label: 'Futsal', href: '/sports/futsal' }, { label: 'All sports', href: '/sports' }] },
  { label: 'Help', links: [{ label: 'Documentation', href: '/docs' }, { label: 'First match guide', href: '/docs/getting-started/first-match' }, { label: 'Matchday troubleshooting', href: '/docs#troubleshooting' }, { label: 'FAQ', href: '/faq' }, { label: 'System status', href: '/status' }] },
  { label: 'Account', links: [{ label: 'Contact us', href: '/contact' }, { label: 'Log in', href: '/login' }, { label: 'Create an account', href: '/register' }, { label: 'Terms and Conditions', href: '/terms' }, { label: 'Privacy Policy', href: '/privacy' }] },
];

export const isGroup = (x: NavGroup | NavLink): x is NavGroup => 'links' in x;
