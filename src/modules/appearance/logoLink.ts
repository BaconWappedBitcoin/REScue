/**
 * logoLink (RES logoLink, US8): where Reddit's logo in the header goes. The module rewrites the
 * `href` of the logo anchor when it is reachable in the light DOM (contracts: chrome.logoLink, a
 * candidate that still has to be checked on the live page) and puts the original back when it is
 * turned off. Ported in spirit from RES lib/modules/logoLink.js (GPL-3.0, the RES contributors,
 * commit 4defffc); the code is new. RES's "dashboard" and "inbox" destinations are not offered.
 */
import { defineModule, type Route } from '../../core/types';
import { isLogoAnchor, logoAnchors } from '../../model/appearance';

const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9_\-./%~+]*(?:\?[A-Za-z0-9_\-./%~+=&]*)?$/;

export interface LogoOptions {
  destination: string;
  customDestination: string;
  /** How the front page opens: Reddit's own "best", or one of the other sorts. */
  frontpageSort?: string;
}

export const FRONT_SORTS = ['best', 'hot', 'new', 'top', 'rising'] as const;
const FRONT_KEY = 'rescue:frontSort';

/** The front page's path for a sort: "/" for Reddit's own best, else "/hot/" and so on. */
export function frontPath(sort: unknown): string {
  return typeof sort === 'string' &&
    sort !== 'best' &&
    (FRONT_SORTS as readonly string[]).includes(sort)
    ? `/${sort}/`
    : '/';
}

/** Where a bare front-page address should go instead, or null to leave it. */
export function frontRedirect(url: string, sort: unknown): string | null {
  const u = new URL(url);
  const to = frontPath(sort);
  return u.pathname === '/' && to !== '/' ? `${to}${u.search}${u.hash}` : null;
}

/** Keep the chosen sort for the next page load (nothing stored for Reddit's own best). */
export function writeFrontSort(sort: unknown): void {
  try {
    if (frontPath(sort) === '/') localStorage.removeItem(FRONT_KEY);
    else localStorage.setItem(FRONT_KEY, String(sort));
  } catch {
    /* storage blocked: the switch then happens once REScue has started */
  }
}

/** document_start: a bare front-page address opens with the chosen sort straight away. */
export function applyEarlyFrontSort(url: string): boolean {
  let sort: string | null;
  try {
    sort = localStorage.getItem(FRONT_KEY);
  } catch {
    return false;
  }
  const to = frontRedirect(url, sort);
  if (!to) return false;
  location.replace(to);
  return true;
}

/** A path on Reddit (never another site, never `//host`), or null. */
export function safeLocalPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return SAFE_PATH.test(t) ? t : null;
}

/**
 * The new logo target, or null to leave Reddit's own link alone. A saved "all" (r/all, which Reddit
 * now redirects to the home feed) is treated as the front page.
 */
export function logoTarget(o: LogoOptions, route: Route, username: string | null): string | null {
  switch (o.destination) {
    case 'popular':
      return '/r/popular/';
    case 'subreddit':
      return route.subreddit && /^[A-Za-z0-9_]{2,21}$/.test(route.subreddit)
        ? `/r/${route.subreddit}/`
        : null;
    case 'profile':
      return username ? `/user/${username}/` : null;
    case 'custom':
      return safeLocalPath(o.customDestination);
    default: {
      const path = frontPath(o.frontpageSort);
      return path === '/' ? null : path;
    }
  }
}

function redirectFront(sort: unknown): void {
  const to = frontRedirect(location.href, sort);
  if (to) location.replace(to);
}

const original = new Map<HTMLAnchorElement, string | null>();
let target: string | null = null;
let observer: MutationObserver | null = null;
let frame = 0;

function applyTarget(): void {
  for (const a of logoAnchors()) {
    if (target === null) continue;
    if (!original.has(a)) original.set(a, a.getAttribute('href'));
    if (a.getAttribute('href') !== target) a.setAttribute('href', target);
  }
}

function restore(): void {
  for (const [a, href] of original) {
    if (!a.isConnected || a.getAttribute('href') !== target) continue;
    if (href === null) a.removeAttribute('href');
    else a.setAttribute('href', href);
  }
  original.clear();
}

function set(opts: LogoOptions, route: Route, username: string | null): void {
  restore();
  target = logoTarget(opts, route, username);
  applyTarget();
}

export const logoLink = defineModule({
  id: 'logoLink',
  resId: 'logoLink',
  category: 'appearance',
  title: 'Logo link',
  description:
    'Choose where Reddit’s logo takes you, and how the front page is sorted: the front page (Reddit’s own behaviour), r/popular, the subreddit you are in, your profile, or a path of your own. It changes the logo’s link in the page header, which REScue has not yet confirmed on the live page; if Reddit keeps the logo out of reach, nothing changes.',
  enabledByDefault: true,
  options: {
    destination: {
      type: 'enum',
      default: 'frontpage',
      title: 'The logo goes to',
      values: [
        { value: 'frontpage', label: 'Front page (Reddit’s default)' },
        { value: 'popular', label: 'r/popular' },
        { value: 'subreddit', label: 'The subreddit I am in' },
        { value: 'profile', label: 'My profile' },
        { value: 'custom', label: 'A path of my own' },
      ],
    },
    frontpageSort: {
      type: 'enum',
      default: 'best',
      title: 'Front page sort',
      values: [
        { value: 'best', label: 'Best (Reddit’s default)' },
        { value: 'hot', label: 'Hot' },
        { value: 'new', label: 'New' },
        { value: 'top', label: 'Top' },
        { value: 'rising', label: 'Rising' },
      ],
      description:
        'Opens your front page sorted this way: from the logo, Reddit’s own Home links, and when you type reddit.com. The sort tabs still switch it. Useful where Reddit’s personalised “best” front page comes up empty or stops after the first posts (seen in LibreWolf) while “hot” and “new” load fine.',
    },
    customDestination: {
      type: 'text',
      default: '/',
      title: 'Your path',
      description: 'Used for “A path of my own”. A path on Reddit such as /r/mildlyinteresting/.',
    },
  },

  init(ctx) {
    writeFrontSort(ctx.options.frontpageSort);
    redirectFront(ctx.options.frontpageSort);
    set(ctx.options, ctx.route, ctx.session.username);
    observer = new MutationObserver((records) => {
      if (target === null || frame) return;
      const touched = records.some(
        (r) => r.type === 'childList' || (r.target instanceof Element && isLogoAnchor(r.target)),
      );
      if (!touched) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        applyTarget();
      });
    });
    observer.observe(document.body ?? document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href'],
    });
  },

  onSettings(ctx) {
    writeFrontSort(ctx.options.frontpageSort);
    set(ctx.options, ctx.route, ctx.session.username);
  },

  onRoute(route, ctx) {
    // Reddit's own Home links move in the page without a load: send a bare front page on too.
    redirectFront(ctx.options.frontpageSort);
    set(ctx.options, route, ctx.session.username);
  },

  dispose() {
    writeFrontSort('best');
    observer?.disconnect();
    observer = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    restore();
    target = null;
  },
});
