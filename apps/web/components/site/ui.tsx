// Building blocks for the public site: page sections, headings, badges, link buttons and a tiny inline markup
// renderer for content files ([label](/href), **bold**, `code`). Server components; no client JavaScript.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AVAILABILITY_LABEL, type Availability } from '@/content/site';

export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function Section({ id, children, className = '', tone = 'plain' }: { id?: string; children: ReactNode; className?: string; tone?: 'plain' | 'panel' }) {
  return (
    <section id={id} className={`scroll-mt-20 py-14 sm:py-20 ${tone === 'panel' ? 'border-y border-white/5 bg-white/[0.02]' : ''} ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">{children}</p>;
}

export function H1({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h1 className={`font-brand text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl ${className}`}>{children}</h1>;
}

export function H2({ children, id, className = '' }: { children: ReactNode; id?: string; className?: string }) {
  return <h2 id={id} className={`font-brand text-2xl font-bold tracking-tight text-white sm:text-3xl ${className}`}>{children}</h2>;
}

export function Lead({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`max-w-2xl text-base leading-relaxed text-muted sm:text-lg ${className}`}>{children}</p>;
}

export function PageIntro({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="border-b border-white/5 bg-[radial-gradient(ellipse_at_top,rgba(43,92,255,0.18),transparent_60%)]">
      <Container className="py-14 sm:py-20">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <H1 className="mt-3 max-w-3xl">{title}</H1>
        {children ? <div className="mt-5">{children}</div> : null}
      </Container>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-white/10 bg-panel/70 p-5 ${className}`}>{children}</div>;
}

const TONE: Record<string, string> = {
  available: 'border-healthy/40 bg-healthy/10 text-healthy',
  tested: 'border-healthy/40 bg-healthy/10 text-healthy',
  beta: 'border-warning/40 bg-warning/10 text-warning',
  'media-server': 'border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan',
  planned: 'border-warning/40 bg-warning/10 text-warning',
  no: 'border-white/15 bg-white/5 text-muted',
  neutral: 'border-white/15 bg-white/5 text-muted',
};

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof TONE | string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE[tone] ?? TONE.neutral}`}>{children}</span>;
}

export function AvailabilityBadge({ value }: { value: Availability | 'no' }) {
  return <Badge tone={value}>{value === 'no' ? 'Not on this edition' : AVAILABILITY_LABEL[value]}</Badge>;
}

export function ButtonLink({ href, children, variant = 'primary', className = '' }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost'; className?: string }) {
  const style =
    variant === 'primary'
      ? 'bg-brand-cyan text-brand-navy hover:bg-white'
      : variant === 'secondary'
        ? 'border border-white/20 text-white hover:border-brand-cyan hover:text-brand-cyan'
        : 'text-brand-cyan hover:text-white';
  return (
    <Link href={href} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition ${style} ${className}`}>
      {children}
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
          <a key={k++} href={m[2]} className="text-brand-cyan underline-offset-2 hover:underline" rel="noopener noreferrer">
            {m[1]}
          </a>
        ) : (
          <Link key={k++} href={m[2]} className="text-brand-cyan underline-offset-2 hover:underline">
            {m[1]}
          </Link>
        ),
      );
    } else if (m[3]) out.push(<strong key={k++} className="font-semibold text-white">{m[3]}</strong>);
    else if (m[4]) out.push(<code key={k++} className="rounded bg-white/10 px-1 py-0.5 text-[0.9em]">{m[4]}</code>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/** Plain text of inline markup, for search indexes and meta descriptions. */
export function plain(text: string) {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}
