// Documentation articles for the public help centre. Labels in **bold** are the product's own button, tab and
// field names, checked against the interface on the `verified` date. Each procedural guide states its outcome,
// prerequisites, steps with expected results, and limits. Inline markup: [label](/href), **bold**, `code`.
export type DocSection = 'getting-started' | 'sports' | 'scoring' | 'graphics' | 'automation' | 'production' | 'sponsors' | 'troubleshooting' | 'support';

export const DOC_SECTIONS: { key: DocSection; label: string; blurb: string }[] = [
  { key: 'getting-started', label: 'Getting started', blurb: 'Choose your setup, prepare a match and rehearse it.' },
  { key: 'sports', label: 'Sports', blurb: 'What each sport records and shows.' },
  { key: 'scoring', label: 'Scoring', blurb: 'The scorer app, corrections and offline scoring.' },
  { key: 'graphics', label: 'Graphics and branding', blurb: 'Your graphics in OBS, in your colours.' },
  { key: 'automation', label: 'Automation', blurb: 'What runs on its own and how to take over.' },
  { key: 'production', label: 'Production and streaming', blurb: 'OBS on your computer, or cloud production.' },
  { key: 'sponsors', label: 'Sponsors', blurb: 'Campaigns, placements and delivery reports.' },
  { key: 'troubleshooting', label: 'Troubleshooting', blurb: 'What to check, in order, when something looks wrong.' },
  { key: 'support', label: 'Support', blurb: 'Getting help from the MatchFrame team.' },
];

export type Block =
  | { h: string }
  | { p: string }
  | { steps: { do: string; expect?: string }[] }
  | { list: string[] }
  | { note: string; tone?: 'info' | 'warning' }
  | { table: { head: string[]; rows: string[][] } };

export interface DocArticle {
  slug: string;
  section: DocSection;
  title: string;
  outcome: string;
  availability?: string;
  prerequisites?: string[];
  body: Block[];
  related?: string[];
  verified: string;
}

const V = '2026-10-20';

export const DOCS: DocArticle[] = [
  // ================================================================== getting started
  {
    slug: 'getting-started/overview',
    section: 'getting-started',
    title: 'Overview: how MatchFrame fits your broadcast',
    outcome: 'Understand the two ways to run MatchFrame and pick the right first guide.',
    body: [
      { p: 'MatchFrame does three jobs on matchday: it keeps the match record (a scorer taps the events on a phone), it draws the broadcast graphics from that record, and it runs those graphics on its own through an automation plan, with an operator able to take over at any moment.' },
      { p: 'What it does not do is film the game. You choose how the pictures and the graphics come together:' },
      { table: { head: ['', 'OBS on your computer', 'Cloud production'], rows: [
        ['Where the graphics go', 'A transparent graphics page you add to OBS over your camera', 'Composited onto your camera feed by MatchFrame\'s media server'],
        ['Who streams', 'OBS, to your platform', 'MatchFrame, to up to three destinations'],
        ['Recordings and automatic highlights', 'Record in OBS', 'Yes'],
        ['Available on', 'The hosted edition and any self-hosted deployment', 'Self-hosted deployments with the media server'],
      ] } },
      { p: 'If you are not sure, start with OBS: it needs only a computer you probably already have. [Compare the workflows in detail](/docs/production/choose-a-workflow).' },
      { h: 'Where to go next' },
      { list: [
        '[Check the requirements](/docs/getting-started/requirements) for your setup.',
        '[Set up your first match](/docs/getting-started/first-match), from account to OBS.',
        '[Rehearse it](/docs/getting-started/rehearsal) before you go live.',
      ] },
    ],
    related: ['getting-started/requirements', 'getting-started/first-match', 'production/choose-a-workflow'],
    verified: V,
  },
  {
    slug: 'getting-started/requirements',
    section: 'getting-started',
    title: 'Requirements',
    outcome: 'Check you have the devices, software and connection your setup needs.',
    body: [
      { h: 'For everyone' },
      { list: [
        '**A phone or tablet for the scorer.** The scorer app runs in the browser; add it to the home screen for a full-screen app that opens even without a connection.',
        '**A laptop or desktop for the control room**, in an up-to-date browser. Our tests run in Chromium-based browsers (Chrome, Edge); others are not yet formally tested.',
        '**An email address you can receive mail at**, to verify your account.',
      ] },
      { h: 'OBS on your computer' },
      { list: [
        '**OBS Studio** on a computer that receives your camera (for example a USB webcam, or an HDMI camera through a capture device).',
        'An internet connection at the venue for the OBS computer (to receive graphics changes and to stream) and for the scorer\'s phone.',
        'A streaming account on your platform (YouTube, Facebook, Twitch or another).',
      ] },
      { h: 'Cloud production (media server)' },
      { list: [
        'A camera or encoder that can send **RTMP** (OBS on a laptop, a hardware encoder, or a camera with RTMP output).',
        'A self-hosted MatchFrame deployment with the media server, sized for the number of programmes you will run at once.',
        'The server URL and stream key for each destination, from the platform\'s live dashboard.',
      ] },
      { h: 'Connection' },
      { p: 'We do not publish a single required speed, because the stream is the demanding part and depends on the quality you choose: follow your platform\'s upload guidance. The scorer app uses very little data, and its low data mode refreshes the score every ten seconds instead of keeping a live connection. Test the venue connection in a [rehearsal](/docs/getting-started/rehearsal).' },
    ],
    related: ['getting-started/first-match', 'production/choose-a-workflow'],
    verified: V,
  },
  {
    slug: 'getting-started/first-match',
    section: 'getting-started',
    title: 'Set up your first match',
    outcome: 'Go from a new account to a match whose graphics show in OBS and follow the scorer.',
    availability: 'Hosted edition and self-hosted. Uses the OBS workflow.',
    prerequisites: ['A computer with OBS Studio for the graphics', 'A phone for the scorer', 'Your team names, players and numbers'],
    body: [
      { h: '1. Create your account and organisation' },
      { steps: [
        { do: 'Go to [Get started](/register), enter your name, email and a password, and open the verification link we email you.', expect: 'You are signed in and asked to set up your organisation.' },
        { do: 'Enter the **Organisation name** and **Timezone**, then press **Create organisation**.' },
        { do: 'Enter the **Competition name**, a **Short name**, the **Season** (for example 2026) and the **Sport**, then press **Continue**.' },
        { do: 'Enter at least two team names and press **Save teams**.' },
        { do: 'Choose the kick-off time for your first fixture and press **Create match**, then **Go to dashboard**.', expect: 'The dashboard shows the match as your next match.' },
      ] },
      { h: '2. Add your players' },
      { steps: [
        { do: 'Open **Assets** → **Players** and use **Add player** for each player, with their name and usual number.' },
        { do: 'Open **Assets** → **Teams**, press **Roster** next to a team, choose a player and the season, check the number and press **Add**. Repeat for each player in each team.', expect: 'Each team\'s roster lists its players for the season.' },
      ] },
      { note: 'A fixture created after its teams have rosters starts with the roster as its line-up. For a fixture created earlier, set the line-up as in the next step.' },
      { h: '3. Set the line-ups' },
      { steps: [
        { do: 'Open **Matches**, choose the match, and open the **Lineup** tab.' },
        { do: 'For each player choose **Start**, **Bench** or **Out**, then press **Save line-ups**. **Save as team default** keeps a side for next time.', expect: 'The match-day checklist at the top of the match says the line-ups are entered.' },
      ] },
      { h: '4. Choose a look and turn on automation' },
      { steps: [
        { do: 'In the match-day checklist, choose a **Look** and press **Apply**.' },
        { do: 'If your organisation has no automation plan yet: open **Automation**, press **New plan**, keep **Start from the football starter plan** ticked (or your sport\'s), press **Create**, then **Publish**.', expect: 'A message confirms the published version.' },
        { do: 'Back on the match, choose the plan under **Automation plan** and press **Apply** (new matches take your latest published plan for their sport on their own).', expect: 'The checklist shows "Automation: <plan name>".' },
      ] },
      { h: '5. Add the graphics to OBS' },
      { steps: [
        { do: 'Open the match\'s **OBS link** tab and press **Copy link**.' },
        { do: 'In OBS, under **Sources** press **+**, choose **Browser**, paste the link, and set the width to 1920 and the height to 1080. Leave the custom CSS box empty.' },
        { do: 'Untick **Shutdown source when not visible** and move the source above your camera.', expect: 'The animated background and the match header appear over your camera (with the football starter plan), and the status on the OBS link tab turns green.' },
      ] },
      { h: '6. Give the scorer their link' },
      { steps: [
        { do: 'In the checklist, assign a scorer and send the scorer link, or open [/score](/score) on the scorer\'s phone while signed in as them.', expect: 'The match is on the scorer\'s list.' },
      ] },
      { p: 'Now [rehearse the match](/docs/getting-started/rehearsal) before the real one.' },
    ],
    related: ['getting-started/rehearsal', 'graphics/first-output', 'automation/football-flow'],
    verified: V,
  },
  {
    slug: 'getting-started/rehearsal',
    section: 'getting-started',
    title: 'Rehearse before you go live',
    outcome: 'Test scoring, graphics, automation and the OBS output end to end, without a live audience.',
    prerequisites: ['A match set up as in [Set up your first match](/docs/getting-started/first-match)', 'OBS showing the graphics link'],
    body: [
      { h: 'Rehearse the plan on its own' },
      { steps: [
        { do: 'Open **Automation**, choose your plan and press **Rehearse**.', expect: 'A made-up match plays through the real graphics, and each decision says why a playlist ran or did not. Nothing is sent to any output.' },
      ] },
      { h: 'Rehearse the whole chain' },
      { p: 'Use a practice fixture (or a **demo match** from the dashboard, which scores itself and is kept out of tables and reports), with OBS showing its graphics link but not streaming, or streaming to a private test stream.' },
      { steps: [
        { do: 'On the scorer\'s phone, press **Next:** through **Pre-match**, **Players entering** and **About to start**.', expect: 'In OBS: the background and header clear when the players walk out, and about 15 seconds later each team\'s line-up shows for 8 seconds.' },
        { do: 'Press **Next: 1st Half**.', expect: 'The scorebug and the kick-off banner come in, and the clock runs.' },
        { do: 'Record a goal, then use **Undo** straight away.', expect: 'The goal graphic shows, then the score goes back and the graphic comes off.' },
        { do: 'In the control room, switch the output to **Manual**, send a lower third with **To air**, take it **Out**, then switch back to **Auto**.', expect: 'Nothing automatic happens while in Manual; the lower third comes and goes when you say.' },
        { do: 'Turn the scorer phone\'s Wi-Fi and mobile data off, record a card, then turn them back on.', expect: 'The phone shows Offline and a pending action; when it reconnects the card applies once.' },
        { do: 'Press **Half Time**, then **Players entering (2nd half)**.', expect: 'The half-time background, stats and header come up, then clear; the scorebug returns 7 seconds after the walk-out.' },
      ] },
      { note: 'Rehearse at the venue if you can, at the same time of day as the match, so you test the real connection.', tone: 'info' },
    ],
    related: ['getting-started/matchday-checklist', 'scoring/corrections', 'automation/manual-override'],
    verified: V,
  },
  {
    slug: 'getting-started/matchday-checklist',
    section: 'getting-started',
    title: 'Matchday checklist',
    outcome: 'Run through the essentials before, during and after the match.',
    body: [
      { h: 'The day before' },
      { list: [
        'Line-ups entered (the match-day checklist at the top of the match shows the starters for each side).',
        'A look chosen and automation set on the match.',
        'A scorer assigned, with the scorer link on their phone.',
        'Sponsor artwork approved and campaigns covering the match date, if you use sponsors.',
      ] },
      { h: 'An hour before' },
      { list: [
        'OBS open with the graphics source above the camera; the **OBS link** tab shows it connected.',
        'The scorer signed in on the phone, with **Next: Pre-match** ready.',
        'The stream set up on your platform and a short private test done.',
        'The control room open on a laptop in case you need to take over.',
      ] },
      { h: 'During the match' },
      { list: [
        'The scorer presses the phase buttons as the match goes: Players entering, About to start, 1st Half, Half Time, Players entering (2nd half), About to start (2nd half), 2nd Half, Full Time.',
        'Keep an eye on the control room preview; switch to **Manual** if you need to stop automatic graphics.',
        'In an emergency, press and hold **Emergency clear**, then **Resume** when ready.',
      ] },
      { h: 'After the match' },
      { list: [
        'Check the event log for anything that needs correcting.',
        'With cloud production, review highlight clips (a corrected event marks its clip as stale).',
        'Export the sponsor delivery report if your partners need it.',
      ] },
    ],
    related: ['getting-started/rehearsal', 'troubleshooting/graphics-not-visible'],
    verified: V,
  },
  // ================================================================== sports
  {
    slug: 'sports/football',
    section: 'sports',
    title: 'Football',
    outcome: 'Know what the football scorer records and how the graphics follow the match.',
    availability: 'Tested end to end.',
    body: [
      { h: 'What the scorer records' },
      { list: [
        'Goals, with the scorer, the assist and the goal type (header, penalty, free kick and so on); own goals; penalties scored and missed.',
        'Yellow cards, second yellows and red cards; substitutions (a player who comes off cannot come back on).',
        'Statistics such as corners, shots, saves, fouls and offsides. They feed the stats boards and never put a graphic on air of their own.',
        'Added time, extra time and penalty shoot-outs.',
      ] },
      { h: 'The phases' },
      { p: 'Pre-match → Players entering → About to start → 1st Half → Half Time → Players entering (2nd half) → About to start (2nd half) → 2nd Half → Full Time, with extra time and a shoot-out available under **More options** when the competition allows them.' },
      { h: 'What goes on air' },
      { p: 'With the football starter plan the graphics follow these phases on their own: see [the football automation flow](/docs/automation/football-flow).' },
    ],
    related: ['automation/football-flow', 'scoring/corrections'],
    verified: V,
  },
  {
    slug: 'sports/basketball',
    section: 'sports',
    title: 'Basketball',
    outcome: 'Know what the basketball scorer records and what the scorebug shows.',
    availability: 'Tested end to end.',
    body: [
      { h: 'What the scorer records' },
      { list: [
        'One, two and three-point scores. The score changes straight away; choose the scorer afterwards (or later).',
        'Fouls by type (personal, offensive, technical, unsportsmanlike, disqualifying), with players who have fouled out marked.',
        'Timeouts with the number remaining, possession, rebounds and assists.',
        'Quarters and overtime, with a separate shot clock.',
      ] },
      { h: 'On the scorebug' },
      { p: 'Score, period, team fouls and the bonus, timeouts remaining and the shot clock.' },
    ],
    related: ['scoring/corrections'],
    verified: V,
  },
  // ================================================================== scoring
  {
    slug: 'scoring/corrections',
    section: 'scoring',
    title: 'Fix a wrong score or event',
    outcome: 'Correct a mistake and know what changes as a result.',
    body: [
      { h: 'Straight away' },
      { steps: [
        { do: 'Press the floating **Undo** button that appears for a few seconds after each action. No reason is needed.', expect: 'The score and any graphic the action caused go back.' },
      ] },
      { h: 'Later' },
      { steps: [
        { do: 'In the scorer app, find the event under **Recent** and undo or correct it, giving a reason.', expect: 'The score, statistics and graphics update.' },
        { do: 'For a clock mistake, correct the clock and give a reason.' },
      ] },
      { h: 'What follows a correction' },
      { list: [
        'An automatic graphic caused by the mistaken event is taken off (or never goes on, if it had not yet).',
        'A highlight clip made from it is marked stale, so you can check it before publishing.',
        'The correction is recorded in the match\'s **Activity** with who made it and why.',
      ] },
      { h: 'Offline and takeovers' },
      { p: 'Actions recorded offline apply once when the phone reconnects. If someone else changed the match meanwhile (for example a producer took over), each offline action waits under **Needs review**: choose **Apply now** or **Discard**.' },
    ],
    related: ['troubleshooting/connection-loss'],
    verified: V,
  },
  // ================================================================== graphics
  {
    slug: 'graphics/first-output',
    section: 'graphics',
    title: 'Connect your graphics to OBS',
    outcome: 'Show a match\'s graphics over your camera in OBS Studio.',
    availability: 'All editions.',
    prerequisites: ['OBS Studio with your camera already in a scene', 'A match in MatchFrame'],
    body: [
      { steps: [
        { do: 'Open the match, then its **OBS link** tab, and press **Copy link**.' },
        { do: 'In OBS, under **Sources** press **+** and choose **Browser**. Give it a name such as MatchFrame graphics.' },
        { do: 'Paste the link into URL. Set the width to **1920** and the height to **1080** (for a vertical output, 1080 and 1920). Leave the custom CSS box empty: the background is already transparent.' },
        { do: 'Untick **Shutdown source when not visible**, so the graphics stay up to date, and press OK.' },
        { do: 'Move the browser source above your camera in the sources list.', expect: 'The OBS link tab\'s status turns green once OBS is showing the page, and graphics on air appear over your camera.' },
      ] },
      { h: 'Several outputs at once' },
      { p: 'Each output has its own link. **Download OBS scene collection** on the OBS link tab gives OBS a ready-made scene per output (Scene Collection → Import in OBS).' },
      { h: 'If the link leaks' },
      { p: 'Under **Advanced**, create a new link. The old one stops working at once, so update OBS with the new link.' },
      { note: 'The graphics link works without signing in, so treat it like a password: share it only with whoever runs OBS.', tone: 'warning' },
    ],
    related: ['troubleshooting/graphics-not-visible', 'graphics/themes-and-branding'],
    verified: V,
  },
  {
    slug: 'graphics/themes-and-branding',
    section: 'graphics',
    title: 'Looks and branding',
    outcome: 'Put your logo and colours on the graphics.',
    body: [
      { steps: [
        { do: 'Open **Themes** and choose one of the four looks: Broadcast, Premier, Club or Minimal.', expect: 'Every graphic previews in that look with sample teams.' },
        { do: 'Set your colours, logo and team colours, and the scorebug variant and position, the clock style and any wording changes.' },
        { do: 'Publish the look, then choose it on the match (match-day checklist → **Look** → **Apply**), or as the competition default.' },
      ] },
      { h: 'Artwork' },
      { list: [
        'Upload logos, headshots and sponsor artwork under **Assets** → **Images, video & audio**: PNG or JPEG images up to 25 megapixels, MP4 video up to ten minutes.',
        'A custom font can be uploaded the same way and chosen in the look.',
        'When the two teams\' colours are too close, the away team switches to its alternate colours automatically.',
      ] },
      { note: 'Published looks never change under a live match. A match keeps the version it started with until you apply the newer one on its OBS link tab.' },
    ],
    related: ['graphics/first-output'],
    verified: V,
  },
  // ================================================================== automation
  {
    slug: 'automation/football-flow',
    section: 'automation',
    title: 'How the football automation runs',
    outcome: 'Know what goes on air at each step of a football match with the starter plan.',
    availability: 'Football starter plan. Plans published before 20 October 2026 need **Use the latest starter flow** and a republish.',
    body: [
      { table: { head: ['When', 'On air'], rows: [
        ['The match is created (Scheduled)', 'The animated background, then the match header: Home v Away, ground and kick-off time. The countdown to kick-off appears in the last 99 minutes.'],
        ['Pre-match', 'The same background and header stay up as they are.'],
        ['Players entering', 'Background and header fade out. 15 seconds later the home line-up for 8 seconds, then the away line-up for 8 seconds, once each. About to start does not cut them short.'],
        ['1st Half', 'The scorebug and the kick-off banner.'],
        ['Goals, cards, substitutions', 'Their graphic, then the goal partner logo after a goal.'],
        ['Half Time', 'Scorebug out; the animated background over everything, then the match stats and the match header (score, HALF TIME and a countdown to the second half) taking turns, 45 seconds each.'],
        ['Players entering (2nd half)', 'Background and header fade out; the scorebug comes back 7 seconds later. No line-ups the second time.'],
        ['2nd Half', 'The kick-off banner.'],
        ['Full Time', 'The scorebug stays for 30 seconds, then the background and the match header with the final score, FULL TIME and "Thank you for watching".'],
      ] } },
      { p: 'A line-up board only shows for a team whose line-up has been entered; a side with none is skipped, with the reason in the automation history. The background and header sit above every other graphic except the stinger wipe.' },
      { h: 'Changing it' },
      { p: 'Open **Automation**, choose the plan and edit its playlists in plain language: when each one runs, which steps, and for how long. **Rehearse** shows the result before you publish.' },
    ],
    related: ['automation/manual-override', 'getting-started/rehearsal'],
    verified: V,
  },
  {
    slug: 'automation/manual-override',
    section: 'automation',
    title: 'Take over from automation',
    outcome: 'Stop, pause or override the automatic graphics during a match.',
    body: [
      { list: [
        '**Manual** (per output): automatic graphics pause and pending automatic steps are cancelled; what is on air stays. Returning to **Auto** does not replay what happened meanwhile, and the scorebug is restored in play.',
        '**To air** (F8) and **Out** (F9): send or remove any graphic yourself, in Auto or Manual. Automation never takes off a graphic an operator put on.',
        '**Emergency clear**: press and hold to take every graphic and the scorebug off and pause automation until someone presses **Resume**.',
        '**Ask the producer before sending**: set on a playlist, its graphics wait in the control room for **Send now** or **Skip**.',
      ] },
    ],
    related: ['automation/football-flow'],
    verified: V,
  },
  // ================================================================== production
  {
    slug: 'production/choose-a-workflow',
    section: 'production',
    title: 'Choose a production workflow',
    outcome: 'Decide between streaming from OBS and cloud production.',
    body: [
      { table: { head: ['', 'OBS on your computer', 'Cloud production'], rows: [
        ['You need', 'A computer with OBS and your camera', 'A camera or encoder that sends RTMP, and a deployment with the media server'],
        ['Graphics', 'Added in OBS as a browser source', 'Composited by MatchFrame'],
        ['Streaming', 'From OBS to your platform', 'From MatchFrame to up to three destinations per output'],
        ['Clean feed (no graphics)', 'Make it in OBS', 'A separate clean output'],
        ['Recording', 'In OBS', 'Recorded by MatchFrame, kept 90 days by default'],
        ['Automatic highlights', 'No', 'Clips of goals and key events during the match'],
        ['If the camera feed drops', 'Up to your OBS setup', 'A holding slate goes up; the stream recovers when the feed returns'],
        ['Where', 'Hosted edition and self-hosted', 'Self-hosted with the media server'],
      ] } },
      { h: 'Capacity' },
      { p: 'Graphics-only matches need little from the server. Each cloud programme needs real processing power: two 720p programmes overloaded our four-core test server, so measure on your own hardware before relying on more than one at a time.' },
    ],
    related: ['graphics/first-output', 'getting-started/requirements'],
    verified: V,
  },
  // ================================================================== sponsors
  {
    slug: 'sponsors/reports',
    section: 'sponsors',
    title: 'Sponsors and delivery reports',
    outcome: 'Set up a sponsor campaign and read what the report does and does not say.',
    body: [
      { h: 'Set up' },
      { steps: [
        { do: 'Open **Sponsors**, add the brand, then its creatives from the asset library, and approve them.' },
        { do: 'Create a campaign: flight dates, priority, weighting, caps, spacing, and the placements it may use.', expect: 'Matches in the flight rotate the sponsor through those placements.' },
      ] },
      { h: 'Read the report' },
      { p: '**Reports** → **Sponsor delivery** shows confirmed on-air occurrences and seconds per output, the kind of evidence for each (pixels confirmed by the cloud compositor, or delivery confirmed by the graphics page) and each destination\'s status. **Export CSV** gives a file that is safe to open in a spreadsheet.' },
      { note: 'Reports never estimate audiences, views or impressions. A placement on air is not the same as a person having seen it.', tone: 'info' },
    ],
    related: [],
    verified: V,
  },
  // ================================================================== troubleshooting
  {
    slug: 'troubleshooting/graphics-not-visible',
    section: 'troubleshooting',
    title: 'My graphics are missing',
    outcome: 'Find out why nothing, or not the right thing, shows in OBS, checking in a sensible order.',
    body: [
      { steps: [
        { do: 'Open the match\'s **OBS link** tab and look at the status.', expect: 'Green means OBS is showing the page. If it is not green, OBS has not loaded the link: check the URL in the browser source, and that the OBS computer is online.' },
        { do: 'In OBS, check the browser source is above the camera, visible (the eye icon), 1920 × 1080, and that **Shutdown source when not visible** is unticked. Right-click it and choose **Refresh**.' },
        { do: 'If the link was replaced under **Advanced**, the old link no longer works: copy the new one into OBS.' },
        { do: 'Check the match has automation: the match-day checklist should say "Automation: <plan name>". Without a plan, nothing goes on air on its own.' },
        { do: 'Open the control room for the output. If it says **Manual mode** or **Cleared (emergency)**, automation is paused: switch to **Auto**, or press **Resume**.' },
        { do: 'Check the scorer pressed the phase buttons: the graphics follow the phases, not the clock.', expect: 'For example the line-ups wait for **Players entering**.' },
        { do: 'A line-up board is skipped for a team with no line-up entered; check the **Lineup** tab. The automation history on the control room explains every skipped step.' },
      ] },
      { p: 'Still stuck? [Contact us](/contact) with the match, what you expected and what you saw.' },
    ],
    related: ['graphics/first-output', 'automation/manual-override'],
    verified: V,
  },
  {
    slug: 'troubleshooting/connection-loss',
    section: 'troubleshooting',
    title: 'When the connection drops',
    outcome: 'Know what each part does when the internet drops, and how to recover.',
    body: [
      { table: { head: ['Part', 'What happens', 'What to do'], rows: [
        ['Scorer phone', 'Shows Offline and keeps recording; actions are saved on the phone as pending.', 'Keep scoring. When the connection returns they apply once, in order. If someone else changed the match meanwhile, review each one under Needs review.'],
        ['OBS graphics page', 'Needs the connection to receive changes.', 'Restore the OBS computer\'s connection; refresh the browser source if it does not catch up.'],
        ['Your OBS stream', 'Depends on OBS and your platform.', 'Check OBS\'s own stream status.'],
        ['Cloud production: camera feed', 'A holding slate goes on air; the stream stays up (13–16 seconds to recover in our tests once the feed returns).', 'Fix the camera or encoder connection; the programme recovers on its own.'],
        ['Cloud production: MatchFrame servers', 'The stream keeps going while the servers restart; the match and clock are unchanged afterwards.', 'Wait for the control room to reconnect.'],
      ] } },
      { note: 'Scoring offline is safe: an action is never applied twice, and events entered late never trigger a celebration for something that happened long ago.', tone: 'info' },
    ],
    related: ['scoring/corrections', 'troubleshooting/graphics-not-visible'],
    verified: V,
  },
  // ================================================================== support
  {
    slug: 'support/contact',
    section: 'support',
    title: 'Get help',
    outcome: 'Reach the MatchFrame team with the information that gets you a useful answer.',
    body: [
      { p: 'Use the [contact form](/contact) and choose **Setup help**. Include:' },
      { list: [
        'Which match (its name or date) and which output.',
        'What you expected to happen, and what you saw instead.',
        'A screenshot of the control room or OBS, if you can.',
      ] },
      { note: 'Never send passwords, stream keys or graphics links. We will never ask for them.', tone: 'warning' },
      { p: 'We do not offer live matchday phone support. For problems during a match, the [troubleshooting guides](/docs#troubleshooting) go through what to check first.' },
    ],
    related: ['troubleshooting/graphics-not-visible'],
    verified: V,
  },
];

export const docBySlug = (slug: string) => DOCS.find((d) => d.slug === slug);
export const docsIn = (section: DocSection) => DOCS.filter((d) => d.section === section);
