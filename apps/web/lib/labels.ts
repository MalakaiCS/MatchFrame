// Plain-English names for identifiers the API uses (placements, phases, layers, automation terms).

export const PLACEMENTS: Record<string, { label: string; where: string }> = {
  scorebug_logo: { label: 'Scorebug logo', where: 'Small logo at the end of the scorebug' },
  lower_third_banner: { label: 'Lower-third banner', where: 'Beside lower thirds and the kick-off banner' },
  event_partner: { label: 'Goal and card partner', where: 'Next to goal, card and substitution graphics' },
  detached_logo: { label: 'Corner logo', where: 'Top-right logo, also on the break boards' },
  full_frame_image: { label: 'Full-screen image', where: 'Fills the screen during pre-match and break loops' },
  full_frame_video: { label: 'Full-screen video', where: 'Fills the screen; sound follows the audio setting' },
  clip_intro: { label: 'Clip intro', where: 'Start of exported highlight clips' },
  clip_outro: { label: 'Clip outro', where: 'End of exported highlight clips' },
};
export const placementLabel = (id: string) => PLACEMENTS[id]?.label ?? humanize(id);

export const PHASE_TAGS: Record<string, string> = {
  pre_match: 'Pre-match',
  players_entering: 'Players entering',
  about_to_start: 'About to start',
  period_start: 'Kick-off (start of any period)',
  first_period: 'Start of the first period',
  half_time: 'Half time',
  interval: 'Any break',
  period_break: 'A period break',
  extra_time_interval: 'Extra-time breaks',
  extra_time: 'Extra time',
  shootout: 'Penalty shootout',
  full_time: 'Full time',
  second_half_entering: 'Players entering (2nd half)',
  second_half_ready: 'About to start (2nd half)',
};
export const phaseTagLabel = (tag: string) => PHASE_TAGS[tag] ?? humanize(tag);

export const PLAYLIST_KINDS: Record<string, string> = { pre: 'Before the match', in_play: 'During play', break: 'At a break', post: 'After the match' };
export const PRIORITIES: Record<number, string> = { 1: 'Interrupts everything (goals)', 2: 'Normal', 3: 'Low (sponsor loops)', 4: 'Lowest' };
export const LAYERS: Record<string, string> = { background: 'Full-screen background', fullframe: 'Full-screen graphic', scoreboard: 'Scorebug', event: 'Event strap', lower: 'Lower third', ticker: 'Ticker', sponsor: 'Sponsor logo' };
export const layerLabel = (l: string) => LAYERS[l] ?? humanize(l);
export const ACTIONS: Record<string, string> = {
  show: 'Show',
  update: 'Update',
  hide: 'Hide',
  scorebug_show: 'Show the scorebug',
  scorebug_hide: 'Hide the scorebug',
  clear_layers: 'Clear full-screen graphics',
  media: 'Show an image or video',
  creative: 'Show a sponsor creative',
  sponsor: 'Show a sponsor',
  wait: 'Wait',
};

export const humanize = (s: string) => s.replace(/_/g, ' ');
export const seconds = (ms: number | null | undefined) => (ms == null ? 'until taken out' : `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)} s`);
