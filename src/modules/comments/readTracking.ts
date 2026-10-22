/**
 * Read tracking shared by readComments, newCommentCount, commentNavigator and autoHide: the `read`
 * storage key (contracts/storage-schema.md), one ReadRecord per thread. Pure functions plus a small
 * store that keeps the record each thread had BEFORE this page view (`prior`), so markers stay put
 * while the visit itself is being recorded. Ported in spirit from RES lib/modules/readComments.js
 * and newCommentCount.js (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */
import { pruneRead, type ReadRecord } from '../../core/storage/prune';
import type { SharedData } from '../../core/types';

export type ReadMap = Record<string, ReadRecord>;

/** Keep only well-formed records from whatever storage holds. */
export function sanitizeRead(raw: unknown): ReadMap {
  const out: ReadMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, r] of Object.entries(raw as Record<string, unknown>)) {
    if (!r || typeof r !== 'object') continue;
    const { lastVisit, commentCountAtVisit } = r as Partial<ReadRecord>;
    if (typeof lastVisit !== 'number' || !Number.isFinite(lastVisit)) continue;
    out[id] = {
      lastVisit,
      commentCountAtVisit:
        typeof commentCountAtVisit === 'number' && Number.isFinite(commentCountAtVisit)
          ? Math.max(0, Math.floor(commentCountAtVisit))
          : 0,
    };
  }
  return out;
}

/** The map with this visit recorded (and the retention rules of R12 applied). */
export function recordVisit(
  read: ReadMap,
  threadId: string,
  commentCount: number,
  now: number,
): ReadMap {
  const record: ReadRecord = {
    lastVisit: now,
    commentCountAtVisit: Math.max(0, Math.floor(commentCount) || 0),
  };
  return pruneRead({ ...read, [threadId]: record }, now);
}

/** Comments added since the recorded visit; 0 for a thread never visited. */
export function newCommentCount(record: ReadRecord | undefined, commentCount: number): number {
  if (!record) return 0;
  return Math.max(0, Math.floor(commentCount) - record.commentCountAtVisit);
}

/** Was a comment created after the recorded visit? Never true without a record or a date. */
export function isNewComment(record: ReadRecord | undefined, created: Date | null): boolean {
  return !!record && !!created && created.getTime() > record.lastVisit;
}

/**
 * Was a comment already there at the recorded visit? True only with a record and a date; a
 * comment without a date is never called read, so nothing is hidden or skipped by guesswork.
 */
export function isReadComment(record: ReadRecord | undefined, created: Date | null): boolean {
  return !!record && !!created && created.getTime() <= record.lastVisit;
}

export class ReadStore {
  private records: ReadMap = {};
  private snapshot: ReadMap = {};
  private visited = new Set<string>();
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly data: SharedData,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    this.records = pruneRead(sanitizeRead(await this.data.get<unknown>('read')), this.now());
    this.snapshot = { ...this.records };
  }

  /** What was recorded for the thread before this page view. */
  prior(threadId: string): ReadRecord | undefined {
    return this.snapshot[threadId];
  }

  /** Threads recorded before this page view. */
  hasRead(threadId: string): boolean {
    return threadId in this.snapshot;
  }

  /** A new page view: what has been recorded so far becomes the "before". */
  newView(): void {
    this.snapshot = { ...this.records };
    this.visited.clear();
  }

  /** Record this page view of a thread, once. Resolves when the write has been handed over. */
  visit(threadId: string, commentCount: number): Promise<void> {
    if (this.visited.has(threadId)) return this.chain;
    this.visited.add(threadId);
    const now = this.now();
    this.records = recordVisit(this.records, threadId, commentCount, now);
    // Merge into what storage holds now (another tab may have written), one write at a time.
    this.chain = this.chain.then(async () => {
      const fresh = sanitizeRead(await this.data.get<unknown>('read'));
      this.data.set('read', recordVisit(fresh, threadId, commentCount, now));
    });
    return this.chain;
  }
}

let shared: ReadStore | null = null;
let opening: Promise<ReadStore> | null = null;
/** Bumped by closeReadStore, so a load still in flight cannot reinstate a closed store. */
let generation = 0;

/** The one store for this page, created and loaded on first use. */
export function openReadStore(data: SharedData): Promise<ReadStore> {
  opening ??= (async () => {
    const gen = generation;
    const store = new ReadStore(data);
    await store.load();
    if (gen === generation) shared = store;
    return store;
  })();
  return opening;
}

/** The store once readComments has started, else null (modules degrade without it). */
export const sharedReadStore = (): ReadStore | null => shared;

export function closeReadStore(): void {
  generation++;
  shared = null;
  opening = null;
}
