/**
 * Search result element -> Post model. A result is a `search-telemetry-tracker`, not a
 * shreddit-post (contracts: `search.*`, verified live 2026-10-15), so the facts come from its
 * tracking-context JSON plus a few light-DOM nodes. The same triad as parsePost (id, title,
 * permalink) decides whether an element is a result at all; data a result does not carry (author
 * link, upvote ratio, body, media, flair) stays null. Also the anchors the adapter and the
 * appearance helpers use inside a result.
 */
import { C } from '../contracts/reddit';
import { parseDate, parseNumber } from '../core/dom';
import { ContractTally } from './tally';
import type { Post } from './types';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The tracking-context JSON of a result, or an empty object when absent or malformed. */
function contextOf(el: Element): Record<string, unknown> {
  const raw = el.getAttribute(C.search.contextAttr);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const section = (ctx: Record<string, unknown>, key: string): Record<string, unknown> => {
  const v = ctx[key];
  return isRecord(v) ? v : {};
};

/** Is this element a search result (the item host)? */
export const isSearchPost = (el: Element): boolean => el.matches(C.search.post);

/** First match of `sel` that belongs to this result rather than to a result nested inside it. */
function own(host: Element, sel: string): Element | null {
  for (const el of host.querySelectorAll(sel)) if (el.closest(C.search.post) === host) return el;
  return null;
}

/** The result's own relative-time element inside its own credit row, or null. */
export function searchTimeElement(host: Element): Element | null {
  const row = own(host, C.search.creditRow);
  return row ? row.querySelector(C.search.time) : null;
}

/** The result's own title text anchor (where title decorations go after), or null. */
export const searchTitleAnchor = (host: Element): Element | null => own(host, C.search.titleText);

export function parseSearchPost(el: Element, tally?: ContractTally): Post | null {
  const ctx = contextOf(el);
  const post = section(ctx, 'post');
  const titleLink = own(el, C.search.titleLink);
  const id = str(post.id);
  const title =
    str(post.title) ?? titleLink?.getAttribute('aria-label') ?? titleLink?.textContent?.trim();
  const permalink = titleLink?.getAttribute('href');
  if (!id || !title || !permalink) {
    tally?.miss('search.post');
    return null;
  }
  tally?.hit('search.post');

  const counts = [...(own(el, C.search.counterRow)?.querySelectorAll(C.search.number) ?? [])].map(
    (n) => parseNumber(n.getAttribute(C.search.numberAttr)),
  );
  const index = section(ctx, 'action_info').position;

  return {
    kind: 'post',
    id,
    title,
    permalink,
    url: null,
    type: 'other',
    domain: '',
    author: str(section(ctx, 'profile').name),
    subreddit: str(section(ctx, 'subreddit').name) ?? '',
    score: counts[0] ?? null,
    upvoteRatio: null,
    commentCount: counts[1] ?? 0,
    created: parseDate(searchTimeElement(el)?.getAttribute(C.time.tsAttr)),
    flair: null,
    nsfw: post.nsfw === true,
    spoiler: post.spoiler === true,
    thumbnail: null,
    media: null,
    feedIndex: typeof index === 'number' ? index : null,
    bodyHtml: null,
    source: el,
  };
}
