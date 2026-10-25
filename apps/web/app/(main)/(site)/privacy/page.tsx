import { LegalDocument } from '@/components/site/legal';
import { PRIVACY } from '@/content/legal';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'Privacy Policy',
  description: 'What MatchFrame collects, why, who it is shared with, how long it is kept, the cookies it uses and your choices.',
  path: '/privacy',
});

export default function PrivacyPage() {
  return <LegalDocument title="Privacy Policy" lead="What MatchFrame collects when you use it, what it is used for, who else handles it and the choices you have." sections={PRIVACY} />;
}
