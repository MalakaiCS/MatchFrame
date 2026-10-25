import { LegalDocument } from '@/components/site/legal';
import { TERMS } from '@/content/legal';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'Terms and Conditions',
  description: 'The terms for using MatchFrame: accounts and organisations, plans and payments, your content and broadcast rights, acceptable use, live production and liability.',
  path: '/terms',
});

export default function TermsPage() {
  return <LegalDocument title="Terms and Conditions" lead="The agreement between you and MatchFrame for using the website, the scorer app, the graphics and the rest of the service." sections={TERMS} />;
}
