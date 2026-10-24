// Building blocks for the public site: page sections, headings, status badges, link buttons and a tiny inline
// markup renderer for content files ([label](/href), **bold**, `code`). Server components; no client JavaScript.
// Colours come from the theme tokens, so every block reads in light and dark mode.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CheckCircle2, Clock3, FlaskConical, Server } from 'lucide-react';
import { AVAILABILITY_LABEL, type Availability } from '@/content/site';

/** ~1,200 px of content, 20 px gutters on phones and 32–48 px on larger screens. */
export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1248px] px-5 sm:px-8 lg:px-12 ${className}`}>{children}</div>;
}

export function Section({ id, children, className = '', tone = 'plain', labelledBy }: { id?: string; children: ReactNode; className?: string; tone?: 'plain' | 'raised'; labelledBy?: string }) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`scroll-mt-20 py-12 sm:py-20 lg:py-24 ${tone === 'raised' ? 'border-y border-border bg-panel/60' : ''} ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-xs font-semibold uppercase tracking-[0.18em] text-primary ${className}`}>{children}</p>;
}

export function H1({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h1 className={`font-brand text-[38px] font-bold leading-[1.04] tracking-[-0.02em] text-text sm:text-5xl lg:text-[60px] ${className}`}>{children}</h1>;
}

export function H2({ children, id, className = '' }: { children: ReactNode; id?: string; className?: string }) {
  return <h2 id={id} className={`font-brand text-[28px] font-bold leading-tight tracking-[-0.015em] text-text sm:text-4xl ${className}`}>{children}</h2>;
}

export function H3({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h3 className={`font-brand text-lg font-semibold text-text sm:text-xl ${className}`}>{children}</h3>;
}

export function Lead({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`max-w-2xl text-base leading-[1.65] text-muted sm:text-lg ${className}`}>{children}</p>;
}

/** Eyebrow, heading and one or two lines, with an optional action on the right. */
export function SectionHeading({ eyebrow, title, id, children, action, className = '' }: { eyebrow?: string; title: ReactNode; id?: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-x-8 gap-y-4 ${className}`}>
      <div className="max-w-2xl">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <H2 id={id} className={eyebrow ? 'mt-3' : ''}>{title}</H2>
        {children ? <div className="mt-4 text-base leading-[1.65] text-muted sm:text-lg">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

/** A compact page opening: the decision-making content follows straight after. */
export function PageIntro({ eyebrow, title, children, aside }: { eyebrow?: string; title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="relative overflow-hidden border-b border-border">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_120%_at_10%_0%,color-mix(in_oklab,var(--color-primary)_14%,transparent),transparent_70%)]" />
      <Container className={`relative py-10 sm:py-14 ${aside ? 'grid items-end gap-8 lg:grid-cols-[1fr_auto]' : ''}`}>
        <div>
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <H1 className="mt-3 max-w-3xl !text-[34px] sm:!text-5xl">{title}</H1>
          {children ? <div className="mt-4">{children}</div> : null}
        </div>
        {aside}
      </Container>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-panel p-6 shadow-card ${className}`}>{children}</div>;
}

const TONE: Record<string, string> = {
  available: 'border-healthy/40 bg-healthy/10 text-healthy',
  beta: 'border-warning/45 bg-warning/10 text-warning',
  'media-server': 'border-primary/40 bg-primary/10 text-primary',
  planned: 'border-border-strong/60 bg-elevated text-muted',
  no: 'border-border bg-elevated text-muted',
  neutral: 'border-border bg-elevated text-muted',
  accent: 'border-primary/50 bg-primary/10 text-primary',
};
const ICON: Partial<Record<string, typeof CheckCircle2>> = { available: CheckCircle2, beta: FlaskConical, 'media-server': Server, planned: Clock3 };

/** A status label: always words, with an icon, never colour alone. */
export function Badge({ tone = 'neutral', children, className = '' }: { tone?: string; children: ReactNode; className?: string }) {
  const I = ICON[tone];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE[tone] ?? TONE.neutral} ${className}`}>
      {I ? <I className="size-3.5" aria-hidden /> : null}
      {children}
    </span>
  );
}

export function AvailabilityBadge({ value }: { value: Availability | 'no' }) {
  return <Badge tone={value}>{value === 'no' ? 'Not included' : AVAILABILITY_LABEL[value]}</Badge>;
}

const BUTTON = {
  primary: 'bg-primary text-on-primary shadow-sm hover:bg-primary-strong',
  secondary: 'border border-border-strong/70 bg-panel text-text hover:border-primary hover:text-primary',
  ghost: 'text-primary hover:bg-primary/10',
} as const;

export function ButtonLink({ href, children, variant = 'primary', className = '', size = 'md' }: { href: string; children: ReactNode; variant?: keyof typeof BUTTON; className?: string; size?: 'md' | 'lg' }) {
  return (
    <Link href={href} className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition ${size === 'lg' ? 'min-h-12 px-6 text-[15px]' : 'min-h-11 px-5 text-sm'} ${BUTTON[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/** An inline "Learn more →" style link. */
export function ArrowLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`group inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline hover:underline-offset-4 ${className}`}>
      {children}
      <span aria-hidden className="transition group-hover:translate-x-0.5">→</span>
    </Link>
  );
}

/** Inline markup used by the FAQ and docs content: [label](/href), **bold** and `code`. Plain text otherwise. */
export function Rich({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] && m[2]) {
      const external = /^https?:\/\//.test(m[2]);
      out.push(
        external ? (
          <a key={k++} href={m[2]} className="font-medium text-primary underline-offset-2 hover:underline" rel="noopener noreferrer">
            {m[1]}
          </a>
        ) : (
          <Link key={k++} href={m[2]} className="font-medium text-primary underline-offset-2 hover:underline">
            {m[1]}
          </Link>
        ),
      );
    } else if (m[3]) out.push(<strong key={k++} className="font-semibold text-text">{m[3]}</strong>);
    else if (m[4]) out.push(<code key={k++} className="rounded bg-elevated px-1 py-0.5 text-[0.9em] text-text">{m[4]}</code>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/** Plain text of inline markup, for search indexes and meta descriptions. */
export function plain(text: string) {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}
