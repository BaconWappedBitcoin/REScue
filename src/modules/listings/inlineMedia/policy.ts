/**
 * inlineMedia policy: which posts start with their media collapsed. Pure functions over the
 * module's options, so the rules can be tested without a page. Also the list of posts you expanded
 * yourself, kept on this device and pruned the way the read history is (90 days, newest first,
 * capped).
 */
import { pruneOlderThan, READ_MAX_AGE_MS } from '../../../core/storage/prune';
import type { MediaKind } from '../../../model/inline-media';

export type Scope = 'listings' | 'both' | 'threads';
export type OnlyTypes = 'all' | 'sensitive' | 'video' | 'gallery';
export type SubAction = 'always show' | 'always collapse';

export const SUB_ACTIONS: SubAction[] = ['always show', 'always collapse'];

export interface Policy {
  /** Posts: the switch AND "also hide the post's own media" (a subreddit row still decides alone). */
  collapseMedia: boolean;
  /** Comments: the main switch, "Hide inline media". */
  hideCommentMedia?: boolean;
  scope: Scope;
  onlyTypes: OnlyTypes;
  /** Lower-cased subreddit name to what to do with its posts. */
  subs: ReadonlyMap<string, SubAction>;
}

/** What the policy needs to know about one post. */
export interface PostFacts {
  subreddit: string;
  nsfw: boolean;
  spoiler: boolean;
  kind: MediaKind;
}

const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;

export const subKey = (name: unknown): string =>
  String(name ?? '')
    .trim()
    .replace(/^\/?r\//i, '')
    .toLowerCase();

/** Rejects a row at input. A blank row passes: it is ignored until it has a subreddit. */
export function validateSubRow(row: Record<string, unknown>): string | null {
  const sub = subKey(row.subreddit);
  if (sub && !SUBREDDIT.test(sub)) return 'A subreddit name has 2 to 21 letters, digits or _.';
  return null;
}

/** The table as a lookup; rows without a valid subreddit or a known action are skipped. */
export function subTable(rows: Array<Record<string, unknown>>): Map<string, SubAction> {
  const out = new Map<string, SubAction>();
  for (const r of rows) {
    const key = subKey(r.subreddit);
    const action = String(r.action ?? '');
    if (!SUBREDDIT.test(key) || !(SUB_ACTIONS as string[]).includes(action)) continue;
    out.set(key, action as SubAction);
  }
  return out;
}

/** Does the scope cover this page? Search results and profiles count as listings. */
export function inScope(scope: Scope, routeKind: string): boolean {
  if (scope === 'both') return true;
  return scope === 'threads' ? routeKind === 'thread' : routeKind !== 'thread';
}

function typeMatches(only: OnlyTypes, f: PostFacts): boolean {
  switch (only) {
    case 'all':
      return true;
    case 'sensitive':
      return f.nsfw || f.spoiler;
    case 'video':
      return f.kind === 'video';
    case 'gallery':
      return f.kind === 'gallery';
  }
}

/**
 * Should this post start collapsed? A subreddit rule decides for its own posts whatever the
 * switch and the type filter say; otherwise the switch must be on and the type must match. The
 * scope applies to everything.
 */
export function shouldCollapse(policy: Policy, routeKind: string, f: PostFacts): boolean {
  if (!inScope(policy.scope, routeKind)) return false;
  const rule = policy.subs.get(subKey(f.subreddit));
  if (rule) return rule === 'always collapse';
  return policy.collapseMedia && typeMatches(policy.onlyTypes, f);
}

/**
 * Is media inside comments hidden on this page? A subreddit row decides for the comments of its
 * own subreddit (the page's), whatever the switch says; otherwise the switch decides. The page
 * scope and the type filter are for posts only: comments are hidden wherever comments render.
 */
export function commentMediaHidden(
  hideCommentMedia: boolean,
  subs: ReadonlyMap<string, SubAction>,
  subreddit: string | undefined,
): boolean {
  const rule = subreddit ? subs.get(subKey(subreddit)) : undefined;
  return rule ? rule === 'always collapse' : hideCommentMedia;
}

/** A key that changes whenever a change of settings can change which posts start collapsed. */
export function policyKey(p: Policy): string {
  return JSON.stringify([
    p.collapseMedia,
    p.hideCommentMedia ?? false,
    p.scope,
    p.onlyTypes,
    [...p.subs],
  ]);
}

// --- posts you expanded --------------------------------------------------------------------------

export type ExpandedMap = Record<string, number>;
export const EXPANDED_MAX = 20_000;

/** Keep only well-formed entries from whatever storage holds. */
export function sanitizeExpanded(raw: unknown): ExpandedMap {
  const out: ExpandedMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, at] of Object.entries(raw as Record<string, unknown>))
    if (typeof at === 'number' && Number.isFinite(at)) out[id] = at;
  return out;
}

/** Drop entries older than 90 days, then keep the newest EXPANDED_MAX. */
export function pruneExpanded(map: ExpandedMap, now = Date.now()): ExpandedMap {
  const fresh = Object.entries(pruneOlderThan(map, READ_MAX_AGE_MS, now));
  if (fresh.length > EXPANDED_MAX) {
    fresh.sort((a, b) => b[1] - a[1]);
    fresh.length = EXPANDED_MAX;
  }
  return Object.fromEntries(fresh);
}
