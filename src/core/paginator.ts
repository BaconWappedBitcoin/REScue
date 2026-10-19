/**
 * Drives Reddit's programmatic partials (research R3). With the native feed hidden, Reddit's own
 * scroll logic never fires them, so REScue calls loadContent() through the bridge, off its own
 * sentinel. Hover-card partials share the element type and are excluded by the contract selector
 * and by never driving a partial that sits inside a post.
 *
 * Approach ported from Sheddit src/core/paginator.js (GPL-3.0, kookaburrabarrel, cff40d7).
 */
import { C } from '../contracts/reddit';
import type { BridgeApi } from './types';

export type LoadResult = 'loaded' | 'no-more' | 'failed' | 'busy';

export class Paginator {
  private busy = false;
  private observer: IntersectionObserver | null = null;

  constructor(
    private readonly bridge: BridgeApi,
    private readonly doc: Document = document,
    private readonly waitMs = 8000,
  ) {}

  /** The next feed partial: inside the feed, not in a post, not a hover card. */
  nextFeedPartial(): Element | null {
    return (
      [...this.doc.querySelectorAll(C.feedPartial)].find(
        (p) =>
          !p.closest(C.post) &&
          !(p.getAttribute('src') ?? '').toLowerCase().includes(C.partialNotSrc),
      ) ?? null
    );
  }

  nextCommentPartial(): Element | null {
    return this.doc.querySelector(C.commentPartial);
  }

  /** waitMs: how long to wait for new posts before calling the load failed. */
  loadMorePosts(waitMs = this.waitMs): Promise<LoadResult> {
    return this.drive(() => this.nextFeedPartial(), C.post, waitMs);
  }

  loadMoreComments(): Promise<LoadResult> {
    return this.drive(() => this.nextCommentPartial(), C.comment);
  }

  /** Auto mode: load more when `sentinel` scrolls within 800px of the viewport. */
  autoLoad(sentinel: Element, load: () => Promise<LoadResult>): () => void {
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void load();
      },
      { rootMargin: '800px 0px' },
    );
    this.observer.observe(sentinel);
    return () => this.observer?.disconnect();
  }

  private async drive(
    find: () => Element | null,
    itemSel: string,
    waitMs = this.waitMs,
  ): Promise<LoadResult> {
    if (this.busy) return 'busy';
    const partial = find();
    if (!partial) return 'no-more';
    this.busy = true;
    try {
      const before = this.doc.querySelectorAll(itemSel).length;
      const res = await this.bridge.request({ op: 'partial.load', ref: this.bridge.ref(partial) });
      if (!res.ok) return 'failed';
      const grew = await this.waitFor(
        () => this.doc.querySelectorAll(itemSel).length > before,
        waitMs,
      );
      return grew ? 'loaded' : find() ? 'failed' : 'no-more';
    } finally {
      this.busy = false;
    }
  }

  private waitFor(cond: () => boolean, waitMs = this.waitMs): Promise<boolean> {
    if (cond()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const mo = new MutationObserver(() => {
        if (cond()) {
          mo.disconnect();
          clearTimeout(t);
          resolve(true);
        }
      });
      mo.observe(this.doc.documentElement, { childList: true, subtree: true });
      const t = setTimeout(() => {
        mo.disconnect();
        resolve(cond());
      }, waitMs);
    });
  }
}
