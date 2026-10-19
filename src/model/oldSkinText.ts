/**
 * Old Reddit look: the words and numbers REScue's own replacement rows show (oldRedditSkin). Pure
 * functions, no page access: "2 hours ago", "12.9k", "196 points", "1 comment", and the sort tabs of
 * a listing. See modules/appearance/oldSkin*.ts for where they are drawn.
 */
import type { Route } from '../core/types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Old Reddit's relative time: "just now", "5 minutes ago", "an hour ago", "3 days ago", "2 months ago". */
export function agoText(then: Date | null, now: number = Date.now()): string {
  if (!then || Number.isNaN(then.getTime())) return '';
  const ms = Math.max(0, now - then.getTime());
  const unit = (n: number, one: string, many: string): string =>
    n === 1 ? one : `${n} ${many}`;
  if (ms < MIN) return 'just now';
  if (ms < HOUR) return `${unit(Math.floor(ms / MIN), '1 minute', 'minutes')} ago`;
  if (ms < DAY) return `${unit(Math.floor(ms / HOUR), 'an hour', 'hours')} ago`;
  if (ms < 30 * DAY) return `${unit(Math.floor(ms / DAY), '1 day', 'days')} ago`;
  if (ms < 365 * DAY) return `${unit(Math.floor(ms / (30 * DAY)), '1 month', 'months')} ago`;
  return `${unit(Math.floor(ms / (365 * DAY)), '1 year', 'years')} ago`;
}

/** The number in a vote column: plain up to 9999, then one decimal and a k ("12.9k"). */
export function compactScore(n: number): string {
  if (!Number.isFinite(n)) return '•';
  const abs = Math.abs(n);
  if (abs < 10_000) return String(n);
  const k = Math.round((abs / 1000) * 10) / 10;
  return `${n < 0 ? '-' : ''}${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
}

/** "196 points", "1 point", "-1 points" (old Reddit spells it that way). */
export function pointsText(n: number): string {
  return `${n} ${n === 1 ? 'point' : 'points'}`;
}

/** "137 comments", "1 comment", and "comment" for a post nobody has answered, as old Reddit does. */
export function commentsText(n: number): string {
  if (n <= 0) return 'comment';
  return `${n} ${n === 1 ? 'comment' : 'comments'}`;
}

/** The domain shown after a link title: "(autoblog.com)"; self posts show "(self.sub)". */
export function domainText(domain: string, subreddit: string, isSelf: boolean): string {
  if (isSelf) return subreddit ? `(self.${subreddit})` : '';
  return domain ? `(${domain})` : '';
}

export interface SortTab {
  key: string;
  label: string;
  href: string;
  active: boolean;
}

const SORT_ORDER = ['best', 'hot', 'new', 'rising', 'controversial', 'top'] as const;
const SORT_NAMES: ReadonlySet<string> = new Set(SORT_ORDER);

/** What Reddit's own sort dropdown lists: a sort and where it goes. */
export interface NativeSort {
  key: string;
  href: string;
  selected: boolean;
}

/** The sort a listing path names ("/r/x/top/" is "top"), or null for the listing's default. */
export function pathSort(path: string): string | null {
  const last = path.replace(/\/+$/, '').split('/').pop()?.toLowerCase() ?? '';
  return SORT_NAMES.has(last) ? last : null;
}

/** Where a computed sort of this listing lives, or null when the listing has no such URL family. */
function sortHref(route: Route, sort: string): string | null {
  switch (route.kind) {
    case 'front':
      return `/${sort}/`;
    case 'subreddit':
    case 'all':
    case 'popular':
      return route.subreddit ? `/r/${route.subreddit}/${sort}/` : null;
    default:
      return null;
  }
}

/** Which sorts a computed URL is offered for: `best` exists only on the home feed. */
const computedOk = (route: Route, sort: string): boolean => {
  if (route.kind === 'popular') return sort === 'hot' || sort === 'new' || sort === 'top' || sort === 'rising';
  if (sort === 'best') return route.kind === 'front';
  return true;
};

/**
 * The old Reddit sort tabs (best, hot, new, rising, controversial, top) of the current listing.
 * Reddit's own dropdown wins where it lists a sort (its links are the real ones, with any query
 * Reddit keeps); a sort it does not list is computed from the route for home, subreddit, r/all and
 * r/popular, and left out for any other listing, so a tab never leads to a URL REScue invented.
 */
export function sortTabs(route: Route, native: readonly NativeSort[]): SortTab[] {
  const byKey = new Map(native.map((n) => [n.key.toLowerCase(), n]));
  const current =
    native.find((n) => n.selected)?.key.toLowerCase() ??
    pathSort(route.path) ??
    (route.kind === 'front' ? 'best' : 'hot');
  const tabs: SortTab[] = [];
  for (const key of SORT_ORDER) {
    const n = byKey.get(key);
    const href = n?.href ?? (computedOk(route, key) ? sortHref(route, key) : null);
    if (href) tabs.push({ key, label: key, href, active: key === current });
  }
  return tabs;
}
