import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Badge, Card, Lead, PageIntro, Section } from '@/components/site/ui';
import { SPORTS, SPORT_STATUS_LABEL, SPORT_STATUS_NOTE } from '@/content/site';
import { siteMetadata } from '@/lib/site-meta';

export const metadata = siteMetadata({
  title: 'Sports',
  description: 'Football and basketball are tested end to end in MatchFrame; netball, rugby league, AFL and hockey are in beta.',
  path: '/sports',
});

export default function SportsPage() {
  return (
    <>
      <PageIntro eyebrow="Sports" title="Six sports, one scorer and one set of graphics">
        <Lead>Every sport shares the same scorer app, graphics and automation. What differs is the rule set (periods, clocks and scoring), the event buttons and the wording on air.</Lead>
      </PageIntro>
      <Section>
        <div className="grid gap-4 md:grid-cols-2">
          {(['tested', 'beta'] as const).map((st) => (
            <Card key={st}>
              <Badge tone={st}>{SPORT_STATUS_LABEL[st]}</Badge>
              <p className="mt-3 text-sm text-muted">{SPORT_STATUS_NOTE[st]}</p>
            </Card>
          ))}
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SPORTS.map((s) => (
            <Card key={s.key} className="flex flex-col">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-brand text-xl font-semibold text-white">{s.name}</h2>
                <Badge tone={s.status}>{SPORT_STATUS_LABEL[s.status]}</Badge>
              </div>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-muted"><strong className="text-white/90">Records:</strong> {s.scoring}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted"><strong className="text-white/90">Scorebug:</strong> {s.scorebug}</p>
              {s.status === 'tested' ? (
                <Link href={`/sports/${s.key}`} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-cyan hover:text-white">
                  {s.name} in detail <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              ) : null}
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
