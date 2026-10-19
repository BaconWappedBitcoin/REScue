/**
 * Last-visit memory and per-account shortcut lists for the subreddit shortcut bar (RES
 * subredditManager: storeSubredditVisit, storeSubredditVisitIncognito, shortcutsPerAccount).
 * Pure functions on plain data; the module keeps the results in its own scoped storage, on this
 * device only. Ported in spirit from RES lib/modules/subredditManager.js (GPL-3.0, the RES
 * contributors, commit 4defffc); the code is new.
 */
import type { RawRow, Visits } from './shortcutModel';

/** Most subreddits remembered; the oldest visits are dropped first. */
export const MAX_VISITS = 500;

const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;

/** Visits with `sub` opened at `now`. A name that is not a single subreddit (a+b, a path) is ignored. */
export function recordVisit(visits: Visits, sub: string | undefined, now: number): Visits {
  if (!sub || !SUBREDDIT.test(sub)) return visits;
  const next: Visits = { ...visits, [sub.toLowerCase()]: now };
  const keys = Object.keys(next);
  if (keys.length <= MAX_VISITS) return next;
  keys.sort((a, b) => next[b]! - next[a]!);
  return Object.fromEntries(keys.slice(0, MAX_VISITS).map((k) => [k, next[k]!]));
}

/** Coerce whatever storage holds into Visits. */
export function sanitizeVisits(raw: unknown): Visits {
  const out: Visits = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

/** Whether a visit may be recorded now: the option is on, and private windows need their own opt-in. */
export function mayRecordVisit(
  o: { storeSubredditVisit: boolean; storeSubredditVisitIncognito: boolean },
  incognito: boolean,
): boolean {
  return o.storeSubredditVisit && (!incognito || o.storeSubredditVisitIncognito);
}

/** True in a private (incognito) window, where the browser API reports it. */
export function inIncognito(): boolean {
  try {
    const api =
      (globalThis as { browser?: unknown; chrome?: unknown }).browser ??
      (globalThis as { chrome?: unknown }).chrome;
    return (
      (api as { extension?: { inIncognitoContext?: boolean } } | undefined)?.extension
        ?.inIncognitoContext === true
    );
  } catch {
    return false;
  }
}

/** Shortcut lists kept per account (the `subreddits` option holds the current account's list). */
export interface AccountLists {
  /** The account whose list is in the option now ('' = signed out); undefined = not claimed yet. */
  current?: string;
  lists: Record<string, RawRow[]>;
}

export const accountKey = (s: { signedIn: boolean; username: string | null }): string =>
  s.signedIn && s.username ? s.username.toLowerCase() : '';

export function sanitizeAccounts(raw: unknown): AccountLists {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AccountLists>;
  const lists: Record<string, RawRow[]> = {};
  if (r.lists && typeof r.lists === 'object') {
    for (const [k, v] of Object.entries(r.lists)) if (Array.isArray(v)) lists[k] = v as RawRow[];
  }
  return { ...(typeof r.current === 'string' ? { current: r.current } : {}), lists };
}

/**
 * The account on this page has `key`; `rows` is what the option holds. The first account to use
 * the bar keeps the list it already had. When another account shows up, the previous account's list
 * is put away and this account's own list (empty at first) takes its place. `rows` in the result is
 * the list to write into the option, or null when the option already holds the right one.
 */
export function switchAccount(
  state: AccountLists,
  key: string,
  rows: readonly RawRow[],
): { state: AccountLists; rows: RawRow[] | null } {
  if (state.current === undefined || state.current === key) {
    return { state: { current: key, lists: { ...state.lists, [key]: [...rows] } }, rows: null };
  }
  const lists = { ...state.lists, [state.current]: [...rows] };
  const own = lists[key] ?? [];
  return { state: { current: key, lists }, rows: own };
}

/** Per-account lists switched off: forget who owned the option, so turning it on again starts fresh. */
export function releaseAccounts(state: AccountLists): AccountLists {
  const { current: _current, ...rest } = state;
  return rest;
}
