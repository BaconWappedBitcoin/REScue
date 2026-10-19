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
}

export class Pipeline {
  readonly tally = new ContractTally();
  private readonly posts = new PostDeduper();
  private readonly seenComments = new Set<string>();
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
    if (posts.length || comments.length || profileComments.length) {
      this.opts.onBatch(batch);
      const ms = this.now() - t0;
      this.opts.onTiming?.(ms, batch, t0);
      if (ms > BUDGET_MS) {
        console.warn(`[REScue] batch took ${ms.toFixed(1)} ms (budget ${BUDGET_MS} ms)`);
        this.opts.onSlowBatch?.(ms, batch);
      }
    }
    return batch;
  }
}
