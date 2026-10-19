/**
 * Shared thread-link rewriting (used by commentSortBy; a rule registry so more rules can join).
 * Each module registers a rule (href -> new href or null). Links are rewritten when their post arrives and again just before
 * they are used (pointer down, click, focus), so a link Reddit re-renders later is still covered.
 * Nothing reloads: only the href of a link the reader is about to follow changes.
 */
import { threadLinkOf, threadLinks } from '../../model/access';
import type { Post } from '../../model/types';

/** What is known about the post a link belongs to (null when it was not seen arriving). */
export interface LinkInfo {
  commentCount: number | null;
}

type Rule = (href: string, info: LinkInfo) => string | null;

const rules = new Map<string, Rule>();
/** Comment count per thread path, from the posts seen arriving. */
const counts = new Map<string, number>();
const EVENTS = ['pointerdown', 'click', 'auxclick', 'focusin'] as const;

function pathKey(href: string): string {
  try {
    return new URL(href, 'https://www.reddit.com').pathname.replace(/\/+$/, '');
  } catch {
    return href;
  }
}

function rewrite(a: HTMLAnchorElement): void {
  let href = a.getAttribute('href');
  if (!href) return;
  const info: LinkInfo = { commentCount: counts.get(pathKey(href)) ?? null };
  let changed = false;
  for (const rule of rules.values()) {
    const next = rule(href, info);
    if (next) {
      href = next;
      changed = true;
    }
  }
  if (changed) a.setAttribute('href', href);
}

const handler = (e: Event): void => {
  const a = threadLinkOf(e.target);
  if (a) rewrite(a);
};

export function setThreadLinkRule(id: string, rule: Rule): void {
  if (!rules.size) for (const t of EVENTS) document.addEventListener(t, handler, true);
  rules.set(id, rule);
}

export function removeThreadLinkRule(id: string): void {
  rules.delete(id);
  if (!rules.size) {
    for (const t of EVENTS) document.removeEventListener(t, handler, true);
    counts.clear();
  }
}

/** Rewrite the thread links of newly arrived posts. */
export function rewritePosts(posts: Post[]): void {
  if (!rules.size) return;
  for (const p of posts) {
    counts.set(pathKey(p.permalink), p.commentCount);
    for (const a of threadLinks(p.source, p.permalink)) rewrite(a);
  }
}
