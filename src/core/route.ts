/**
 * Route classification and SPA route-change events. URL-only (no DOM).
 */
import { NAVIGATED_EVENT } from './bridge-protocol';
import type { Route } from './types';

export function classify(href: string): Route {
  const url = new URL(href, 'https://www.reddit.com');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((p) => decodeURIComponent(p));
  const base = { path };

  if (
    parts.length === 0 ||
    (parts.length === 1 && /^(best|hot|new|top|rising|controversial)$/i.test(parts[0]!))
  ) {
    return { ...base, kind: 'front' };
  }
  const [a, b, c, d] = parts;
  if (a === 'search' || (a === 'r' && c === 'search')) {
    return {
      ...base,
      kind: 'search',
      ...(a === 'r' && b ? { subreddit: b } : {}),
    };
  }
  if (a === 'r' && b) {
    const low = b.toLowerCase();
    if (c === 'comments' && d) return { ...base, kind: 'thread', subreddit: b, postId: `t3_${d}` };
    if (low === 'all') return { ...base, kind: 'all', subreddit: b };
    if (low === 'popular') return { ...base, kind: 'popular', subreddit: b };
    if (!c || /^(best|hot|new|top|rising|controversial)$/i.test(c)) {
      return { ...base, kind: 'subreddit', subreddit: b };
    }
    return { ...base, kind: 'other', subreddit: b };
  }
  if ((a === 'user' || a === 'u') && b) {
    if (c === 'm' && d) return { ...base, kind: 'customFeed', username: b };
    if (c === 'comments' && d) return { ...base, kind: 'thread', username: b, postId: `t3_${d}` };
    if (!c || /^(overview|submitted|posts|comments)$/i.test(c)) {
      return { ...base, kind: 'profile', username: b };
    }
    return { ...base, kind: 'other', username: b };
  }
  return { ...base, kind: 'other' };
}

/**
 * Route-change watcher. The MAIN-world bridge patches history.pushState/replaceState and fires
 * NAVIGATED_EVENT; popstate covers back/forward; a slow URL poll is the last-resort fallback.
 */
export function watchRoute(
  onChange: (route: Route, href: string) => void,
  win: Window = window,
): () => void {
  let last = win.location.href;
  const check = () => {
    const now = win.location.href;
    if (now === last) return;
    last = now;
    onChange(classify(now), now);
  };
  win.addEventListener(NAVIGATED_EVENT, check);
  win.addEventListener('popstate', check);
  const poll = win.setInterval(check, 1000);
  return () => {
    win.removeEventListener(NAVIGATED_EVENT, check);
    win.removeEventListener('popstate', check);
    win.clearInterval(poll);
  };
}
