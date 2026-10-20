// Public website content: one source for capabilities, availability and sports, so the homepage, features,
// sport pages and FAQ never disagree. Every "available" claim points at a check in ACCEPTANCE_RESULTS.md or a
// test in the repository; anything not yet run end to end is labelled beta or "needs the media server".

export type Availability = 'available' | 'beta' | 'media-server';
export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: 'Available',
  beta: 'Beta',
  'media-server': 'Needs the media server',
};

/** The hosted service runs the graphics edition; cloud video needs a deployment with the media server. */
export const EDITIONS = {
  hosted: {
    name: 'Hosted graphics edition',
    short: 'Hosted',
    summary: 'Open MatchFrame in a browser. Scoring, graphics, automation and sponsors run here; your own computer streams with OBS.',
  },
  media: {
    name: 'With the media server',
    short: 'Media server',
    summary: 'A self-hosted deployment that adds cloud production: an RTMP camera feed in, graphics composited in the cloud, streams out, recordings and automatic highlights.',
  },
} as const;

export interface Capability {
  key: 'scoring' | 'graphics' | 'automation' | 'sponsors' | 'streaming' | 'highlights';
  name: string;
  benefit: string;
  points: string[];
  hosted: Availability | 'no';
  media: Availability;
  evidence: string;
  guide: { label: string; href: string };
}

export const CAPABILITIES: Capability[] = [
  {
    key: 'scoring',
    name: 'Live scoring',
    benefit: 'Score once on a phone. The score, clock and statistics update on every graphic and page that shows the match.',
    points: [
      'The scorer app works on a phone or tablet browser and can be added to the home screen.',
      'Keep scoring through a dropped connection: actions wait on the device and apply once when it returns.',
      'Undo straight away, or correct an event later with a reason. Graphics and statistics follow the correction.',
      'One device controls a match at a time; a producer can take over. Statistics-only scorers can help without touching the score.',
    ],
    hosted: 'available',
    media: 'available',
    evidence: 'Offline scoring, refreshes and takeovers are covered by browser tests (A13–A16); corrections by A12.',
    guide: { label: 'Scoring and corrections', href: '/docs/scoring/corrections' },
  },
  {
    key: 'graphics',
    name: 'Broadcast graphics',
    benefit: 'Give viewers the score, the clock, the line-ups and the moments that matter, in your club or league colours.',
    points: [
      'Twenty-nine built-in graphics: the scorebug (the on-screen score and clock), line-ups, goals and cards, lower thirds (name captions near the bottom of the picture), statistics, tables and more.',
      'Four original looks (Broadcast, Premier, Club and Minimal), retinted with your logo, colours and team colours.',
      'Widescreen 16:9, vertical 9:16 for social streams, and a large-type venue screen layout.',
      'A transparent graphics page you add to OBS as a Browser Source, controlled live from the control room.',
    ],
    hosted: 'available',
    media: 'available',
    evidence: 'Every graphic in every look is compared against 158 reference images on each test run; the transparent OBS page is checked pixel by pixel (A36).',
    guide: { label: 'Connect your graphics to OBS', href: '/docs/graphics/first-output' },
  },
  {
    key: 'automation',
    name: 'Automation',
    benefit: 'Graphics follow the scorer, so a small crew can run a full broadcast.',
    points: [
      'Starter plans for each sport: line-ups as the players walk out, the scorebug and kick-off banner, goal and card graphics, the half-time boards and a full-time board.',
      'Rehearse a plan against a made-up match before match day, with nothing sent to air.',
      'Switch an output to Manual at any time, or hold Emergency clear to take everything off and pause automation.',
      'Ask the producer first: a playlist can wait for a person to press Send now.',
    ],
    hosted: 'available',
    media: 'available',
    evidence: 'Priorities, duplicates, manual mode, emergency clear and worker restarts are covered by A23–A29; the football flow is checked in real time on a live output.',
    guide: { label: 'How the football automation runs', href: '/docs/automation/football-flow' },
  },
  {
    key: 'sponsors',
    name: 'Sponsors',
    benefit: 'Put sponsors into the broadcast on a schedule you control, and report what actually went to air.',
    points: [
      'Campaigns with flight dates, priority, weighting, caps and spacing across placements such as the scorebug logo, lower-third banners and full-screen slots.',
      'A goal or card can carry a "presented by" partner.',
      'Delivery reports count confirmed on-air seconds per output and say what the evidence was. They do not estimate audiences.',
      'CSV export for partners, safe to open in a spreadsheet.',
    ],
    hosted: 'available',
    media: 'available',
    evidence: 'Expiry, caps, priority, disconnections and CSV safety are covered by A30–A34.',
    guide: { label: 'Sponsors and reports', href: '/docs/sponsors/reports' },
  },
  {
    key: 'streaming',
    name: 'Cloud production',
    benefit: 'Send one camera feed in and let MatchFrame put the graphics on it and stream it out.',
    points: [
      'An RTMP input for your encoder or camera, with a programme output (with graphics) and a clean output (without).',
      'Up to three destinations per output, such as YouTube, Facebook and Twitch, using your own stream keys.',
      'A programme monitor shows what actually went out, with its delay.',
      'If the camera feed drops, a holding slate goes up and the stream recovers when the feed returns.',
    ],
    hosted: 'no',
    media: 'media-server',
    evidence: 'RTMP in to programme out, three destinations and source-loss recovery were measured (A33, A35, A37, A39). Two simultaneous 720p sessions overloaded the 4-core test server (A51): capacity depends on your server.',
    guide: { label: 'Choose a production workflow', href: '/docs/production/choose-a-workflow' },
  },
  {
    key: 'highlights',
    name: 'Recording and highlights',
    benefit: 'Turn the moments of the match into clips while the match is still on.',
    points: [
      'Recordings of the programme, kept for a set number of days.',
      'Goal and key-event clips appear in the media library during the match, placed by when they happened.',
      'Trim, crop to 16:9, 9:16 or 1:1, add intro and outro artwork, then download or share a link that expires.',
      'Uploaded media and still exports work without the media server.',
    ],
    hosted: 'no',
    media: 'media-server',
    evidence: 'A clip was ready 27 seconds after a goal while the stream was live (A43); exports in three shapes were checked (A44).',
    guide: { label: 'Choose a production workflow', href: '/docs/production/choose-a-workflow' },
  },
];

export interface SportInfo {
  key: string;
  name: string;
  status: 'tested' | 'beta';
  scoring: string;
  scorebug: string;
}

export const SPORTS: SportInfo[] = [
  { key: 'football', name: 'Football', status: 'tested', scoring: 'Goals with assists and goal types, own goals, penalties, yellow and red cards, substitutions, extra time and penalty shoot-outs.', scorebug: 'Score, clock, added time and the shoot-out tally.' },
  { key: 'basketball', name: 'Basketball', status: 'tested', scoring: 'One, two and three-point scores with the scorer named afterwards, foul types, timeouts, overtime, possession, rebounds and assists.', scorebug: 'Score, period, team fouls and bonus, timeouts remaining and the shot clock.' },
  { key: 'netball', name: 'Netball', status: 'beta', scoring: 'Goals and missed shots, intercepts, rebounds, turnovers, penalties, centre passes and rolling substitutions.', scorebug: 'Quarter and score.' },
  { key: 'rugby_league', name: 'Rugby league', status: 'beta', scoring: 'Tries, penalty tries, conversions, penalty and field goals, sin bins, send-offs, interchanges and six-again calls.', scorebug: 'Score and sin-bin markers.' },
  { key: 'afl', name: 'AFL', status: 'beta', scoring: 'Goals, behinds and rushed behinds, interchanges, marks, tackles, inside 50s and clearances.', scorebug: 'The "12.7 (79)" score line.' },
  { key: 'hockey', name: 'Hockey', status: 'beta', scoring: 'Goals, green, yellow and red cards, substitutions, penalty corners and strokes, and shoot-outs.', scorebug: 'Quarter and score.' },
];

export const SPORT_STATUS_LABEL = {
  tested: 'Tested end to end',
  beta: 'Beta',
} as const;

export const SPORT_STATUS_NOTE = {
  tested: 'A full match, including the unusual cases, has been played through the scorer, graphics and automation in the acceptance tests.',
  beta: 'The rules, events and graphics are built and covered by automated checks, but a full match has not yet been run end to end. Rehearse before relying on it.',
} as const;

/** Videos on the public site, played from YouTube's privacy-enhanced player only after a visitor presses play. */
export const VIDEOS = {
  graphics: { youtubeId: 'k4ET0z97tz8', title: 'Graphics in action' },
} as const;
