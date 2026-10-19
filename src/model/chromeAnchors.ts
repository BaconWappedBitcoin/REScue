/**
 * Header and hover-card anchors (contracts: `chromeLive`, verified live 2026-10-15). Modules never
 * import contracts/reddit.ts, so the selectors are wrapped here. Everything is light DOM and every
 * helper returns null / nothing when the page does not match, so a feature built on one fails safe.
 */
import { C } from '../contracts/reddit';

export interface HeaderAnchor {
  /** The header's icon strip. */
  strip: Element;
  /** The strip's child that holds `a#create-post`; REScue's button goes right before it. */
  before: Element;
}

/** Where REScue's header button goes: next to Create, in the header's icon strip, or null. */
export function headerAnchor(doc: Document = document): HeaderAnchor | null {
  const link = doc.querySelector(C.chromeLive.createPost);
  if (!link) return null;
  const before = link.closest(C.chromeLive.createPostWrapper) ?? link;
  const strip = before.parentElement;
  if (!strip || strip === doc.body || strip === doc.documentElement) return null;
  return { strip, before };
}

/** User hover cards (POST authors only) under `root`. */
export function userHoverCards(root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(C.chromeLive.userHoverCard)];
}

/** The card's own content slot, where a REScue control may be appended. */
export function hoverCardContent(card: Element): HTMLElement | null {
  const el = [...card.querySelectorAll(C.chromeLive.hoverCardContent)].find(
    (e) => e.closest(C.chromeLive.userHoverCard) === card,
  );
  return el instanceof HTMLElement ? el : null;
}

/** The selector that finds hover cards (for a MutationObserver filter). */
export const userHoverCardSelector = (): string => C.chromeLive.userHoverCard;

/** The `/user/<name>` link inside the card's host (the author link), lower-cased name or null. */
export function hoverCardUser(card: Element): string | null {
  const a = card.querySelector(C.commentAuthorLink);
  const m = /\/(?:user|u)\/([^/?#]+)/i.exec(a?.getAttribute('href') ?? '');
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

/** The feed's own next-page loader (a direct child of the feed): Reddit loads more posts with it. */
export const feedLoaderSelector = (): string => C.feedPartial;

/** The id prefix Reddit's own code uses to find the subreddit / profile loader. */
export const feedLoaderIdPrefix = (): string => C.feedPartialIdPrefix;

/** Post elements, to count how many posts a feed shows. */
export const feedPostSelector = (): string => C.post;

/** Reddit's own user hover card content, for a REScue stylesheet that hides it (redditUserInfo). */
export const userHoverCardContentSelector = (): string =>
  `${C.chromeLive.userHoverCard} ${C.chromeLive.hoverCardContent}`;
