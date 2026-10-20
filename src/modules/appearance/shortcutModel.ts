/**
 * The data side of the subreddit shortcut bar (subredditManager): turning a stored row into a link,
 * and the edits the bar makes (add, update, delete, reorder, sort, migrate). Pure functions on the
 * rows of the `subreddits` table option; no DOM. Ported in spirit from RES
 * lib/modules/subredditManager.js (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */

/** A stored row. Unknown fields are kept when a row is edited or moved. */
export type RawRow = Record<string, unknown>;

const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;
const GROUP = /^(?:r\/)?([A-Za-z0-9_]{2,21}(?:\+[A-Za-z0-9_]{2,21})+)$/i;
const PATH = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/;

export const FORMAT_HELP =
  'Use a subreddit name (askscience), r/name, several joined with + (a+b), u/name/m/feed, or a path such as r/pics/top.';

/**
 * The same-origin path a shortcut points to, or null if it is not a usable shortcut. A single bare
 * word is a subreddit; `a+b` is a group of subreddits; `u/x` is a profile; anything else is a path
 * on Reddit. Full URLs are refused.
 */
export function shortcutHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!t) return null;
  const group = GROUP.exec(t);
  if (group) return `/r/${group[1]}/`;
  if (SUBREDDIT.test(t)) return `/r/${t}/`;
  if (!PATH.test(t)) return null;
  const rest = t.slice(t.indexOf('/') + 1);
  return /^u\//i.test(t) ? `/user/${rest}/` : `/${t}/`;
}

/** A shortcut's text: its label, else the subreddit name without r/ (as on old Reddit), else the path. */
export function shortcutLabel(target: string, label: unknown): string {
  if (typeof label === 'string' && label.trim()) return label.trim().slice(0, 40);
  const href = shortcutHref(target);
  return href
    ? href
        .replace(/^\/|\/$/g, '')
        .replace(/^r\//, '')
        .replace(/^user\//, 'u/')
    : target;
}

/** The subreddits of a `a+b` group target, or null when the target is not a group. */
export function groupMembers(target: unknown): string[] | null {
  if (typeof target !== 'string') return null;
  const m = GROUP.exec(target.trim().replace(/^\/+/, '').replace(/\/+$/, ''));
  return m ? m[1]!.split('+') : null;
}

export interface ShortcutItem {
  /** Position of the row in the stored table (rows that are not usable links are skipped). */
  index: number;
  target: string;
  label: string;
  text: string;
  href: string;
  members: string[] | null;
}

/** The links the stored rows describe, in order. */
export function shortcutItems(rows: readonly RawRow[]): ShortcutItem[] {
  const out: ShortcutItem[] = [];
  rows.forEach((r, index) => {
    const href = shortcutHref(r.target);
    if (!href) return;
    const target = String(r.target).trim();
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    out.push({
      index,
      target,
      label,
      text: shortcutLabel(target, r.label),
      href,
      members: groupMembers(target),
    });
  });
  return out;
}

const hasDate = (r: RawRow): boolean => typeof r.addedAt === 'number' && Number.isFinite(r.addedAt);

/**
 * Give rows saved before the date column existed an `addedAt`. They get consecutive times from
 * `now`, so "date added" keeps the order they already had.
 */
export function migrateRows(
  rows: readonly RawRow[],
  now: number,
): { rows: RawRow[]; changed: boolean } {
  let changed = false;
  let n = 0;
  const out = rows.map((r) => {
    if (hasDate(r)) return r;
    changed = true;
    return { ...r, addedAt: now + n++ };
  });
  return { rows: out, changed };
}

export function addRow(
  rows: readonly RawRow[],
  target: string,
  label: string,
  now: number,
): RawRow[] {
  return [...rows, { target: target.trim(), label: label.trim(), addedAt: now }];
}

export function updateRow(
  rows: readonly RawRow[],
  index: number,
  target: string,
  label: string,
): RawRow[] {
  return rows.map((r, i) =>
    i === index ? { ...r, target: target.trim(), label: label.trim() } : r,
  );
}

export function deleteRow(rows: readonly RawRow[], index: number): RawRow[] {
  return rows.filter((_, i) => i !== index);
}

/** Move a row so it ends up at index `to` (before the row it lands on when moving left, after it when moving right). */
export function moveRow(rows: readonly RawRow[], from: number, to: number): RawRow[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) {
    return [...rows];
  }
  const out = [...rows];
  const [row] = out.splice(from, 1);
  out.splice(to, 0, row!);
  return out;
}

export type SortMode = 'nameAsc' | 'nameDesc' | 'dateAsc' | 'visitDesc';

export const SORT_MODES: Array<{ mode: SortMode; label: string }> = [
  { mode: 'nameAsc', label: 'Name A–Z' },
  { mode: 'nameDesc', label: 'Name Z–A' },
  { mode: 'dateAsc', label: 'Date added' },
  { mode: 'visitDesc', label: 'Last visited' },
];

/** When each subreddit (lower-case name) was last opened, as recorded by shortcutVisits.ts. */
export type Visits = Record<string, number>;

/** The latest visit to the subreddit(s) a shortcut points to (0 when never visited or not a subreddit). */
export function lastVisit(item: Pick<ShortcutItem, 'href' | 'members'>, visits: Visits): number {
  const names = item.members ?? [/^\/r\/([^/+]+)\//i.exec(item.href)?.[1] ?? ''];
  return Math.max(0, ...names.map((n) => visits[n.toLowerCase()] ?? 0));
}

const byText = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Sort the rows. Rows that are not usable links keep their order at the end. "Last visited" puts
 * the most recently opened first; links never visited follow in their current order.
 */
export function sortRows(rows: readonly RawRow[], mode: SortMode, visits: Visits = {}): RawRow[] {
  const usable = shortcutItems(rows).map((i) => ({ item: i, row: rows[i.index]! }));
  const usableRows = new Set(usable.map((u) => u.row));
  const rest = rows.filter((r) => !usableRows.has(r));
  const dateOf = (r: RawRow): number => (hasDate(r) ? (r.addedAt as number) : 0);
  usable.sort((a, b) => {
    if (mode === 'dateAsc') return dateOf(a.row) - dateOf(b.row);
    if (mode === 'visitDesc') return lastVisit(b.item, visits) - lastVisit(a.item, visits);
    const c = byText(a.item.text, b.item.text);
    return mode === 'nameAsc' ? c : -c;
  });
  return [...usable.map((u) => u.row), ...rest];
}

const subHref = (sub: string): string => `/r/${sub.toLowerCase()}/`;

/** Whether the bar already has a shortcut to exactly this subreddit. */
export function hasSubreddit(rows: readonly RawRow[], sub: string): boolean {
  return shortcutItems(rows).some((i) => i.href.toLowerCase() === subHref(sub));
}

/** The rows without any shortcut to exactly this subreddit. */
export function removeSubreddit(rows: readonly RawRow[], sub: string): RawRow[] {
  const gone = new Set(
    shortcutItems(rows)
      .filter((i) => i.href.toLowerCase() === subHref(sub))
      .map((i) => i.index),
  );
  return rows.filter((_, i) => !gone.has(i));
}

export interface StaticLinkOptions {
  showDefaults: boolean;
  linkRandom: boolean;
  linkFriends: boolean;
  linkMod: boolean;
  linkModqueue: boolean;
  linkSaved: boolean;
  /** Link to r/randnsfw (RES linkRandNSFW). */
  linkRandNSFW?: boolean;
  /** A "Dashboard" word that opens the dashboard panel (set by the module from the dashboard's own option). */
  linkDashboard?: boolean;
}

/** The fixed links in front of your own: Home and r/popular, then the optional ones (no r/all: Reddit now redirects it home). */
export function staticLinks(
  o: StaticLinkOptions,
  session: { signedIn: boolean; username: string | null },
): Array<{ text: string; href: string }> {
  const out: Array<{ text: string; href: string }> = [];
  if (o.showDefaults) {
    out.push({ text: 'Home', href: '/' }, { text: 'popular', href: '/r/popular/' });
  }
  if (o.linkDashboard) out.push({ text: 'Dashboard', href: '#rescue:dashboard' });
  if (o.linkRandom) out.push({ text: 'Random', href: '/r/random/' });
  if (o.linkRandNSFW) out.push({ text: 'RandNSFW', href: '/r/randnsfw/' });
  if (session.signedIn) {
    if (o.linkFriends) out.push({ text: 'Friends', href: '/r/friends/' });
    if (o.linkMod) out.push({ text: 'Mod', href: '/r/mod/' });
    if (o.linkModqueue) out.push({ text: 'Modqueue', href: '/r/mod/about/modqueue/' });
    if (o.linkSaved && session.username) {
      out.push({ text: 'Saved', href: `/user/${encodeURIComponent(session.username)}/saved/` });
    }
  }
  return out;
}
