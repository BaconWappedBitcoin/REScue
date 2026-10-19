/**
 * Conditions about where and when you are browsing: RES filteReddit "browse cases"
 * (BrowsingFrontPage, CurrentSub, CurrentMulti, CurrentUserProfile, CurrentLocation, LoggedInAs,
 * Date, Dow, Toggle; lib/modules/filteReddit/browseCases, GPL-3.0, the RES contributors). They
 * need no post or comment, so they work in a rule's "only when browsing" column and inside any
 * custom expression.
 */
import {
  compileExpression,
  textMatch,
  flag,
  type ConditionSpec,
  type ConditionTable,
  type Condition,
} from './conditions';
import type { Route } from '../../../core/types';

/** What the browse conditions look at. */
export interface BrowseEnv {
  route: Pick<Route, 'kind' | 'subreddit' | 'username' | 'path'>;
  /** Path and query string of the page, e.g. /r/rust/top/?t=week. */
  location: string;
  /** The signed-in user's name, or null. */
  me: string | null;
  /** The current time in ms. */
  now: number;
  toggleOn(name: string): boolean;
}

const names = (v: string): Set<string> =>
  new Set(
    v
      .split(',')
      .map((x) =>
        x
          .trim()
          .replace(/^\/?(?:r|u|user|m)\//i, '')
          .toLowerCase(),
      )
      .filter(Boolean),
  );

/** The name of the custom feed in /user/x/m/name/, or undefined. */
export const feedName = (path: string): string | undefined =>
  /\/m\/([^/]+)/i.exec(path)?.[1]?.toLowerCase();

const listed = <S>(
  help: string,
  get: (e: BrowseEnv) => string | undefined,
  optional = false,
): ConditionSpec<S, BrowseEnv> => ({
  help,
  check: (c) =>
    c.op === ':' || c.op === ''
      ? c.value || optional
        ? null
        : 'needs a name after the colon.'
      : 'write it as name:value.',
  build: (c) => {
    const want = names(c.value);
    return (_s, e) => {
      const have = get(e);
      return have !== undefined && (!want.size || want.has(have.toLowerCase()));
    };
  },
});

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function dayNumbers(v: string): number[] | null {
  const out: number[] = [];
  for (const part of v
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)) {
    const n = DAYS.indexOf(part.slice(0, 3));
    if (n < 0) return null;
    out.push(n);
  }
  return out.length ? out : null;
}

/** A date or date and time: 2026-03-01 or 2026-03-01T14:30 (your local time). */
export function parseWhen(v: string): number | null {
  const t = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?$/.test(t)) return null;
  // A date alone would be read as UTC midnight; make it the reader's local midnight.
  const ms = new Date(t.length === 10 ? `${t}T00:00` : t.replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function range(v: string): [string, string] | null {
  const i = v.indexOf('..');
  return i < 0 ? null : [v.slice(0, i), v.slice(i + 2)];
}

function dateRange(c: Condition): [number | null, number | null] | string {
  const r = range(c.value);
  if (!r || !(r[0] || r[1]))
    return 'write it as date:2026-01-01..2026-02-01 (either end may be left out).';
  const a = r[0] ? parseWhen(r[0]) : null;
  const b = r[1] ? parseWhen(r[1]) : null;
  if ((r[0] && a === null) || (r[1] && b === null))
    return 'dates look like 2026-03-01 or 2026-03-01T14:30.';
  return [a, b];
}

const HOUR_RANGE = /^(\d{1,2})\.\.(\d{1,2})$/;

export const browseConditions: ConditionTable<unknown, BrowseEnv> = {
  front: flag('browsing the front page', (_s, e: BrowseEnv) => e.route.kind === 'front'),
  onsub: listed(
    'browsing one of these subreddits (comma-separated; blank = any subreddit page)',
    (e) =>
      e.route.kind === 'subreddit' || e.route.kind === 'all' || e.route.kind === 'popular'
        ? e.route.subreddit
        : undefined,
    true,
  ),
  onmulti: listed(
    'browsing one of these custom feeds / multireddits (blank = any)',
    (e) => (e.route.kind === 'customFeed' ? (feedName(e.route.path) ?? '') : undefined),
    true,
  ),
  onuser: listed(
    'browsing one of these user profiles (blank = any profile)',
    (e) => (e.route.kind === 'profile' ? e.route.username : undefined),
    true,
  ),
  location: textMatch(
    'the page address (path and query) matches text or /regex/',
    false,
    (_s, e: BrowseEnv) => e.location,
  ),
  loggedin: {
    help: 'signed in as one of these users (blank = signed in as anyone)',
    check: (c) => (c.op === ':' || c.op === '' ? null : 'write it as loggedin:name.'),
    build: (c) => {
      const want = names(c.value);
      return (_s, e) => e.me !== null && (!want.size || want.has(e.me.toLowerCase()));
    },
  },
  toggle: {
    help: 'a custom toggle (REScue menu) is on',
    check: (c) => (c.op === ':' && c.value ? null : 'write it as toggle:name.'),
    build: (c) => (_s, e) => e.toggleOn(c.value),
  },
  date: {
    help: 'now is within date:2026-01-01..2026-02-01 (either end optional; your local time)',
    check: (c) => {
      const r = dateRange(c);
      return typeof r === 'string' ? r : null;
    },
    build: (c) => {
      const [a, b] = dateRange(c) as [number | null, number | null];
      return (_s, e) => (a === null || e.now >= a) && (b === null || e.now <= b);
    },
  },
  dow: {
    help: 'today is one of these days: dow:sat,sun',
    check: (c) =>
      c.op === ':' && dayNumbers(c.value) ? null : 'write day names such as dow:mon,tue.',
    build: (c) => {
      const days = new Set(dayNumbers(c.value));
      return (_s, e) => days.has(new Date(e.now).getDay());
    },
  },
  hour: {
    help: 'the hour of the day (0-23) is within hour:22..6 (wraps past midnight; end hour excluded)',
    check: (c) => {
      const m = HOUR_RANGE.exec(c.value);
      return c.op === ':' && m && +m[1]! < 24 && +m[2]! <= 24 ? null : 'write it as hour:9..17.';
    },
    build: (c) => {
      const m = HOUR_RANGE.exec(c.value)!;
      const from = +m[1]!;
      const to = +m[2]!;
      return (_s, e) => {
        const h = new Date(e.now).getHours();
        return from <= to ? h >= from && h < to : h >= from || h < to;
      };
    },
  },
};

/** Text for the "only when browsing" column: an expression over the browse conditions. */
export function compileBrowse(text: string) {
  return compileExpression<unknown, BrowseEnv>(text, browseConditions);
}

export const BROWSE_HELP =
  'Conditions: ' +
  Object.entries(browseConditions)
    .map(([k, v]) => `${k} (${v.help})`)
    .join('; ') +
  '. Join with and / or / not and parentheses.';
