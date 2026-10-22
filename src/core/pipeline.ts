/**
 * MutationObserver -> rAF-batched work queue emitting ItemBatch. Content arrives after load,
 * forever (research R3), so this runs for the life of the page. Source elements are stamped once
 * consumed; comments are re-threaded against the whole tree so late batches get correct parents.
 */
import { C } from '../contracts/reddit';
import {
  parseAppendedComments,
  parseComments,
  sortedByPosition,
  type ThreadCache,
  type ThreadTail,
} from '../model/comment';
import { parsePost, PostDeduper } from '../model/post';
import { parseSearchPost } from '../model/search-post';
import { parseProfileComment } from '../model/profile-comment';
import { ContractTally } from '../model/tally';
import type { Comment, Post, ProfileComment } from '../model/types';
import type { ItemBatch } from './types';

export const BUDGET_MS = 100;
/**
 * At most this many items go to the modules in one go; a larger batch (a whole thread at once, a
 * settings change re-running a 5,000-comment page) is handed over in slices with a pause between
 * them, so the page keeps answering the reader meanwhile.
 */
export const SLICE_SIZE = 200;
const SEEN = 'data-rescue-seen';
/** Tags that can become a post, search result or profile comment (search results match on attribute later). */
const ITEM_TAGS = `${C.post}, search-telemetry-tracker, ${C.profileComment}`;
const COMMENT_TAG = C.comment;
const ALL_TAGS = `${C.comment}, ${ITEM_TAGS}`;

export interface PipelineOptions {
  root?: ParentNode;
  onBatch(batch: ItemBatch): void;
  onSlowBatch?(ms: number, batch: ItemBatch): void;
  /** Called with the measured duration of every non-empty batch (test and profiling hook). */
  onTiming?(ms: number, batch: ItemBatch, startedAt: number): void;
  now?: () => number;
  schedule?: (cb: () => void) => void;
  /** Wait between two slices of a large batch (default: the next task, `setTimeout(0)`). */
  yieldTo?: (cb: () => void) => void;
  /** Items per slice (default SLICE_SIZE). */
  sliceSize?: number;
}

/** One slice waiting to be handed to its receiver. */
interface Job {
  batch: ItemBatch;
  sink: (batch: ItemBatch) => void;
  /** When the work for this slice began (the flush, for the first slice of one). */
  startedAt: number | null;
}

type Item = Post | Comment | ProfileComment;

const sizeOf = (b: ItemBatch): number =>
  b.posts.length + b.comments.length + b.profileComments.length;

/**
 * The index from which a document-ordered list of items reaches the viewport: the item just above
 * the first one that starts below the viewport's top. A binary search, so a 5,000-item list costs
 * a dozen measurements. Unmeasurable pages (no layout) answer 0, which keeps document order.
 */
function viewportIndex(items: readonly Item[]): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid]!.source.getBoundingClientRect().top < 0) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

/**
 * Split `items` (document order) into the part to hand over first, the ones on screen, and the
 * rest in document order. For comments the first part also takes the on-screen comments'
 * ancestors from the same batch, so a parent always reaches the modules before (or with) its
 * replies, as it does in document order (hideChildComments, showParent and readComments follow
 * parentId to comments they have already seen).
 */
function splitAtViewport<T extends Item>(items: T[], size: number): { front: T[]; rest: T[] } {
  if (items.length <= size) return { front: items, rest: [] };
  const start = viewportIndex(items);
  const end = Math.min(items.length, start + size);
  const inFront = new Set<number>();
  for (let i = start; i < end; i++) inFront.add(i);
  const at = new Map<string, number>();
  items.forEach((it, i) => at.set(it.id, i));
  for (let i = start; i < end; i++) {
    let parent = (items[i] as Partial<Comment>).parentId ?? null;
    while (parent !== null) {
      const j = at.get(parent);
      if (j === undefined || inFront.has(j)) break;
      inFront.add(j);
      parent = (items[j] as Partial<Comment>).parentId ?? null;
    }
  }
  const front: T[] = [];
  const rest: T[] = [];
  items.forEach((it, i) => (inFront.has(i) ? front : rest).push(it));
  return { front, rest };
}

/** A batch as slices of at most `size` items: what is on screen first, the rest in document order. */
export function sliceBatch(batch: ItemBatch, size: number): ItemBatch[] {
  if (sizeOf(batch) <= size) return [batch];
  const posts = splitAtViewport(batch.posts, size);
  const comments = splitAtViewport(batch.comments, size);
  const profile = splitAtViewport(batch.profileComments, size);
  const out: ItemBatch[] = [
    { posts: posts.front, comments: comments.front, profileComments: profile.front },
  ];
  const chunk = <T>(xs: T[], make: (part: T[]) => ItemBatch) => {
    for (let i = 0; i < xs.length; i += size) out.push(make(xs.slice(i, i + size)));
  };
  chunk(posts.rest, (p) => ({ posts: p, comments: [], profileComments: [] }));
  chunk(comments.rest, (c) => ({ posts: [], comments: c, profileComments: [] }));
  chunk(profile.rest, (pc) => ({ posts: [], comments: [], profileComments: pc }));
  return out;
}

export class Pipeline {
  readonly tally = new ContractTally();
  private readonly posts = new PostDeduper();
  private readonly seenComments = new Set<string>();
  /**
   * Every item emitted on this page view, by id (the newest model of each). A settings change
   * re-runs the modules over these instead of parsing the whole page again.
   */
  private readonly known = {
    posts: new Map<string, Post>(),
    comments: new Map<string, Comment>(),
    profileComments: new Map<string, ProfileComment>(),
  };
  /** Size of `known` after its last pruning; it is pruned again once it has doubled. */
  private knownAtPrune = 0;
  private jobs: Job[] = [];
  /** A slice is being handed over, or the wait before the next one is running. */
  private pumping = false;
  /** Bumped by reset(), so a wait that was already running when the page changed does nothing. */
  private generation = 0;
  private readonly yieldTo: (cb: () => void) => void;
  private readonly sliceSize: number;
  /** Threading info of every parsed comment element, so re-threading skips re-reading them. */
  private threading: ThreadCache = new WeakMap();
  private observer: MutationObserver | null = null;
  private scheduled = false;
  private dirty = false;
  /**
   * A comment element was added since the last flush. Re-threading a 5,000-comment page is a full
   * pass, so an observed pipeline skips it when nothing like a comment arrived.
   */
  private commentsDirty = true;
  /** Comment elements the observer saw arrive since the last flush (the batch, not the page). */
  private readonly addedComments = new Set<Element>();
  /** Post, search-result and profile-comment candidates that arrived since the last flush. */
  private readonly addedItems = new Set<Element>();
  /** The next flush scans the whole page (first scan, route change), not just what arrived. */
  private scanAll = true;
  /** Open-ancestor stack and last element of the threading so far, for appending batches. */
  private tail: ThreadTail = { stack: [], last: null };
  private readonly root: ParentNode;
  private readonly now: () => number;
  private readonly schedule: (cb: () => void) => void;

  constructor(private readonly opts: PipelineOptions) {
    this.root = opts.root ?? document;
    this.now = opts.now ?? (() => performance.now());
    this.schedule = opts.schedule ?? ((cb) => requestAnimationFrame(cb));
    this.yieldTo = opts.yieldTo ?? ((cb) => void setTimeout(cb, 0));
    this.sliceSize = Math.max(1, opts.sliceSize ?? SLICE_SIZE);
  }

  start(): void {
    this.observer = new MutationObserver((records) => {
      let added = false;
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (!(n instanceof Element)) continue;
          added = true;
          this.collect(n);
          if (this.addedComments.size) this.commentsDirty = true;
        }
      }
      if (added) this.request();
    });
    this.observer.observe(this.root, { childList: true, subtree: true });
    this.request();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  /** New page view (SPA route change): forget what was seen. */
  reset(): void {
    this.posts.reset();
    this.seenComments.clear();
    this.threading = new WeakMap();
    this.commentsDirty = true;
    this.addedComments.clear();
    this.addedItems.clear();
    this.scanAll = true;
    this.tail = { stack: [], last: null };
    for (const el of this.root.querySelectorAll(`[${SEEN}]`)) el.removeAttribute(SEEN);
    for (const m of Object.values(this.known)) m.clear();
    this.knownAtPrune = 0;
    // Slices of the old page view still waiting are dropped; the new view starts over.
    this.jobs = [];
    this.pumping = false;
    this.generation++;
  }

  /** Slices still waiting to be handed over (tests). */
  pending(): number {
    return this.jobs.length;
  }

  /**
   * Hand everything already emitted on this page view (and still on it) to `sink` again, in
   * slices like a large batch: a settings change re-runs the modules it concerns without parsing
   * the page again. Nothing is stamped or emitted to `onBatch`.
   */
  replay(sink: (batch: ItemBatch) => void): ItemBatch {
    this.prune();
    // In the order they were first emitted: page order for what arrives at the end, and parents
    // always before their replies (a reply inserted mid-thread is emitted after its parent).
    const batch: ItemBatch = {
      posts: [...this.known.posts.values()],
      comments: [...this.known.comments.values()],
      profileComments: [...this.known.profileComments.values()],
    };
    if (sizeOf(batch)) this.enqueue(batch, sink, null);
    return batch;
  }

  /** Forget items that left the page (an endless feed keeps adding). */
  private prune(): void {
    for (const m of Object.values(this.known) as Array<Map<string, Item>>) {
      for (const [id, it] of m) if (!it.source.isConnected) m.delete(id);
    }
    this.knownAtPrune = this.knownSize();
  }

  private knownSize(): number {
    return this.known.posts.size + this.known.comments.size + this.known.profileComments.size;
  }

  private remember(batch: ItemBatch): void {
    for (const p of batch.posts) this.known.posts.set(p.id, p);
    for (const c of batch.comments) this.known.comments.set(c.id, c);
    for (const pc of batch.profileComments) this.known.profileComments.set(pc.id, pc);
    if (this.knownSize() > Math.max(1000, this.knownAtPrune * 2)) this.prune();
  }

  /** Queue `batch` for `sink` in slices; the first goes at once when nothing is waiting. */
  private enqueue(batch: ItemBatch, sink: (b: ItemBatch) => void, startedAt: number | null): void {
    const idle = !this.pumping;
    sliceBatch(batch, this.sliceSize).forEach((b, i) =>
      this.jobs.push({ batch: b, sink, startedAt: i === 0 && idle ? startedAt : null }),
    );
    if (idle) this.pump();
  }

  private pump(): void {
    const job = this.jobs.shift();
    if (!job) {
      this.pumping = false;
      return;
    }
    this.pumping = true;
    const t0 = job.startedAt ?? this.now();
    try {
      job.sink(job.batch);
    } finally {
      const ms = this.now() - t0;
      this.opts.onTiming?.(ms, job.batch, t0);
      if (ms > BUDGET_MS) {
        console.warn(`[REScue] batch took ${ms.toFixed(1)} ms (budget ${BUDGET_MS} ms)`);
        this.opts.onSlowBatch?.(ms, job.batch);
      }
      if (this.jobs.length) {
        const gen = this.generation;
        this.yieldTo(() => {
          if (gen === this.generation) this.pump();
        });
      } else this.pumping = false;
    }
  }

  private request(): void {
    this.dirty = true;
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      if (this.dirty) this.flush();
    });
  }

  /** Remember the candidate items inside a newly added element (work follows the batch). */
  private collect(n: Element): void {
    const file = (el: Element) => {
      if (el.localName === COMMENT_TAG) this.addedComments.add(el);
      else this.addedItems.add(el);
    };
    if (n.matches(ALL_TAGS)) file(n);
    for (const c of n.querySelectorAll(ALL_TAGS)) file(c);
  }

  /**
   * Elements of a selector that are not stamped yet. After the first scan these come from the
   * observer's candidates: even a bare-tag querySelectorAll walks every node of a 5,000-comment
   * page, which made every batch cost more than the one before.
   */
  private unseen(selector: string): Element[] {
    const out: Element[] = [];
    if (this.scanAll || this.observer === null) {
      for (const el of this.root.querySelectorAll(selector)) {
        if (!el.hasAttribute(SEEN)) out.push(el);
      }
      return out;
    }
    for (const el of this.addedItems) {
      if (el.isConnected && !el.hasAttribute(SEEN) && el.matches(selector)) out.push(el);
    }
    return sortedByPosition(out);
  }

  /** Synchronously collect and emit everything new. Public for tests and initial scans. */
  flush(): ItemBatch {
    this.dirty = false;
    const t0 = this.now();
    const posts: Post[] = [];
    for (const el of this.unseen(C.post)) {
      el.setAttribute(SEEN, '');
      const p = parsePost(el, this.tally);
      if (p && this.posts.accept(p)) posts.push(p);
    }
    // Search results are search-telemetry-tracker elements, not shreddit-post (contracts: search.*).
    for (const el of this.unseen(C.search.post)) {
      el.setAttribute(SEEN, '');
      const p = parseSearchPost(el, this.tally);
      if (p && this.posts.accept(p)) posts.push(p);
    }

    const comments: Comment[] = [];
    if (this.observer === null || this.commentsDirty) {
      this.commentsDirty = false;
      const threadPost = this.root.querySelector(C.post);
      const postAuthor = threadPost?.getAttribute(C.postAttr.author) ?? null;
      // Batches that land after the last threaded comment are threaded alone; anything else
      // (replies inserted mid-thread, a first scan) re-threads the page.
      const appended =
        this.observer !== null
          ? parseAppendedComments(
              [...this.addedComments],
              this.tail,
              postAuthor,
              this.tally,
              this.threading,
            )
          : null;
      this.addedComments.clear();
      const parsed =
        appended ?? parseComments(this.root, postAuthor, this.tally, this.threading, this.tail);
      for (const c of parsed) {
        c.source.setAttribute(SEEN, '');
        if (!this.seenComments.has(c.id)) {
          this.seenComments.add(c.id);
          comments.push(c);
        } else if (this.known.comments.get(c.id)?.source !== c.source) {
          // Reddit drew the comment again: a re-run (replay) must reach the new element.
          this.known.comments.set(c.id, c);
        }
      }
    }

    const profileComments: ProfileComment[] = [];
    for (const el of this.unseen(C.profileComment)) {
      el.setAttribute(SEEN, '');
      const pc = parseProfileComment(el, this.tally);
      if (pc) profileComments.push(pc);
    }

    this.addedItems.clear();
    this.scanAll = false;

    const batch: ItemBatch = { posts, comments, profileComments };
    if (sizeOf(batch)) {
      this.remember(batch);
      // A batch larger than a slice goes over in slices (on-screen items first); each slice is
      // timed on its own against the budget, the first one including the parsing above.
      this.enqueue(batch, (b) => this.opts.onBatch(b), t0);
    }
    return batch;
  }
}
