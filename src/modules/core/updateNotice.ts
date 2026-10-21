/**
 * What the About module says after REScue was updated (RES onboarding: updateNotification,
 * patchUpdateNotification) and the tips it shows (RES RESTips: menuItem, newFeatureTips). Pure
 * functions on version strings and text; the module remembers the last version it saw in its own
 * scoped storage, on this device only. Ideas from RES lib/modules/onboarding.js and RESTips.js
 * (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */

export type UpdateKind = 'major' | 'minor' | 'patch' | 'none';

const parts = (v: string): [number, number, number] | null => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** 1 when `a` is newer than `b`, -1 when older, 0 when equal or not comparable. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]! ? 1 : -1;
  return 0;
}

/** How big the step from `from` to `to` is; 'none' when it is not an upgrade. */
export function updateKind(from: string, to: string): UpdateKind {
  if (compareVersions(to, from) <= 0) return 'none';
  const a = parts(from)!;
  const b = parts(to)!;
  if (a[0] !== b[0]) return 'major';
  return a[1] !== b[1] ? 'minor' : 'patch';
}

/** Tips that explain how to use REScue. */
export const TIPS = [
  'Add #rescue:settings/<feature> to any Reddit address to jump straight to that feature’s settings.',
  'Export a backup from Core › Backup & restore before trying big changes.',
  'Press . to open the REScue command line: go to a subreddit or user, search, or change a setting.',
  'The REScue menu (the “REScue” word in the corner) holds quick switches for the features that have one.',
  'Hover any REScue word or button to see what it does.',
];

/** A tip for a feature, shown once to people updating from a version older than `since`. */
export const NEW_FEATURE_TIPS: Array<{ since: string; text: string }> = [
  {
    since: '0.1.0',
    text: 'The shortcut bar can sort by “Last visited”, keep a list per account, and the REScue menu has a Dashboard of link cards.',
  },
  {
    since: '0.1.0',
    text: 'Feed pausing now remembers your choice, marks “Page 2” and tells you when the feed ends.',
  },
  {
    since: '0.1.1',
    text: 'The Old Reddit look can show home, popular and news tabs (settings › Old Reddit look), and voting on a comment no longer moves the page.',
  },
  {
    since: '0.1.2',
    text: 'The Old Reddit look’s dark mode is now pure black (an option turns the grey back), audience-lean chips sit right after the domain, and the selected post’s outline keeps up with fast scrolling. Reddit now sends r/all to the home feed, so REScue’s r/all links are gone.',
  },
  {
    since: '0.1.3',
    text: 'In the Old Reddit look, [+] on a collapsed comment now loads its replies in one click, gallery arrows work on a post’s page, and Reddit-hosted images open the post instead of a broken image link.',
  },
  {
    since: '0.1.4',
    text: 'In the Old Reddit look, a link to one comment opens at the top with the post in view, as on old Reddit (settings › Old Reddit look › Open comment links at the top).',
  },
  {
    since: '0.1.6',
    text: 'With “Links open in a new tab” on, post titles and thumbnails in the Old Reddit look open in a new tab too (its option “Post titles and thumbnails too”).',
  },
  {
    since: '0.1.7',
    text: 'In the Old Reddit look, the vote arrows are easier to hit (a click just beside one counts), and a post you hide no longer leaves an empty numbered box.',
  },
  {
    since: '0.1.8',
    text: 'Editing your own comment from the Old Reddit look (“edit” under it) works again.',
  },
];

/** The new-feature tips an update from `from` to `to` brings. */
export function newFeatureTips(from: string, to: string): string[] {
  return NEW_FEATURE_TIPS.filter(
    (t) => compareVersions(t.since, from) > 0 && compareVersions(t.since, to) <= 0,
  ).map((t) => t.text);
}

export const randomTip = (pick: () => number = Math.random): string =>
  TIPS[Math.floor(pick() * TIPS.length)]!;
