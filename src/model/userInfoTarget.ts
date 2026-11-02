/**
 * Which element under the pointer is a username that userInfo may show a card for. Reddit-owned
 * selectors come from the contracts (modules never import them directly): the comment author link
 * (`comment.authorLink`), the body slot and the host of Reddit's own user card. The post author link of
 * the Old Reddit look is REScue's own `a.rescue-oauthor`.
 */
import { C } from '../contracts/reddit';

/** The post author link the Old Reddit look draws (REScue's own node, oldSkin/post.ts). */
export const OLD_POST_AUTHOR_CLASS = 'rescue-oauthor';

const COMMENT_AUTHOR = `[slot="${C.slots.commentMeta}"] ${C.commentAuthorLink}`;
/**
 * Never open a card over these: a comment or post body, Reddit's own user card (a post author's;
 * comment authors have none, though their link sits in a plain `faceplate-hovercard`), any REScue popup.
 */
const EXCLUDED = `${C.commentBody}, ${C.chromeLive.userHoverCard}, .rescue-overlay`;
const USER_PATH = /^\/(?:user|u)\/([A-Za-z0-9_-]{3,20})\/?$/;

/** The user name a link points at (`/user/<name>/` on reddit.com or relative), or null. */
export function userOfHref(href: string | null, origin: string): string | null {
  if (!href) return null;
  try {
    const base = /^https?:/.test(origin) ? origin : 'https://www.reddit.com';
    const url = new URL(href, base);
    if (!/(^|\.)reddit\.com$/.test(url.hostname) && url.origin !== base) return null;
    return USER_PATH.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export interface UserLinkTarget {
  link: HTMLAnchorElement;
  user: string;
}

/**
 * The username link `el` is (or is inside), when it is a comment author link in either look or,
 * with `postAuthors`, the Old Reddit look's post author link.
 */
export function userInfoTarget(el: Element, postAuthors: boolean): UserLinkTarget | null {
  const link =
    el.closest(COMMENT_AUTHOR) ?? (postAuthors ? el.closest(`a.${OLD_POST_AUTHOR_CLASS}`) : null);
  if (!(link instanceof HTMLAnchorElement) || link.closest(EXCLUDED)) return null;
  const user = userOfHref(link.getAttribute('href'), link.ownerDocument.location.origin);
  return user ? { link, user } : null;
}
