/**
 * The periodic check for thread subscriptions: about every ten minutes, while a Reddit tab is
 * open, ask Reddit (one batched read-only /api/info.json call per 100 threads) how many comments
 * each watched thread has now. No background alarms: the content script of whichever tab gets the
 * cross-tab lock does it, so ten open tabs still make one request, not ten.
 */
import { browser } from 'wxt/browser';
import { INFO_MAX_IDS, type BoundGetJson, type InfoPost } from '../../core/redditJson';
import { applyCounts, chunk, pruneExpired, type Growth, type SubMap } from './subscriptionModel';

export const CHECK_EVERY_MS = 10 * 60_000;
/** Where the watched threads are stored (its own key, written immediately). */
export const SUBS_KEY = 'rescue-subs:threadSubscriptions';
const LOCK_KEY = 'rescue-lock:threadSubscriptions';
const LOCK_HOLD_MS = 90_000;

/** The slice of browser.storage.local the lock uses (tests supply a stand-in). */
export interface LockArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
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

export interface PollDeps {
  /** Fresh from storage every time (another tab may have changed it). */
  load(): Promise<SubMap>;
  save(subs: SubMap): void | Promise<void>;
  getJson: BoundGetJson;
  lock: CheckLock;
  now(): number;
  onGrew(grew: Growth[], all: SubMap): void;
}

export type CheckOutcome = 'idle' | 'skipped' | 'failed' | 'ok';

export async function runCheck(deps: PollDeps): Promise<CheckOutcome> {
  const pruned = pruneExpired(await deps.load(), deps.now());
  const ids = Object.keys(pruned);
  if (!ids.length) return 'idle';
  if (!(await deps.lock.tryAcquire(deps.now()))) return 'skipped';

  const posts: InfoPost[] = [];
  for (const batch of chunk(ids, INFO_MAX_IDS)) {
    const res = await deps.getJson('info', { id: batch }, { fresh: true });
    if (!res.ok) return 'failed';
    posts.push(...res.data.posts);
  }
  // Re-read: the reader may have subscribed, unsubscribed or opened a thread meanwhile.
  const fresh = pruneExpired(await deps.load(), deps.now());
  const { subs, grew } = applyCounts(fresh, posts);
  await deps.save(subs);
  if (grew.length) deps.onGrew(grew, subs);
  return 'ok';
}
