/**
 * Thread subscriptions, the data side (RES newCommentCount showSubscribeButton / subscriptionLength,
 * US6): which threads the reader watches, when each watch ends, and how many comments each had
 * the last time anyone looked. Pure functions on a record keyed by post full name ("t3_abc");
 * no DOM, no storage, no network. Ported in spirit from RES lib/modules/newCommentCount.js
 * (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */
import type { InfoPost } from '../../core/redditJson';

export interface Sub {
  /** Post full name, e.g. "t3_abc123". */
  id: string;
  title: string;
  /** Same-origin path of the thread, e.g. "/r/aww/comments/abc123/a_dog/". */
  permalink: string;
  subreddit: string;
  subscribedAt: number;
  /** The watch ends (and the entry is dropped) at this time. */
  expiresAt: number;
  /** Comment count the last time the reader opened the thread or a check ran. */
  lastCount: number;
  /** Comments added since the reader last opened the thread. */
  newCount: number;
}
export type SubMap = Record<string, Sub>;

export const DAY_MS = 86_400_000;
export const MAX_SUBS = 200;
const FULLNAME = /^t3_[a-z0-9]{1,16}$/i;

/** A same-origin path for a thread permalink, or null when it is anything else. */
export function threadPath(permalink: unknown): string | null {
  if (typeof permalink !== 'string') return null;
  try {
    const u = new URL(permalink, 'https://www.reddit.com');
    return /^\/(?:r|user)\/[^/]+\/comments\/[a-z0-9]+(?:\/|$)/i.test(u.pathname)
      ? u.pathname
      : null;
  } catch {
    return null;
  }
}

const num = (v: unknown, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : d;

/** Coerce whatever storage holds into a SubMap. Broken entries are dropped. */
export function sanitizeSubs(raw: unknown): SubMap {
  const out: SubMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const v of Object.values(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const path = threadPath(r.permalink);
    if (typeof r.id !== 'string' || !FULLNAME.test(r.id) || !path) continue;
    out[r.id] = {
      id: r.id,
      title: typeof r.title === 'string' ? r.title.slice(0, 300) : r.id,
      permalink: path,
      subreddit: typeof r.subreddit === 'string' ? r.subreddit.slice(0, 40) : '',
      subscribedAt: num(r.subscribedAt, 0),
      expiresAt: num(r.expiresAt, 0),
      lastCount: num(r.lastCount, 0),
      newCount: num(r.newCount, 0),
    };
  }
  return out;
}

export interface WatchedPost {
  id: string;
  title: string;
  permalink: string;
  subreddit: string;
  commentCount: number;
}

/** Start (or renew) a watch. The count now is the baseline; nothing is new yet. */
export function addSub(subs: SubMap, post: WatchedPost, days: number, now: number): SubMap {
  const path = threadPath(post.permalink);
  if (!path || !FULLNAME.test(post.id)) return subs;
  const prev = subs[post.id];
  const next: SubMap = {
    ...subs,
    [post.id]: {
      id: post.id,
      title: post.title,
      permalink: path,
      subreddit: post.subreddit,
      subscribedAt: prev?.subscribedAt ?? now,
      expiresAt: now + Math.max(1, days) * DAY_MS,
      lastCount: post.commentCount,
      newCount: prev?.newCount ?? 0,
    },
  };
  // Over the cap: drop the watches that end soonest.
  const ids = Object.keys(next);
  if (ids.length > MAX_SUBS) {
    ids.sort((a, b) => next[a]!.expiresAt - next[b]!.expiresAt);
    for (const id of ids.slice(0, ids.length - MAX_SUBS)) delete next[id];
  }
  return next;
}

export function removeSub(subs: SubMap, id: string): SubMap {
  if (!(id in subs)) return subs;
  const { [id]: _gone, ...rest } = subs;
  return rest;
}

/** Drop the watches that have ended. */
export function pruneExpired(subs: SubMap, now: number): SubMap {
  const live = Object.values(subs).filter((s) => s.expiresAt > now);
  return live.length === Object.keys(subs).length
    ? subs
    : Object.fromEntries(live.map((s) => [s.id, s]));
}

export interface Growth {
  sub: Sub;
  /** Comments added since the previous check. */
  added: number;
}

/**
 * Compare Reddit's current counts with the stored ones. A count that grew adds to `newCount` and
 * becomes the new baseline; one that shrank (comments deleted) only moves the baseline down, so
 * later growth still shows. Threads Reddit did not return are left alone.
 */
export function applyCounts(
  subs: SubMap,
  posts: readonly InfoPost[],
): { subs: SubMap; grew: Growth[] } {
  const next: SubMap = { ...subs };
  const grew: Growth[] = [];
  for (const p of posts) {
    const cur = next[p.id];
    if (!cur) continue;
    if (p.numComments > cur.lastCount) {
      const added = p.numComments - cur.lastCount;
      next[p.id] = { ...cur, lastCount: p.numComments, newCount: cur.newCount + added };
      grew.push({ sub: next[p.id]!, added });
    } else if (p.numComments < cur.lastCount) {
      next[p.id] = { ...cur, lastCount: p.numComments };
    }
  }
  return { subs: next, grew };
}

/** The reader opened the thread and saw `count` comments: nothing is new any more. */
export function markSeen(subs: SubMap, id: string, count: number): SubMap {
  const cur = subs[id];
  if (!cur || (cur.newCount === 0 && cur.lastCount === count)) return subs;
  if (count < cur.lastCount) return subs; // an older cached page: they have not seen the new ones
  return { ...subs, [id]: { ...cur, lastCount: count, newCount: 0 } };
}

export function clearNew(subs: SubMap): SubMap {
  return Object.fromEntries(Object.entries(subs).map(([id, s]) => [id, { ...s, newCount: 0 }]));
}

export const totalNew = (subs: SubMap): number =>
  Object.values(subs).reduce((n, s) => n + s.newCount, 0);

/** Threads with new comments first, then the ones that end soonest. */
export function listSubs(subs: SubMap): Sub[] {
  return Object.values(subs).sort(
    (a, b) => Number(b.newCount > 0) - Number(a.newCount > 0) || a.expiresAt - b.expiresAt,
  );
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const plural = (n: number): string => (n === 1 ? '1 new comment' : `${n} new comments`);
