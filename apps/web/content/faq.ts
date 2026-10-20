// FAQ content. Answers are paragraphs with inline markup ([label](/href), **bold**). Each answer was written from
// the product as it is today (code, guides and recorded tests); `basis` records where it came from so it can be
// re-checked when the product changes. Questions that need an owner decision (prices, terms, ownership) say so
// rather than guessing.
export type FaqCategory = 'getting-started' | 'graphics-scoring' | 'production' | 'sponsors-highlights' | 'accounts-pricing' | 'support';

export const FAQ_CATEGORIES: { key: FaqCategory; label: string }[] = [
  { key: 'getting-started', label: 'Getting started' },
  { key: 'graphics-scoring', label: 'Graphics and scoring' },
  { key: 'production', label: 'Production and connectivity' },
  { key: 'sponsors-highlights', label: 'Sponsors and highlights' },
  { key: 'accounts-pricing', label: 'Accounts and pricing' },
  { key: 'support', label: 'Support' },
];

export interface Faq {
  id: string;
  category: FaqCategory;
  q: string;
  a: string[];
  /** shown on the homepage */
  home?: boolean;
  basis: string;
}

export const FAQS: Faq[] = [
  // ------------------------------------------------------------------ getting started
  {
    id: 'what-is-matchframe',
    category: 'getting-started',
    q: 'What is MatchFrame?',
    a: [
      'MatchFrame brings live scoring, broadcast graphics, automation and sponsor placements into one matchday workflow. A scorer records the match once on a phone, and the scorebug, the event graphics, the half-time boards and the sponsor reports all follow from that one record.',
      'Take the [product tour](/features), or try the [graphics showcase](/showcase) to see every graphic in every look.',
    ],
    home: true,
    basis: 'Product scope; operator guide.',
  },
  {
    id: 'who-is-it-for',
    category: 'getting-started',
    q: 'Who is MatchFrame for?',
    a: [
      '**Clubs and volunteers** who stream their own games and want them to look like a real broadcast without a big crew: one scorer and one person at the streaming computer is enough, with automation doing the routine graphics.',
      '**Competitions** that want the same look across their fixtures: a look and an automation plan can be set once for a competition, and each match gets its own scorer link, graphics output and control room. A producer board shows every live match together.',
      '**Production crews** who want graphics they control from a browser, with a preview before anything goes to air, keyboard shortcuts and Stream Deck buttons.',
    ],
    basis: 'Operator guide: competition defaults, producer board, hotkeys.',
  },
  {
    id: 'which-sports',
    category: 'getting-started',
    q: 'Which sports are supported?',
    a: [
      '**Football and basketball** have been tested end to end: a full match, including the unusual cases such as extra time, penalty shoot-outs, overtime, fouls and timeouts, has been played through the scorer, graphics and automation.',
      '**Netball, rugby league, AFL and hockey** are in beta. Their rules, events and graphics are built and covered by automated checks, but a full match has not yet been run end to end, so rehearse before relying on them. See [all sports](/sports).',
    ],
    home: true,
    basis: 'Acceptance checks A07 (football) and A08 (basketball); sport adapter unit tests and visual baselines for the other four.',
  },
  {
    id: 'need-a-camera',
    category: 'getting-started',
    q: 'Do I need a camera?',
    a: [
      'Yes. MatchFrame makes the graphics and runs the match information; it does not film the game.',
      'With the hosted edition you bring a camera and streaming software such as OBS Studio, and add the MatchFrame graphics page over your camera picture. With a self-hosted deployment that includes the media server, a camera or encoder sends a feed to MatchFrame and the graphics are added in the cloud. [Choose a workflow](/docs/production/choose-a-workflow).',
    ],
    home: true,
    basis: 'Hosted graphics edition (deploy guide); cloud production checks A35–A37.',
  },
  {
    id: 'broadcast-experience',
    category: 'getting-started',
    q: 'Do I need broadcasting experience?',
    a: [
      'No. A first-time operator needs to learn three things: entering line-ups, pressing the scorer app\'s phase buttons (Pre-match, Players entering, 1st Half and so on) as the match goes, and adding the graphics page to OBS once. Automation handles the routine graphics from there.',
      'You stay responsible for the camera, the stream and anything you want on air beyond the automatic graphics. Run a [rehearsal](/docs/getting-started/rehearsal) before your first live match.',
    ],
    basis: 'Scorer guide; automation starter plans.',
  },
  {
    id: 'equipment',
    category: 'getting-started',
    q: 'What equipment do I need?',
    a: [
      '**Hosted edition with OBS:** a computer running OBS Studio that receives your camera (for example through a USB or HDMI capture device), a phone or tablet for the scorer, and an internet connection for both. Your stream goes out from OBS to YouTube, Facebook or another platform.',
      '**Cloud production (self-hosted with the media server):** a camera or encoder that can send an RTMP feed, a phone or tablet for the scorer, and a laptop for the control room. MatchFrame adds the graphics and streams to your destinations.',
      'Details are in [requirements](/docs/getting-started/requirements).',
    ],
    home: true,
    basis: 'Deploy guide (graphics-only edition); streaming operator guide.',
  },
  {
    id: 'try-before-live',
    category: 'getting-started',
    q: 'Can I try it before a live match?',
    a: [
      'Yes, in three ways, none of which create a stream:',
      '**Rehearse** an automation plan against a made-up match: you see every graphic and the reason it would or would not run, and nothing is sent to an output. **Start a demo match** from the dashboard: it scores itself through the real scoring path at the speed you choose, is labelled Demo everywhere and is left out of tables and reports. And the [showcase](/showcase) plays every graphic in every look with sample teams.',
    ],
    basis: 'Rehearsal isolation (A29); demo match (operator guide).',
  },
  {
    id: 'setup-time',
    category: 'getting-started',
    q: 'How long does the first setup take?',
    a: [
      'We have not yet timed new users through a first setup, so we would rather not guess. Having these ready makes it quicker: your fixtures with dates, times and grounds (a CSV file can be imported, and it creates any teams it does not already know), your players\' names and numbers, and your logo and colours.',
      'The [first match guide](/docs/getting-started/first-match) walks through each step in order.',
    ],
    basis: 'Not measured; stated as such.',
  },
  // ------------------------------------------------------------------ graphics and scoring
  {
    id: 'which-graphics',
    category: 'graphics-scoring',
    q: 'What graphics are available?',
    a: [
      'Twenty-nine built-in graphics, in four looks: the scorebug (the on-screen score and clock), match header, animated background, team line-ups and formations, goal and score events, cards, substitutions, kick-off and period banners, lower thirds (name captions near the bottom of the picture), player cards, match statistics and live statistic comparisons, break and final scores, match summary, head to head and form, league table, fixtures and results, top scorers, player of the match, match information, shoot-out tracker, timeouts, sponsor graphics, stinger wipe, holding slate, full-frame media and a ticker.',
      'See them all, live, in the [showcase](/showcase).',
    ],
    home: true,
    basis: 'Graphics catalogue (29 templates); visual regression baselines.',
  },
  {
    id: 'club-branding',
    category: 'graphics-scoring',
    q: 'Can I use my club\'s branding?',
    a: [
      'Yes. Each look takes your logo, colours and team colours, and lets you choose the scorebug style and position, how the clock shows (with or without seconds, how added time reads), your own wording for on-air labels (useful for bilingual competitions), sounds on goals and cards, and a custom font.',
      'Logos and artwork upload to the asset library as PNG or JPEG images up to 25 megapixels; video as MP4 up to ten minutes. When two teams\' colours are too close, the away team switches to its alternate colours automatically.',
    ],
    basis: 'Look options (operator guide); upload limits (configuration).',
  },
  {
    id: 'manual-or-automatic',
    category: 'graphics-scoring',
    q: 'Are graphics controlled manually or automatically?',
    a: [
      'Both. Each output has an **Auto** and a **Manual** mode. In Auto, the automation plan puts graphics on air as the scorer records the match. In the control room an operator can prepare any graphic in a preview, edit it, then send it **To air** (F8) and take it **Out** (F9) at any time.',
      'Manual pauses automatic graphics without clearing what is on air. **Emergency clear** (press and hold) takes everything off and pauses automation until someone presses Resume. A playlist can also be set to wait for a producer to press **Send now**.',
    ],
    home: true,
    basis: 'Manual and Auto (A26), emergency clear (A27), approval mode.',
  },
  {
    id: 'wrong-score',
    category: 'graphics-scoring',
    q: 'What happens if I enter the wrong score?',
    a: [
      'Straight after an action an **Undo** button floats for a few seconds and needs no reason. Later, open the event under Recent and undo or correct it with a reason.',
      'A correction updates the score, the statistics and the graphics, takes off any automatic graphic that the mistaken event caused, and marks any highlight clip made from it as stale so it can be checked before publishing. Corrections are recorded in the match\'s activity with who made them.',
    ],
    basis: 'Correction withdraws automation (A12); stale clips (operator guide); scorer guide.',
  },
  {
    id: 'multiple-people',
    category: 'graphics-scoring',
    q: 'Can several people work on the same match?',
    a: [
      'Yes. Only one device controls the score at a time, so two people can never record conflicting scores; a producer can take control over with a reason, and anything the first device recorded offline then waits for review. Extra scorers can be given **statistics only**, which never changes the score or clock.',
      'Several operators can have the control room open for one output: each sees who else is there, and if someone is preparing the same layer, To air waits and says who. A read-only commentator view shows line-ups, events and statistics in large type.',
    ],
    basis: 'Scorer lease and takeover (A15); presence and locks; commentator view.',
  },
  {
    id: 'several-matches',
    category: 'graphics-scoring',
    q: 'Can I run more than one match at once?',
    a: [
      'Yes. Each match has its own scorer, graphics outputs and automation, kept separate from the others, and the producer board shows every live match on one screen. Plans include 1 (Starter), 2 (Club) or 5 (Studio) simultaneous live matches; League / Enterprise allowances are agreed in the quote.',
      'Graphics-only matches need little from the server. Cloud production is different: each programme uses real processing power, and how many can run together depends on the media server\'s hardware. Two 720p programmes overloaded our four-core test server, so measure on your own hardware first.',
    ],
    basis: 'Producer board; capacity check A51 (failed on a 4-core host).',
  },
  // ------------------------------------------------------------------ production and connectivity
  {
    id: 'obs',
    category: 'production',
    q: 'Does MatchFrame work with OBS?',
    a: [
      'Yes, that is the main way to use the hosted edition. Each match has a graphics link: in OBS add a **Browser Source** with that link at 1920×1080 (1080×1920 for a vertical output), and the graphics appear over your camera with a transparent background. You can also download a ready-made OBS scene collection.',
      'Our automated tests load the graphics page in Chromium, the engine OBS uses for browser sources, and check the transparency pixel by pixel. We have not yet certified particular OBS versions. Follow [Connect your graphics to OBS](/docs/graphics/first-output).',
    ],
    home: true,
    basis: 'Transparent output check A36; OBS scene collection download.',
  },
  {
    id: 'vmix-and-others',
    category: 'production',
    q: 'Does it work with vMix or other production tools?',
    a: [
      'The graphics output is an ordinary web page with a transparent background, so a tool that can show a web page as a layer can use it. The OBS link page also explains the vMix setup (a Web Browser input with the same link), but our tests cover the OBS-style browser source only, so rehearse with vMix or any other tool before relying on it.',
    ],
    basis: 'OBS link page instructions mention vMix; only the browser-source path is tested.',
  },
  {
    id: 'stream-directly',
    category: 'production',
    q: 'Can MatchFrame stream directly?',
    a: [
      'On a self-hosted deployment with the media server, yes: your camera or encoder sends an RTMP feed to MatchFrame, the graphics are added in the cloud, and the programme is streamed to your destinations and recorded. A programme monitor shows what actually went out.',
      'The hosted service does not stream yet: cloud video production is coming to it as an optional service at $10 per production hour. Until then you stream from OBS on your own computer with the graphics page added.',
    ],
    basis: 'RTMP in to programme out (A35); hosted edition has streaming turned off.',
  },
  {
    id: 'destinations',
    category: 'production',
    q: 'Can I stream to YouTube, Facebook or another platform?',
    a: [
      'Yes. With cloud production, each output can send to up to three destinations at once. For each one you paste the server URL and stream key from the platform\'s live dashboard (YouTube, Facebook and Twitch have their own fields; any RTMP destination works).',
      'Stream keys are stored encrypted, never shown in lists, logs or reports, and revealing one is recorded in the audit log. Private network addresses are refused as destinations. With the hosted edition, OBS streams to the platform and MatchFrame never sees your key.',
    ],
    basis: 'Three destinations (A33); secret handling (A53); private destinations refused (A48).',
  },
  {
    id: 'phone-tablet',
    category: 'production',
    q: 'Can I run it from a phone or tablet?',
    a: [
      'The **scorer app** is built for phones and tablets: large buttons, a sunlight mode for outdoor screens, vibration and sounds on each action, and a low data mode. Add it to the home screen and it opens even without a connection.',
      'The **control room** is designed for a laptop or desktop browser. The commentator view works well on a tablet. Our tests run in Chromium; other browsers are not yet formally tested.',
    ],
    basis: 'Scorer guide; phone-sized browser tests.',
  },
  {
    id: 'offline',
    category: 'production',
    q: 'Does it work without internet?',
    a: [
      '**Scoring keeps working offline.** Actions are saved on the phone and marked pending, you can even refresh the page, and when the connection returns they apply once, in order. If someone else changed the match meanwhile, each offline action waits for you to apply or discard it.',
      '**Graphics and streaming need a connection.** The graphics page receives every change over the internet, and a stream needs upload bandwidth. Check the venue connection in a [rehearsal](/docs/getting-started/rehearsal).',
    ],
    basis: 'Offline scoring (A14, A16); offline takeover review (A15).',
  },
  {
    id: 'connection-drops',
    category: 'production',
    q: 'What happens if the connection drops?',
    a: [
      '**Scorer phone:** keeps recording offline and catches up when it reconnects. **Your OBS stream:** OBS keeps streaming your camera; graphics changes resume when the OBS computer is back online. **Cloud production:** if the camera feed drops, a holding slate goes on air and the stream recovers when the feed returns (we measured 13 to 16 seconds); if MatchFrame\'s own servers restart, the stream keeps going.',
      'See [When the connection drops](/docs/troubleshooting/connection-loss) for what to check and in what order.',
    ],
    basis: 'Offline scorer (A14); source loss and recovery (A39); server restart during a stream (A50).',
  },
  {
    id: 'internet-speed',
    category: 'production',
    q: 'What internet speed do I need?',
    a: [
      'We have not measured a single number that would be true for every setup, so we do not publish one. The stream is the demanding part: follow your streaming platform\'s upload guidance for the quality you choose. The scorer app uses very little data, and its low data mode refreshes the score every ten seconds instead of keeping a live connection.',
      'Test the actual venue connection during a rehearsal, at the same time of day as the match if you can.',
    ],
    basis: 'Not measured; low data mode (scorer guide).',
  },
  {
    id: 'recording',
    category: 'production',
    q: 'Does MatchFrame record the broadcast?',
    a: [
      'With cloud production, yes: the programme is recorded and kept for the number of days set for the installation (90 by default). If the camera feed drops and returns, the recordings are kept.',
      'The hosted edition does not record; record in OBS on your own computer.',
    ],
    basis: 'Recording retention setting; recordings kept through source loss (A39).',
  },
  // ------------------------------------------------------------------ sponsors and highlights
  {
    id: 'sponsor-placements',
    category: 'sponsors-highlights',
    q: 'How do sponsor placements work?',
    a: [
      'You add each sponsor\'s artwork to the asset library and approve it, then set up campaigns: flight dates, priority, weighting, caps and spacing, and which placements they may use (the scorebug logo, lower-third banners, full-screen slots, or a "presented by" moment on goals and cards).',
      'MatchFrame rotates them for you. Each playlist has a priority: in the starter plans a goal interrupts a sponsor loop, and promotional items that lose out are skipped with the reason recorded.',
    ],
    basis: 'Campaign rules (A30); priorities (A24).',
  },
  {
    id: 'sponsor-reports',
    category: 'sponsors-highlights',
    q: 'What do sponsor reports measure?',
    a: [
      'Confirmed on-air occurrences and seconds, per output and per destination status, and the kind of evidence behind each: pixels confirmed by the cloud compositor, or delivery confirmed by the graphics page that showed it.',
      'They do not measure or estimate audiences, views or impressions. A placement that was on air is not the same as a viewer having seen it, and the reports say only what can be shown.',
    ],
    basis: 'Reporting authority (A31), disconnections (A32), destination labels (A33).',
  },
  {
    id: 'automatic-highlights',
    category: 'sponsors-highlights',
    q: 'Are highlights created automatically?',
    a: [
      'With cloud production, yes: goals and other key events become clips from the recorded programme once the moments after them have been recorded, usually within about 30 seconds, while the match is still live. Clips are placed by when the event happened, so a late entry from an offline scorer still lands in the right place, and a corrected event marks its clip as stale for review.',
      'The hosted edition has no cloud recording, so it does not make clips.',
    ],
    basis: 'Clip ready 27 s after a goal (A43); placement by capture time (A42).',
  },
  {
    id: 'vertical-clips',
    category: 'sponsors-highlights',
    q: 'Can I make vertical clips for social media?',
    a: [
      'Yes. Trim a clip, choose 16:9, 9:16 or 1:1 with a crop position, add intro and outro artwork, then download it or share an expiring link you can revoke. These need cloud production.',
      'On any edition, the control room can export a graphic as a transparent PNG, or a short WebM clip of its animation, for social posts.',
    ],
    basis: 'Exports in three shapes (A44); browser exports in the control room.',
  },
  // ------------------------------------------------------------------ accounts and pricing
  {
    id: 'cost',
    category: 'accounts-pricing',
    q: 'How much does MatchFrame cost?',
    a: [
      '**Starter** is $29 a month, **Club** $79 and **Studio** $199, or ten times the monthly price if you pay yearly (two months free). **League / Enterprise** plans start from $499 a month and are quoted. Compare what each includes on the [pricing page](/pricing).',
      'Optional extras: guided onboarding is $149 once, and custom graphics design is quoted per project. Cloud video production ($10 per production hour) is coming to the hosted service.',
    ],
    home: true,
    basis: 'Published plans and optional services (packages/domain/src/pricing.ts).',
  },
  {
    id: 'free-trial',
    category: 'accounts-pricing',
    q: 'Is there a free plan or a free trial?',
    a: ['There is no free plan; the smallest plan is Starter at $29 a month. No free trial is advertised at the moment, so [contact us](/contact) if you would like to see MatchFrame working on your setup first.'],
    basis: 'Published plans; no trial terms supplied.',
  },
  {
    id: 'self-hosting',
    category: 'accounts-pricing',
    q: 'What does self-hosting mean?',
    a: [
      'You run your own MatchFrame deployment on servers you control: the app, a PostgreSQL database, Redis, file storage and an email service, plus the media server if you want cloud production. You are responsible for those servers, their costs, backups and updates.',
      'Terms for self-hosting are not published yet; [contact us](/contact) about your plans.',
    ],
    basis: 'Deployment guides; no published licence terms.',
  },
  {
    id: 'cancel-change',
    category: 'accounts-pricing',
    q: 'Can I cancel or change plans?',
    a: ['The plan screen under Settings shows your plan and lets the organisation owner choose another. Terms for changing plans and cancelling (when a change takes effect, and what happens to a paid period) have not been published yet; [contact us](/contact) if you need to change or cancel.'],
    basis: 'Plan screen; no cancellation terms supplied.',
  },
  {
    id: 'storage-time',
    category: 'accounts-pricing',
    q: 'How long is content kept?',
    a: [
      'By default, cloud recordings are kept for 90 days and finished exports for 30 days; whoever runs the installation can change both. Match records, results and season tables are kept, and archiving a season keeps its results and tables intact.',
    ],
    basis: 'Retention settings (configuration); season archive (operator guide).',
  },
  // ------------------------------------------------------------------ support
  {
    id: 'matchday-help',
    category: 'support',
    q: 'How do I get help on matchday?',
    a: [
      'Start with the [troubleshooting guides](/docs#troubleshooting): they go through what to check in order, for missing graphics and dropped connections. You can also [contact us](/contact); we do not offer live matchday phone support.',
      'Tell us the match, what you expected and what you saw, and a screenshot if you can. Never send passwords or stream keys.',
    ],
    basis: 'Docs and contact route; no live support service.',
  },
  {
    id: 'feature-requests',
    category: 'support',
    q: 'Where can I request a feature?',
    a: ['Use the [contact form](/contact) and choose "Product question". Every suggestion is read; we cannot promise when, or whether, a particular request will be built.'],
    basis: 'Contact route.',
  },
];
