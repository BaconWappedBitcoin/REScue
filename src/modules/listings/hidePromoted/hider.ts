/**
 * The running state of hidePromoted on one page: which promoted slots REScue hid, the banner that
 * counts them, and the page-only "show" switch.
 *
 * Two layers hide a slot. A stylesheet made from the contract selectors makes a matching slot
 * invisible the moment it is parsed (`visibility:hidden` keeps its box, so it can still be
 * measured). A scan then looks at every match: a slot that has a box is rendered, so it is marked
 * `data-rescue-promoted` (the stylesheet turns that into `display:none`) and counted. A slot with
 * no box was already removed or hidden by something else (an ad blocker), so it is neither marked
 * nor counted. Feed posts that carry no promoted tag name are found by their "Promoted" label, which
 * must match exactly on the label element; no match means no hide.
 *
 * Nothing here writes into a shadow root, makes a request or stores anything.
 */
import { C } from '../../../contracts/reddit';
import { h } from '../../../core/dom';
import { hint } from '../../../core/hints';
import type { ModuleContext } from '../../../core/types';
import { NativeAdapter } from '../../../layout/native/adapter';
import { removeStyle, setStyle } from '../../appearance/injectedStyle';

export type Kind = 'posts' | 'comments' | 'sidebar';
export const KINDS: readonly Kind[] = ['posts', 'comments', 'sidebar'];

export interface PromotedOptions {
  posts: boolean;
  comments: boolean;
  sidebar: boolean;
  showBanner: boolean;
}

const STYLE_ID = 'rescue-hide-promoted';
// Also named by the Old Reddit look's stylesheet (model/oldSkinFeed.ts), which must keep these hidden.
export const MARK = 'data-rescue-promoted';
const SELECTORS: Record<Kind, string> = {
  posts: C.promoted.post,
  comments: C.promoted.comment,
  sidebar: C.promoted.sidebar,
};
/** How many times, and how soon, to look again at a slot that had no box yet (still loading). */
const RETRIES = 3;
const RETRY_MS = 1000;

/** A box on the page: not display:none (own or inherited), not detached, not zero-sized. */
export function isRendered(el: Element): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** The last non-empty path segment of an address, lower case ("/user/Roblox/" -> "roblox"). */
function lastSegment(href: string): string {
  const path = href.split(/[?#]/)[0] ?? '';
  return (path.split('/').filter(Boolean).pop() ?? '').toLowerCase();
}

/**
 * True when `el` is a label that says "promoted": exact text on a leaf element. Inside a link it
 * must not merely be that link's name (a user called "Ad" has a link to /user/Ad/ reading "Ad").
 */
export function isPromotedLabel(el: Element): boolean {
  if (el.children.length > 0) return false;
  const text = (el.textContent ?? '').trim();
  if (!C.promoted.label.text.test(text)) return false;
  const link = el.closest(C.promoted.label.link);
  return !(link && lastSegment(link.getAttribute('href') ?? '') === text.toLowerCase());
}

/** The label element inside a post's credit bar that says it is promoted, if any. */
export function promotedLabelIn(post: Element): Element | null {
  for (const bar of post.querySelectorAll(C.promoted.label.scope)) {
    if (bar.closest(C.post) !== post) continue;
    for (const el of bar.querySelectorAll('*')) if (isPromotedLabel(el)) return el;
  }
  return null;
}

const count = (n: number): string => `${n} promoted`;

export class PromotedHider {
  private options: PromotedOptions;
  private readonly hidden = new Map<Element, Kind>();
  /** Posts already checked for a label; re-checked when the label option is turned on later. */
  private checked = new WeakSet<Element>();
  private posts = new Set<Element>();
  private revealing = false;
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private due = 0;
  private retries = 0;
  private readonly text = h('span', { class: 'rescue-promoted-count', title: hint.promotedCount });
  private readonly toggle = h(
    'button',
    { type: 'button', class: 'rescue-promoted-toggle rescue-btn' },
    'show',
  );
  private readonly banner = h(
    'div',
    { class: 'rescue-promoted-banner infobar', role: 'status', hidden: true },
    this.text,
    ' · ',
    this.toggle,
  );
  private bannerAdded = false;

  constructor(private ctx: ModuleContext) {
    this.options = readOptions(ctx);
    this.toggle.addEventListener('click', () => this.setRevealing(!this.revealing));
    this.renderBanner();
  }

  start(): void {
    this.observer = new MutationObserver(() => this.schedule(150));
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
    this.refresh();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unmarkAll();
    this.banner.remove();
    this.bannerAdded = false;
    removeStyle(STYLE_ID);
    this.posts.clear();
    this.checked = new WeakSet();
  }

  /** New settings: apply at once, no reload. */
  settings(ctx: ModuleContext): void {
    this.ctx = ctx;
    this.options = readOptions(ctx);
    for (const [el, kind] of this.hidden) if (!this.options[kind]) this.unmark(el);
    if (this.options.posts) this.checked = new WeakSet();
    this.refresh();
  }

  /** A new page: the previous page's marks and the "show" switch do not carry over. */
  route(ctx: ModuleContext): void {
    this.ctx = ctx;
    this.unmarkAll();
    this.posts.clear();
    this.checked = new WeakSet();
    this.revealing = false;
    this.refresh();
  }

  /** Posts from the batch pipeline: look for the "Promoted" label on each. */
  items(posts: Iterable<Element>): void {
    for (const p of posts) this.posts.add(p);
    this.schedule(0);
  }

  /** How many slots REScue is hiding (or showing again) on this page. */
  get hiddenCount(): number {
    this.prune();
    return this.hidden.size;
  }

  // --- scanning -------------------------------------------------------------------------------

  /** Run a scan in `ms`, unless one is already due sooner. */
  private schedule(ms: number): void {
    const due = Date.now() + ms;
    if (this.timer && this.due <= due) return;
    if (this.timer) clearTimeout(this.timer);
    this.due = due;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, ms);
  }

  /** Rebuild the stylesheet, mark what is newly found, redraw the banner. */
  refresh(): void {
    this.renderStyle();
    const pending = this.scan();
    this.renderBanner();
    if (pending > 0 && this.retries < RETRIES) {
      this.retries++;
      this.schedule(RETRY_MS);
    } else if (pending === 0) {
      this.retries = 0;
    }
  }

  /** Marks every rendered promoted slot; returns how many matches had no box yet. */
  private scan(): number {
    this.prune();
    let pending = 0;
    for (const kind of KINDS) {
      if (!this.options[kind]) continue;
      for (const el of document.querySelectorAll(SELECTORS[kind])) {
        if (this.hidden.has(el) || el.closest(`[${MARK}]`)) continue;
        if (isRendered(el)) this.mark(el, kind);
        else pending++;
      }
    }
    if (this.options.posts) pending += this.scanLabels();
    return pending;
  }

  private scanLabels(): number {
    let pending = 0;
    for (const post of this.posts) {
      if (!post.isConnected) {
        this.posts.delete(post);
        continue;
      }
      if (this.checked.has(post)) continue;
      const wrapper = NativeAdapter.wrapperOf(post);
      if (this.hidden.has(wrapper) || wrapper.closest(`[${MARK}]`)) continue;
      if (!promotedLabelIn(post)) {
        this.checked.add(post); // no label now; a post's credit bar is complete once it is seen
        continue;
      }
      if (isRendered(wrapper)) {
        this.checked.add(post);
        this.mark(wrapper, 'posts');
      } else pending++;
    }
    return pending;
  }

  private mark(el: Element, kind: Kind): void {
    el.setAttribute(MARK, kind);
    this.hidden.set(el, kind);
  }

  private unmark(el: Element): void {
    el.removeAttribute(MARK);
    this.hidden.delete(el);
  }

  private unmarkAll(): void {
    for (const el of [...this.hidden.keys()]) this.unmark(el);
    for (const el of document.querySelectorAll(`[${MARK}]`)) el.removeAttribute(MARK);
  }

  private prune(): void {
    for (const el of [...this.hidden.keys()]) if (!el.isConnected) this.hidden.delete(el);
  }

  // --- what the reader sees -------------------------------------------------------------------

  private setRevealing(on: boolean): void {
    this.revealing = on;
    this.renderStyle();
    this.renderBanner();
  }

  private renderStyle(): void {
    const kinds = KINDS.filter((k) => this.options[k]);
    if (!kinds.length) {
      removeStyle(STYLE_ID);
      return;
    }
    if (this.revealing) {
      setStyle(STYLE_ID, `[${MARK}]{outline:2px dashed var(--rescue-warn,#c90) !important}`);
      return;
    }
    const early = kinds.map((k) => SELECTORS[k]).join(',');
    setStyle(
      STYLE_ID,
      `${early}{visibility:hidden !important}\n[${MARK}]{display:none !important}`,
    );
  }

  private renderBanner(): void {
    const n = this.hiddenCount;
    const show = this.options.showBanner && n > 0;
    const words = this.revealing ? `${count(n)} shown` : `${count(n)} hidden`;
    if (this.text.textContent !== words) this.text.textContent = words;
    const action = this.revealing ? 'hide' : 'show';
    if (this.toggle.textContent !== action) this.toggle.textContent = action;
    this.toggle.title = hint.promotedReveal(this.revealing);
    this.banner.hidden = !show;
    if (show && !this.bannerAdded) {
      this.bannerAdded = true;
      this.ctx.ui.addBanner(this.banner);
    }
  }
}

function readOptions(ctx: ModuleContext): PromotedOptions {
  const o = ctx.options as unknown as Partial<PromotedOptions>;
  return {
    posts: o.posts !== false,
    comments: o.comments !== false,
    sidebar: o.sidebar !== false,
    showBanner: o.showBanner !== false,
  };
}
