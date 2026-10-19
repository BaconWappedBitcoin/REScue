/**
 * shreddit-profile-comment -> ProfileComment.
 * Ported from Sheddit src/core/model.js profileComment() — GPL-3.0, kookaburrabarrel, cff40d7.
 */
import { C } from '../contracts/reddit';
import { ownQueryAll, parseDate, sanitizedInner } from '../core/dom';
import { ContractTally } from './tally';
import type { ProfileComment } from './types';

export function parseProfileComment(el: Element, tally?: ContractTally): ProfileComment | null {
  const A = C.profileCommentAttr;
  const id = el.getAttribute(A.id);
  const href = el.getAttribute(A.href);
  const bodies = ownQueryAll(el, C.profileCommentBody, C.profileComment);
  const body =
    bodies.find((n) => !bodies.some((o) => o !== n && n.contains(o))) ?? bodies[0] ?? null;
  if (!id || !href || !body) {
    tally?.miss('profileComment');
    return null;
  }
  tally?.hit('profileComment');

  const thread = /^\/(r|user)\/([^/]+)\/comments\/[^/]+\//.exec(href);
  let subreddit: string | null = thread?.[1] === 'r' ? thread[2]! : null;
  let postTitle: string | null = null;
  for (const a of ownQueryAll(el, 'a[href]', C.profileComment)) {
    if (a.closest(C.profileCommentBody)) continue;
    const path = (a.getAttribute('href') ?? '').split('?')[0]!;
    const sub = /^\/r\/([^/?#]+)\/?$/.exec(path);
    if (!subreddit && sub) subreddit = sub[1]!;
    if (
      !postTitle &&
      thread &&
      path.startsWith(thread[0]) &&
      !/\/comment\//.test(path) &&
      path !== href.split('?')[0]
    ) {
      const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) postTitle = text;
    }
  }
  const time = ownQueryAll(el, 'time[datetime]', C.profileComment)[0];
  return {
    kind: 'profileComment',
    id,
    permalink: href.split('?')[0]!,
    contextHref: href,
    subreddit,
    postTitle,
    created: parseDate(time?.getAttribute('datetime')),
    bodyHtml: sanitizedInner(body),
    source: el,
  };
}
