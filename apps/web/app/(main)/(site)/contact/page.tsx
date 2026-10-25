import Link from 'next/link';
import { BookOpen, Clock, LifeBuoy, ShieldCheck } from 'lucide-react';
import { ContactForm } from '@/components/site/contact-form';
import { Container, Eyebrow } from '@/components/site/ui';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'Contact',
  description: 'Contact the MatchFrame team about the product, setup help, pricing for your season or a partnership. Matchday problems: start with the troubleshooting guides.',
  path: '/contact',
});

export default function ContactPage() {
  return (
    <Container className="py-10 sm:py-14">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:gap-14">
        <div>
          <Eyebrow>Contact</Eyebrow>
          <h1 className="mt-3 font-brand text-[34px] font-bold leading-[1.08] tracking-[-0.02em] text-text sm:text-5xl">Talk to the MatchFrame team</h1>
          <p className="mt-3 max-w-xl text-muted sm:text-lg">Questions about the product, help with a setup, pricing for your season, or a partnership. We reply by email.</p>
          <div className="mt-8">
            <ContactForm />
          </div>
        </div>
        <aside className="space-y-4 lg:pt-28">
          <div className="rounded-2xl border border-border bg-panel p-5 shadow-card">
            <h2 className="flex items-center gap-2 font-semibold text-text"><LifeBuoy className="size-5 text-primary" aria-hidden /> Problem during a match?</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">We do not offer live matchday support. The troubleshooting guides go through what to check, in order:</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              <li><Link href="/docs/troubleshooting/graphics-not-visible" className="font-medium text-primary hover:underline">Graphics are not showing</Link></li>
              <li><Link href="/docs/troubleshooting/connection-loss" className="font-medium text-primary hover:underline">The connection dropped</Link></li>
              <li><Link href="/docs/scoring/corrections" className="font-medium text-primary hover:underline">The score looks wrong</Link></li>
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-panel p-5 shadow-card">
            <h2 className="flex items-center gap-2 font-semibold text-text"><BookOpen className="size-5 text-primary" aria-hidden /> Setting up?</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">The <Link href="/docs/getting-started/first-match" className="font-medium text-primary hover:underline">first match guide</Link> takes you from a new account to graphics in OBS. The <Link href="/faq" className="font-medium text-primary hover:underline">FAQ</Link> answers equipment and pricing questions.</p>
          </div>
          <div className="rounded-2xl border border-border p-5">
            <h2 className="flex items-center gap-2 font-semibold text-text"><ShieldCheck className="size-5 text-primary" aria-hidden /> What happens to your message</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">It is stored in MatchFrame so the team can read it and reply to you, and emailed to the team's inbox when one is set up. It is deleted automatically 12 months after it arrives. We do not add you to a mailing list. More in the <Link href="/privacy" className="font-medium text-primary hover:underline">Privacy Policy</Link>.</p>
            <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Clock className="size-4" aria-hidden /> We reply by email; no response time is promised.</p>
          </div>
        </aside>
      </div>
    </Container>
  );
}
