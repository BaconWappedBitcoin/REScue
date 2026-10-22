/**
 * The periodic check for thread subscriptions: about every ten minutes, while a Reddit tab is
 * open, ask Reddit how many comments each watched thread has now: one small read-only
 * `/comments/<post>.json?limit=1&depth=0` per thread (`num_comments`), paced by redditJson.ts (one
 * a second), and at most ROUND_MAX threads a round; with more, the next round carries on after the
 * last one asked. (It was one batched /api/info.json call until Reddit stopped serving that, live
 * 2026-10-21: HTTP 403 while signed in.) No background alarms: the content script of whichever tab
 * gets the cross-tab lock does it, so ten open tabs still make one round, not ten.
 */
import { browser } from 'wxt/browser';
import { MIN_GAP_MS, type BoundGetJson, type InfoPost } from '../../core/redditJson';
import { STORAGE_KEYS } from '../../core/storage/store';
import { applyCounts, pruneExpired, type Growth, type SubMap } from './subscriptionModel';

export const CHECK_EVERY_MS = 10 * 60_000;
/** Threads asked about per round: one request each, a second apart, so a round stays under 30 s. */
export const ROUND_MAX = Math.floor(25_000 / MIN_GAP_MS);
/** Where the watched threads are stored (a shared key, written immediately; in the backup). */
export const SUBS_KEY = STORAGE_KEYS.threadSubscriptions;
/** The raw key used before 2026-10-21; migrateLegacySubs moves it to SUBS_KEY. */
export const LEGACY_SUBS_KEY = 'rescue-subs:threadSubscriptions';
const LOCK_KEY = 'rescue-lock:threadSubscriptions';
/** The last thread the previous round asked about (shared by tabs, like the lock). */
const CURSOR_KEY = 'rescue-lock:threadSubscriptionsCursor';
const LOCK_HOLD_MS = 90_000;

/** The slice of browser.storage.local the lock uses (tests supply a stand-in). */
export interface LockArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** The slice of browser.storage.local the one-time key move uses. */
export interface MoveArea extends LockArea {
  remove(keys: string | string[]): Promise<void>;
}

/**
 * Move subscriptions from the old raw key to SUBS_KEY once: read the old key, write the new one
 * (entries already under the new key win), delete the old one. Nothing happens when it is gone.
 */
export async function migrateLegacySubs(
  area: MoveArea = browser.storage.local as unknown as MoveArea,
): Promise<void> {
  const old = (await area.get(LEGACY_SUBS_KEY))[LEGACY_SUBS_KEY];
  if (old === undefined) return;
  if (old && typeof old === 'object' && !Array.isArray(old)) {
    const cur = (await area.get(SUBS_KEY))[SUBS_KEY];
    const keep = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {};
    await area.set({ [SUBS_KEY]: { ...old, ...keep } });
  }
  await area.remove(LEGACY_SUBS_KEY);
}

export interface CheckLock {
  /** True when this tab may run a check now: nobody else holds the lock and none ran lately. */
  tryAcquire(now: number): Promise<boolean>;
}

interface LockRecord {
  owner: string;
  until: number;
  lastRun: number;
}

/**
 * A best-effort lock in extension storage. Storage has no compare-and-set, so a tab writes its
 * claim, waits a moment, and reads it back: if another tab's claim landed last, this one stands
 * down. The worst case is two tabs both checking once, which is harmless.
 */
export function storageLock(
  owner: string,
  area: LockArea = browser.storage.local as unknown as LockArea,
  settleMs = 250,
  everyMs = CHECK_EVERY_MS,
): CheckLock {
  const read = async (): Promise<LockRecord | undefined> => {
    const rec = (await area.get(LOCK_KEY))[LOCK_KEY];
    return rec && typeof rec === 'object' ? (rec as LockRecord) : undefined;
  };
  return {
    async tryAcquire(now) {
      const cur = await read();
      if (cur && now - cur.lastRun < everyMs - 5000) return false;
      if (cur && cur.until > now && cur.owner !== owner) return false;
      await area.set({ [LOCK_KEY]: { owner, until: now + LOCK_HOLD_MS, lastRun: now } });
      await new Promise((r) => setTimeout(r, settleMs));
      return (await read())?.owner === owner;
    },
  };
}

/** Where a round starts: after the thread the last round asked about last. */
export interface RoundCursor {
  get(): Promise<string | null>;
  set(lastId: string): Promise<void>;
}

/** A RoundCursor in extension storage, so whichever tab runs the next round carries on. */
export function storageCursor(
  area: LockArea = browser.storage.local as unknown as LockArea,
): RoundCursor {
  return {
    async get() {
      const v = (await area.get(CURSOR_KEY))[CURSOR_KEY];
      return typeof v === 'string' ? v : null;
    },
    set: (lastId) => area.set({ [CURSOR_KEY]: lastId }),
  };
}

/** Up to `max` of `ids` (sorted), starting after `last` and wrapping round. */
export function roundOf(ids: readonly string[], last: string | null, max: number): string[] {
  const sorted = [...ids].sort();
  if (sorted.length <= max) return sorted;
  const start = last === null ? 0 : sorted.findIndex((id) => id > last);
  const from = start < 0 ? 0 : start;
  return [...sorted.slice(from), ...sorted.slice(0, from)].slice(0, max);
}

export interface PollDeps {
  /** Fresh from storage every time (another tab may have changed it). */
  load(): Promise<SubMap>;
  save(subs: SubMap): void | Promise<void>;
  getJson: BoundGetJson;
  lock: CheckLock;
  /** Where the round-robin over many threads stands (default: kept in this tab only). */
  cursor?: RoundCursor;
  now(): number;
  onGrew(grew: Growth[], all: SubMap): void;
}

export type CheckOutcome = 'idle' | 'skipped' | 'failed' | 'ok';

let memoryLast: string | null = null;
const memoryCursor: RoundCursor = {
  get: async () => memoryLast,
  set: async (id) => void (memoryLast = id),
};

export async function runCheck(deps: PollDeps): Promise<CheckOutcome> {
  const pruned = pruneExpired(await deps.load(), deps.now());
  const ids = Object.keys(pruned);
  if (!ids.length) return 'idle';
  if (!(await deps.lock.tryAcquire(deps.now()))) return 'skipped';

  const cursor = deps.cursor ?? memoryCursor;
  const round = roundOf(ids, await cursor.get(), ROUND_MAX);
  const posts: InfoPost[] = [];
  let last: string | null = null;
  for (const id of round) {
    const res = await deps.getJson('comments', { id, limit: 1, depth: 0 }, { fresh: true });
    if (!res.ok) {
      // A thread Reddit has no page for (removed, a 404) is skipped; a pause, a refusal, a block
      // or a changed format ends the round, and the next one starts with this thread again.
      if (res.reason === 'http' && !/\b(403|429)\b/.test(res.message)) {
        last = id;
        continue;
      }
      break;
    }
    last = id;
    posts.push(res.data.post);
  }
  if (last !== null) await cursor.set(last);
  if (!posts.length) return 'failed';
  // Re-read: the reader may have subscribed, unsubscribed or opened a thread meanwhile.
  const fresh = pruneExpired(await deps.load(), deps.now());
  const { subs, grew } = applyCounts(fresh, posts);
  await deps.save(subs);
  if (grew.length) deps.onGrew(grew, subs);
  return 'ok';
}
