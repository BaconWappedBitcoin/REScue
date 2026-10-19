/**
 * Old Reddit look: keeps REScue's replacement rows on the page's posts and comments, and the sort
 * tabs over the listing, for as long as the skin is on. It mounts the pieces of every post and
 * comment it can see (a post only once Reddit's own vote buttons are readable, so a post that
 * cannot get a vote column keeps Reddit's own), repairs them when Reddit re-renders an element,
 * redraws them when an attribute (score, comment count, title) or the route changes, and takes
 * everything away again when stopped, so turning the skin off restores Reddit's own rows.
 */
import { C } from '../../../contracts/reddit';
import type { Route } from '../../../core/types';
import { watchCommentRows } from '../../../model/commentRow';
import { CommentView } from './comment';
import { PostView } from './post';
import { isOwn, type Ctx } from './shared';
import { HighlightRows } from './highlights';
import { PageName } from './pageName';
import { SortTabs } from './sort';

/** Posts the skin draws rows for: a feed's rows and the post at the top of a thread. */
/** Feed rows include Reddit's in-feed ads, which have the same shape as posts (verified live 2026-10-19). */
export const POST_HOSTS = `${C.feed} ${C.post}, ${C.feed} ${C.adPost}, ${C.main} > ${C.post}`;
const HOSTS = `${C.post}, ${C.adPost}, ${C.comment}`;
export const COMMENT_HOSTS = `${C.main} ${C.comment}`;
const WATCHED = ['score', 'comment-count', 'post-title', 'author', 'created-timestamp', 'created'];
const RETRY_MS = 500;
const RETRY_MAX = 40;

export class SkinMount {
  private readonly posts = new Map<Element, PostView>();
  private readonly comments = new Map<Element, CommentView>();
  private readonly tabs = new SortTabs();
  private readonly highlights = new HighlightRows();
  private readonly pageName = new PageName();
  private observer: MutationObserver | null = null;
  private stopRows: (() => void) | null = null;
  private queued = new Set<Element>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private retries = 0;

  constructor(
    private readonly ctx: Ctx,
    private route: Route,
  ) {}

  private readonly currentRoute = (): Route => this.route;

  start(): void {
    if (this.observer) return;
    this.observer = new MutationObserver((records) => this.onMutations(records));
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: WATCHED,
    });
    this.stopRows = watchCommentRows((host) => this.comments.get(host)?.render());
    this.sweep();
  }

  /** The route changed: redraw the words that depend on it. */
  setRoute(route: Route): void {
    this.route = route;
    if (!this.observer) return;
    this.sweep();
    for (const v of this.posts.values()) v.render();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.stopRows?.();
    this.stopRows = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.stopRetry();
    this.queued.clear();
    for (const v of this.posts.values()) v.dispose();
    for (const v of this.comments.values()) v.dispose();
    this.posts.clear();
    this.comments.clear();
    this.tabs.clear();
    this.highlights.clear();
    this.pageName.clear();
  }

  /** Items the page just delivered (the module's onItems). */
  items(hosts: Iterable<Element>): void {
    if (!this.observer) return;
    for (const h of hosts) this.queued.add(h);
    this.schedule();
  }

  private sweep(): void {
    for (const el of document.querySelectorAll(`${POST_HOSTS}, ${COMMENT_HOSTS}`)) this.queued.add(el);
    this.schedule();
  }

  private onMutations(records: MutationRecord[]): void {
    for (const r of records) {
      if (r.type === 'attributes') {
        if (r.target instanceof Element) this.queued.add(r.target);
        continue;
      }
      const own = [...r.addedNodes, ...r.removedNodes].every(isOwn);
      if (own && r.addedNodes.length + r.removedNodes.length > 0 && r.removedNodes.length === 0) continue;
      const target = r.target instanceof Element ? r.target : r.target.parentElement;
      const host = target?.closest(HOSTS);
      if (host) this.queued.add(host);
      for (const n of r.addedNodes) {
        if (!(n instanceof Element) || isOwn(n)) continue;
        if (n.matches(HOSTS)) this.queued.add(n);
        else for (const el of n.querySelectorAll(HOSTS)) this.queued.add(el);
      }
    }
    this.schedule();
  }

  private schedule(): void {
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 30);
  }

  private flush(): void {
    const hosts = [...this.queued];
    this.queued.clear();
    for (const host of hosts) {
      if (!host.isConnected) continue;
      if (host.matches(POST_HOSTS)) this.ensurePost(host);
      else if (host.matches(COMMENT_HOSTS)) this.ensureComment(host);
    }
    this.prune();
    this.tabs.sync(this.route);
    this.highlights.sync();
    this.pageName.sync(this.route);
    if (this.hasPending() && !this.retryTimer) this.startRetry();
  }

  private ensurePost(host: Element): void {
    let view = this.posts.get(host);
    if (!view) {
      view = PostView.mount(host, this.ctx, this.currentRoute) ?? undefined;
      if (!view) return;
      this.posts.set(host, view);
      return;
    }
    if (!view.intact()) view.repair();
    view.render();
  }

  private ensureComment(host: Element): void {
    let view = this.comments.get(host);
    if (!view) {
      view = CommentView.mount(host, this.ctx) ?? undefined;
      if (!view) return;
      this.comments.set(host, view);
      return;
    }
    if (!view.intact()) {
      view.dispose();
      this.comments.delete(host);
      this.ensureComment(host);
      return;
    }
    view.render();
  }

  private prune(): void {
    for (const [host, v] of this.posts) {
      if (!host.isConnected) {
        v.dispose();
        this.posts.delete(host);
      }
    }
    for (const [host, v] of this.comments) {
      if (!host.isConnected) {
        v.dispose();
        this.comments.delete(host);
      }
    }
  }

  /** Posts whose vote buttons were not readable yet keep Reddit's own look until they are. */
  private pending(): Element[] {
    return [...document.querySelectorAll(POST_HOSTS)].filter((el) => !this.posts.has(el));
  }

  private hasPending(): boolean {
    return this.pending().length > 0 && this.retries < RETRY_MAX;
  }

  private startRetry(): void {
    this.retryTimer = setInterval(() => {
      this.retries++;
      const todo = this.pending();
      for (const el of todo) this.ensurePost(el);
      if (!this.pending().length || this.retries >= RETRY_MAX) this.stopRetry();
    }, RETRY_MS);
  }

  private stopRetry(): void {
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = null;
    this.retries = 0;
  }
}
