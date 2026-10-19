/**
 * feedPause (RES neverEndingReddit: autoLoad, pauseAfterEvery, showPauseButton): stop Reddit's
 * automatic loading of more posts and load them on a click instead. Reddit's feed loads the next
 * page with the `faceplate-partial` in the feed's `load-after` slot, and (found live 2026-10-16)
 * three different things trigger it: an IntersectionObserver on the loader itself, the post (or
 * profile comment sentinel) that carries the loader's cursor, which looks the loader up by its
 * `partial-more-posts-…` id. So while paused REScue "holds" the loader in the light DOM only:
 * it is hidden with one stylesheet rule (so nothing intersects) and its id is set aside (so
 * nothing finds it); both are put back on resume. Nothing is written into a shadow root. A
 * "load more" button in the corner strip drives the held loader's own loadContent() through the
 * bridge (core/paginator.ts). Reddit's loader ignores calls made right after load (research R3),
 * so a failed try is retried after a pause. The page's first loader is left alone when it would
 * load without any scrolling (a 3-post first screen): that is filling page one, not scrolling on.
 * With the defaults (auto-load on, no pause count) the module does nothing. Idea from RES
 * lib/modules/neverEndingReddit.js (GPL-3.0, the RES contributors, commit 4defffc); new code.
 */
import { h } from '../../core/dom';
import { hint, label } from '../../core/hints';
import { Paginator, type LoadResult } from '../../core/paginator';
import { defineModule, type ItemBatch, type MenuItem, type ModuleContext } from '../../core/types';
import {
  feedLoaderIdPrefix,
  feedLoaderSelector,
  feedPostSelector,
} from '../../model/chromeAnchors';
import { removeStyle, setStyle } from '../appearance/injectedStyle';

const STYLE_ID = 'rescue-feed-pause';
const AHEAD_STYLE_ID = 'rescue-load-ahead';
/** How far before the end of the feed the next page starts loading, per "Load the next page" choice. */
export const LOAD_AHEAD_PX: Record<string, number> = { reddit: 0, sooner: 1500, early: 3000 };

/**
 * Reddit loads the next page when its loader (the feed's `load-after` partial) comes into view,
 * about a screen before the end. Stretching the loader's box upward with transparent padding makes
 * it count as in view that much earlier (verified live 2026-10-19: from 2,500 px before the end
 * Reddit loads nothing, the stretched loader loads the next pages). It is only padding on a
 * light-DOM element: nothing is clicked, called or fetched by REScue, and a held (paused) loader
 * stays hidden by its own rule. Its own content (a retry button on failure) stays clickable.
 */
export function loadAheadCss(mode: string): string {
  const px = LOAD_AHEAD_PX[mode] ?? 0;
  if (!px) return '';
  const L = `${feedLoaderSelector()}:not([${HELD}])`;
  return [
    `${L} { margin-top: -${px}px !important; padding-top: ${px}px !important; background: transparent !important; pointer-events: none; }`,
    `${L} > * { pointer-events: auto; }`,
  ].join('\n');
}
const HELD = 'data-rescue-held';
const HELD_ID = 'rescue-held-';
const FEEDS = new Set(['front', 'all', 'popular', 'subreddit', 'customFeed', 'profile']);
export const LOAD_TRIES = 4;
export const RETRY_PAUSE_MS = 1000;
const TRY_WAIT_MS = 2500;
const END_WAIT_MS = 2500;
/** Reddit loads a loader this close (px) to the viewport edge without any scrolling. */
const LOOK_AHEAD_PX = 2000;
/** A first screen with fewer posts than this is still being filled. */
const FILL_POSTS = 10;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Load one page, retrying while Reddit's loader ignores the call. */
export async function loadWithRetry(
  paginator: Pick<Paginator, 'loadMorePosts'>,
  tries = LOAD_TRIES,
  pauseMs = RETRY_PAUSE_MS,
): Promise<LoadResult> {
  let result: LoadResult = 'failed';
  for (let i = 0; i < tries; i++) {
    result = await paginator.loadMorePosts(TRY_WAIT_MS);
    if (result === 'loaded' || result === 'no-more' || result === 'busy') return result;
    if (i < tries - 1) await sleep(pauseMs);
  }
  return result;
}

interface State {
  ctx: ModuleContext;
  paginator: Paginator;
  paused: boolean;
  /** Page loaders counted since the page opened, and how many of them are before the last resume. */
  total: number;
  base: number;
  seen: WeakSet<Element>;
  /** Every loader cursor seen on this page, and the page one's fill loader (not counted). */
  keys: Set<string>;
  fills: Set<string>;
  /** The cursor of the loader on the page now, if any. */
  current: string | null;
  /** Posts that arrived since the last look, waiting to be told which page they are on. */
  newPosts: string[];
  /** The highest page number already marked (page 1 is never marked). */
  marked: number;
  /** The reader paused it themselves, and asked for that to be remembered. */
  remembered: boolean;
  endTimer: ReturnType<typeof setTimeout> | null;
  endShown: boolean;
  button: HTMLButtonElement;
  menu: MenuItem;
  removeMenu: (() => void) | null;
  busy: boolean;
  observer: MutationObserver | null;
  timer: ReturnType<typeof setTimeout> | null;
}

let state: State | null = null;

const opt = (s: State) =>
  s.ctx.options as unknown as {
    autoLoad: boolean;
    pauseAfterEvery: number;
    showPauseButton: boolean;
    reversePauseIcon: boolean;
    rememberPause: boolean;
    pageMarkers: boolean;
    endOfFeedNotice: boolean;
  };
const onFeed = (s: State): boolean => FEEDS.has(s.ctx.route.kind);

/** Every next-page loader on the page right now (normally one). */
const loadersNow = (): Element[] => [...document.querySelectorAll(feedLoaderSelector())];

/** A loader's identity: its `after` cursor (the home feed reuses one id for every page). */
function keyOf(el: Element): string {
  const src = el.getAttribute('src') ?? '';
  const m = /[?&]after=([^&]+)/.exec(src);
  return m?.[1] ?? (src || el.id);
}

/** Set the loader aside: hidden (nothing intersects) and unfindable by id (nothing loads it). */
function hold(el: Element): void {
  if (el.hasAttribute(HELD)) return;
  el.setAttribute(HELD, el.id);
  if (el.id.startsWith(feedLoaderIdPrefix())) el.id = HELD_ID + el.id;
}

function release(el: Element): void {
  const id = el.getAttribute(HELD);
  if (id === null) return;
  el.removeAttribute(HELD);
  if (id && el.id !== id) el.id = id;
}

const releaseAll = (): void => {
  for (const el of document.querySelectorAll(`[${HELD}]`)) release(el);
};

/** Reddit would load this loader without any scrolling: it only fills the first screen. */
function fillsFirstScreen(el: Element): boolean {
  if (window.scrollY > 50) return false;
  if (document.querySelectorAll(feedPostSelector()).length >= FILL_POSTS) return false;
  return el.getBoundingClientRect().top < window.innerHeight + LOOK_AHEAD_PX;
}

function render(s: State): void {
  const active = onFeed(s);
  setStyle(
    STYLE_ID,
    active && s.paused ? `${feedLoaderSelector()}[${HELD}]{display:none !important}` : '',
  );
  const more = active && s.paused && loadersNow().some((p) => p.hasAttribute(HELD));
  s.button.hidden = !more;
  s.button.disabled = s.busy;
  // Only when they differ: rewriting the same text is a page change that would wake the observer.
  const word = s.busy ? label.loading : label.loadMore;
  if (s.button.textContent !== word) s.button.textContent = word;
  const tip = hint.feedLoadMore(s.busy);
  if (s.button.title !== tip) s.button.title = tip;
  // Reversed: the word names the state the feed is in, not the action a click does.
  s.menu.label = opt(s).reversePauseIcon
    ? s.paused
      ? label.pausedState
      : label.autoLoadingState
    : s.paused
      ? label.resume
      : label.pause;
  const want = active && opt(s).showPauseButton;
  if (want && !s.removeMenu) s.removeMenu = s.ctx.ui.addMenuItem(s.menu);
  if (!want && s.removeMenu) {
    s.removeMenu();
    s.removeMenu = null;
  }
}

/** Count new feed loaders; after N pages loaded automatically, pause; hold the loader while paused. */
function scan(s: State): void {
  const now = loadersNow();
  for (const p of now) {
    if (s.seen.has(p)) continue;
    s.seen.add(p);
    const key = keyOf(p);
    if (s.keys.has(key)) continue;
    s.keys.add(key);
    if (s.keys.size === 1 && fillsFirstScreen(p)) s.fills.add(key);
    else s.total++;
  }
  s.current = now.length ? keyOf(now[now.length - 1]!) : null;
  const every = opt(s).pauseAfterEvery;
  if (!s.paused && every > 0 && s.total - 1 - s.base >= every) {
    s.paused = true;
    s.ctx.notices.show(
      `Paused after ${every} ${every === 1 ? 'page' : 'pages'} of posts. Use “load more” in the corner, or resume in the REScue menu.`,
      { id: 'feed-paused', timeoutMs: 6000, moduleId: 'feedPause', type: 'feedPause' },
    );
  }
  const holding = onFeed(s) && s.paused;
  for (const p of now) {
    if (holding && !s.fills.has(keyOf(p))) hold(p);
    else release(p);
  }
  markPages(s, now.length > 0);
  render(s);
}

/** Pages Reddit has loaded since this page opened: the counted loaders that are done with. */
function pagesLoaded(s: State): number {
  const counted = s.keys.size - s.fills.size;
  const waiting = s.current !== null && !s.fills.has(s.current) ? 1 : 0;
  return Math.max(0, counted - waiting);
}

/** The id of the post highest on the page (the pipeline does not hand posts over in page order). */
function topmost(ids: string[]): string | undefined {
  let best: Element | null = null;
  let bestId: string | undefined;
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (!best || best.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) {
      best = el;
      bestId = id;
    }
  }
  return bestId ?? ids[0];
}

/** "Page N" on the first post of each page after the first, and a notice when the feed has ended. */
function markPages(s: State, live: boolean): void {
  const page = 1 + pagesLoaded(s);
  const first = topmost(s.newPosts);
  s.newPosts = [];
  if (first && opt(s).pageMarkers && page > s.marked) {
    s.marked = page;
    s.ctx.ui.decorate({ id: first }, 'tagline', pageMarker(page));
  }
  if (live && s.endTimer) {
    clearTimeout(s.endTimer);
    s.endTimer = null;
  }
  if (!s.endTimer && !s.endShown && opt(s).endOfFeedNotice && onFeed(s) && !live) {
    s.endTimer = setTimeout(() => {
      s.endTimer = null;
      // No loader left after the settle time, with posts on the page: Reddit has no more.
      if (s.endShown || loadersNow().length || !document.querySelector(feedPostSelector())) return;
      s.endShown = true;
      s.ctx.notices.show('That is the end of the feed: Reddit has no more posts to load.', {
        id: 'feed-end',
        timeoutMs: 6000,
        moduleId: 'feedPause',
        type: 'feedEnd',
      });
    }, END_WAIT_MS);
  }
}

function pageMarker(page: number): HTMLElement {
  const m = h(
    'span',
    { class: 'rescue-page-marker', title: hint.pageMarker(page) },
    `Page ${page}`,
  );
  m.style.cssText = 'font-weight:600;margin-right:6px';
  return m;
}

/** The pause the reader chose, kept so the next page opens paused too. */
function setPaused(s: State, paused: boolean): void {
  s.paused = paused;
  if (opt(s).rememberPause) {
    s.remembered = paused;
    s.ctx.store.set('paused', paused);
  }
  if (!paused) s.base = Math.max(0, s.total - 1);
  scan(s);
}

async function loadMore(s: State): Promise<void> {
  if (s.busy) return;
  s.busy = true;
  render(s);
  const result = await loadWithRetry(s.paginator);
  s.busy = false;
  if (result === 'failed')
    s.ctx.notices.show('Reddit did not load more posts. Try “load more” again in a moment.', {
      id: 'feed-load-failed',
      kind: 'warning',
      timeoutMs: 5000,
    });
  scan(s);
}

export const feedPause = defineModule({
  id: 'feedPause',
  resId: 'neverEndingReddit',
  category: 'listings',
  title: 'Pause feed loading',
  description:
    'Starts loading the next page of posts a little before you reach the end, so you wait less. It can also stop Reddit from loading more posts as you scroll and puts a “load more” button in the corner instead: always (turn off automatic loading), or after a set number of pages. A pause/resume item in the REScue menu switches it on the page. By default Reddit loads posts as usual and nothing changes. Reddit’s loader sometimes ignores the first click after a page loads; REScue retries by itself.',
  enabledByDefault: true,
  options: {
    autoLoad: {
      type: 'boolean',
      default: true,
      title: 'Load more posts automatically as I scroll',
      description: 'Off: posts load only when you press “load more”.',
    },
    loadAhead: {
      type: 'enum',
      default: 'sooner',
      title: 'Load the next page',
      values: [
        { value: 'reddit', label: 'When I reach the end (Reddit’s own timing)' },
        { value: 'sooner', label: 'Sooner (about 1,500 pixels before the end)' },
        { value: 'early', label: 'Much sooner (about 3,000 pixels before the end)' },
      ],
      description:
        'Starts loading the next page of posts before you reach the end of the feed, so you wait less. It only asks Reddit for the page you are about to scroll to anyway.',
    },
    pauseAfterEvery: {
      type: 'number',
      default: 0,
      min: 0,
      max: 50,
      title: 'Pause after this many pages (0 = never)',
      description:
        'Then press “load more”, or resume in the REScue menu to carry on automatically.',
    },
    showPauseButton: {
      type: 'boolean',
      default: true,
      title: 'Show pause / resume in the REScue menu',
    },
    reversePauseIcon: {
      type: 'boolean',
      default: false,
      title: 'Name the state in the menu, not the action',
      description:
        'On: the menu says “paused” or “auto-loading”. Off: it says “resume” or “pause”, the thing a click does.',
    },
    rememberPause: {
      type: 'boolean',
      default: true,
      title: 'Remember a pause I chose, on the next pages I open',
      description: 'Pausing or resuming in the menu stays that way until you change it again.',
    },
    pageMarkers: {
      type: 'boolean',
      default: true,
      title: 'Mark where each loaded page starts (“Page 2”)',
      description: 'A small word on the first post of every page after the first.',
    },
    endOfFeedNotice: {
      type: 'boolean',
      default: true,
      title: 'Say when the feed has ended',
      description: 'A notice appears once Reddit has no more posts to load.',
    },
  },

  init(ctx) {
    setStyle(AHEAD_STYLE_ID, loadAheadCss(String(ctx.options.loadAhead ?? 'sooner')));
    const button = h('button', {
      type: 'button',
      class: 'rescue-feed-load-more rescue-btn',
      hidden: true,
    });
    const menu: MenuItem = {
      id: 'feed:pause',
      label: label.pause,
      order: 45,
      hint: () => hint.feedPause(s.paused),
      onClick: () => setPaused(s, !s.paused),
    };
    const s: State = {
      ctx,
      paginator: new Paginator(ctx.bridge),
      paused: !(ctx.options as unknown as { autoLoad: boolean }).autoLoad,
      total: 0,
      base: 0,
      seen: new WeakSet(),
      keys: new Set(),
      fills: new Set(),
      current: null,
      newPosts: [],
      marked: 1,
      remembered: false,
      endTimer: null,
      endShown: false,
      button,
      menu,
      removeMenu: null,
      busy: false,
      observer: null,
      timer: null,
    };
    state = s;
    // A pause the reader chose earlier is read without holding up the other features' start.
    if (opt(s).rememberPause) {
      void ctx.store.get<boolean>('paused').then((was) => {
        if (was !== true || state !== s || !opt(s).rememberPause) return;
        s.remembered = true;
        s.paused = true;
        scan(s);
      });
    }
    button.addEventListener('click', () => void loadMore(s));
    ctx.ui.addHeaderTool(button);
    // Reddit swaps the loader for a new one after each page; look again after each burst of changes.
    // A loader not seen before is dealt with at once (before Reddit's own observers see it), so a
    // pause is in place by the time the next page could be asked for.
    s.observer = new MutationObserver(() => {
      if (loadersNow().some((p) => !s.seen.has(p))) {
        scan(s);
        return;
      }
      if (s.timer) return;
      s.timer = setTimeout(() => {
        s.timer = null;
        scan(s);
      }, 150);
    });
    s.observer.observe(document.documentElement, { childList: true, subtree: true });
    scan(s);
  },

  onItems(batch: ItemBatch) {
    const s = state;
    if (!s || !batch.posts.length) return;
    s.newPosts.push(...batch.posts.map((p) => p.id));
    // The loader that brought these posts may leave the page a moment later: look again then.
    setTimeout(() => state === s && scan(s), 300);
  },

  onSettings(ctx) {
    setStyle(AHEAD_STYLE_ID, loadAheadCss(String(ctx.options.loadAhead ?? 'sooner')));
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    if (!opt(s).rememberPause) s.remembered = false;
    s.paused = !opt(s).autoLoad || s.remembered;
    scan(s);
  },

  onRoute(route, ctx) {
    const s = state;
    if (!s) return;
    s.ctx = { ...ctx, route };
    s.total = 0;
    s.base = 0;
    s.seen = new WeakSet();
    s.keys = new Set();
    s.fills = new Set();
    s.current = null;
    releaseAll();
    s.newPosts = [];
    s.marked = 1;
    s.endShown = false;
    s.paused = !opt(s).autoLoad || s.remembered;
    scan(s);
  },

  dispose() {
    const s = state;
    if (!s) return;
    s.observer?.disconnect();
    if (s.timer) clearTimeout(s.timer);
    if (s.endTimer) clearTimeout(s.endTimer);
    s.removeMenu?.();
    s.button.remove();
    releaseAll();
    removeStyle(STYLE_ID);
    removeStyle(AHEAD_STYLE_ID);
    state = null;
  },
});
