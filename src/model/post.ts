/**
 * shreddit-post element -> Post model. The required triad (id, title, permalink) decides whether
 * an element is a post at all; everything else is optional.
 *
 * Ported from Sheddit src/core/model.js post() — GPL-3.0, kookaburrabarrel, commit cff40d7.
 */
import { C } from '../contracts/reddit';
import { ownQueryAll, parseDate, parseNumber, sanitizedInner } from '../core/dom';
import { describeMedia, thumbnailOf } from './media';
import { ContractTally } from './tally';
import { POST_TYPES, type Post, type PostType } from './types';

const flagOf = (el: Element, names: readonly string[]): boolean =>
  names.some((n) => {
    const v = el.getAttribute(n);
    if (v === null) return false;
    const s = v.trim().toLowerCase();
    return s !== 'false' && s !== '0';
  });

export function parsePost(el: Element, tally?: ContractTally): Post | null {
  const A = C.postAttr;
  const id = el.getAttribute(A.id);
  const title = el.getAttribute(A.title);
  const permalink = el.getAttribute(A.permalink);
  if (!id || !title || !permalink) {
    tally?.miss('post.attrs');
    return null;
  }
  tally?.hit('post.attrs');

  const rawType = el.getAttribute(A.type) ?? 'text';
  const type: PostType = (POST_TYPES as readonly string[]).includes(rawType)
    ? (rawType as PostType)
    : 'other';
  const domain = el.getAttribute(A.domain) ?? '';
  const isSelf = /^self\./.test(domain) || type === 'text';
  const contentHref = el.getAttribute(A.contentHref);
  const body = ownQueryAll(el, C.postBody, C.post)[0] ?? null;
  const flairEl = ownQueryAll(el, C.postFlair, C.post)[0];
  const flairText = flairEl?.textContent?.replace(/\s+/g, ' ').trim();

  return {
    kind: 'post',
    id,
    title,
    permalink,
    url: isSelf ? null : contentHref,
    type,
    domain,
    author: el.getAttribute(A.author) || null,
    subreddit: el.getAttribute(A.subreddit) ?? '',
    score: parseNumber(el.getAttribute(A.score)),
    upvoteRatio: parseNumber(el.getAttribute(A.upvoteRatio)),
    commentCount: parseNumber(el.getAttribute(A.comments)) ?? 0,
    created: parseDate(el.getAttribute(A.created)),
    flair: flairText ? { text: flairText } : null,
    nsfw: flagOf(el, C.nsfwAttrs),
    spoiler: flagOf(el, C.spoilerAttrs),
    locked: flagOf(el, [C.postFlagAttrs.locked]),
    stickied: flagOf(el, [C.postFlagAttrs.stickied]),
    thumbnail: thumbnailOf(el, type),
    media: describeMedia(el, type, contentHref),
    feedIndex: parseNumber(el.getAttribute(A.index)),
    bodyHtml: body ? sanitizedInner(body) : null,
    source: el,
  };
}

/**
 * Drops a post that is already on the page (FR-012: the same post twice in one feed). It is keyed
 * by id but only while the element that first carried the id is still in the document: Reddit
 * re-renders a feed's posts as new elements when they scroll far away and back (live 2026-10-18),
 * and a new element for a known id is a post that has no decorations yet, not a repeat.
 */
export class PostDeduper {
  private readonly seen = new Map<string, WeakRef<Element>>();

  accept(p: Post): boolean {
    const prior = this.seen.get(p.id)?.deref();
    if (prior?.isConnected) return false;
    this.seen.set(p.id, new WeakRef(p.source));
    return true;
  }

  reset(): void {
    this.seen.clear();
  }
}
