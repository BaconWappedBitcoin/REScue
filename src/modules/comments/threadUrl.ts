/**
 * Thread URL defaults (RES commentSortBy, US6): add `?sort=` to a thread link unless the link
 * already carries one, so a choice made in the URL always wins. Pure. (A `?depth=` default was
 * retired in T149: Reddit ignores it on thread links.)
 */

export const COMMENT_SORTS = ['confidence', 'top', 'new', 'controversial', 'old', 'qa'] as const;
export type CommentSort = (typeof COMMENT_SORTS)[number];

export const isCommentSort = (v: unknown): v is CommentSort =>
  typeof v === 'string' && (COMMENT_SORTS as readonly string[]).includes(v);

const BASE = 'https://www.reddit.com';
const REDDIT_HOST = /(^|\.)reddit\.com$/i;

/** The subreddit named in a thread link's path, or ''. */
export function subredditOfLink(href: string): string {
  try {
    return /^\/r\/([A-Za-z0-9_]+)\/comments\//.exec(new URL(href, BASE).pathname)?.[1] ?? '';
  } catch {
    return '';
  }
}

/**
 * `href` with the missing parameters added, or null when nothing changes (not a reddit thread
 * link, or every wanted parameter is already there). A relative link stays relative.
 */
export function withThreadParams(href: string, want: { sort?: string }): string | null {
  let u: URL;
  try {
    u = new URL(href, BASE);
  } catch {
    return null;
  }
  if (!REDDIT_HOST.test(u.hostname) || !/\/comments\//.test(u.pathname)) return null;
  let changed = false;
  if (want.sort && !u.searchParams.has('sort')) {
    u.searchParams.set('sort', want.sort);
    changed = true;
  }
  if (!changed) return null;
  return /^[a-z][a-z0-9+.-]*:/i.test(href) ? u.href : `${u.pathname}${u.search}${u.hash}`;
}
