import Link from 'next/link';

const features = [
  ['Score once', 'A courtside scorer records each event once. Score, clock and stats update everywhere, with offline protection.'],
  ['Broadcast graphics', 'Three original themes: scorebugs, lineups, events, lower thirds, stats and slates, controlled live or automated.'],
  ['Automation', 'Graphics follow the scorer: lineups before kick-off, the goal strap on a goal, the half-time board. Rehearse the plan before match day.'],
  ['Sponsors', 'Campaigns, weighted rotation and placement rules, with honest delivery reports from render evidence.'],
  ['Cloud programme', 'Bring an RTMP camera feed, composite graphics in the cloud, stream to up to three destinations and record.'],
  ['Highlights', 'Event clips land in the media library while the match is live. Trim, crop for social, brand and export.'],
];

export default function Landing() {
  const name = process.env.NEXT_PUBLIC_PRODUCT_NAME;
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid size-7 place-items-center rounded bg-primary text-bg">▶</span>
          {name}
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/login" className="rounded-md px-3 py-2 text-muted hover:text-text">Log in</Link>
          <Link href="/register" className="rounded-md bg-primary px-3 py-2 font-semibold text-bg">Create account</Link>
        </nav>
      </header>
      <section className="py-16">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">Run sports broadcasts from your browser.</h1>
        <p className="mt-4 max-w-xl text-muted">Prepare fixtures, score matches, operate graphics, automate the show, deliver sponsors, then stream, record and clip highlights.</p>
        <div className="mt-8 flex gap-3">
          <Link href="/register" className="rounded-md bg-primary px-4 py-2.5 font-semibold text-bg">Get started</Link>
          <Link href="/login" className="rounded-md border border-border px-4 py-2.5">Log in</Link>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map(([t, b]) => (
          <div key={t} className="rounded-[var(--radius-card)] border border-border bg-panel p-4">
            <h2 className="font-medium">{t}</h2>
            <p className="mt-1 text-sm text-muted">{b}</p>
          </div>
        ))}
      </section>
      <footer className="mt-16 text-xs text-muted">Football and basketball in this release. Self-hostable; no payment needed for self-hosted installs.</footer>
    </main>
  );
}
