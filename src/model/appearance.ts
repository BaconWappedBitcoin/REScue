/**
 * What the appearance modules (US8) may reach: an item's relative-time element, the page header's
 * logo and search form, the chat entry points and the places the signed-in username shows. Modules
 * never import contracts/reddit.ts (constitution Principle I), so each selector is wrapped here.
 * All of it is light DOM; most entries are candidates (contracts: `chrome.*`) and every helper
 * returns nothing when the page does not match.
 */
import { C } from '../contracts/reddit';
import { ownQueryAll } from '../core/dom';
import { isSearchPost, searchTimeElement } from './search-post';

const bySlot = (name: string) => `[${C.slotAttr}="${name}"]`;

/** The relative-time element in the item's OWN credit bar (post, search result) or meta line (comment), or null. */
export function ownTimeElement(source: Element): Element | null {
  if (isSearchPost(source)) return searchTimeElement(source);
  if (source.matches(C.post)) {
    for (const bar of ownQueryAll(source, bySlot(C.slots.postCredit), C.post)) {
      const t = bar.querySelector(C.postTime);
      if (t) return t;
    }
    return null;
  }
  if (source.matches(C.comment)) {
    for (const meta of ownQueryAll(source, bySlot(C.slots.commentMeta), C.comment)) {
      const t = meta.querySelector(C.time.commentTime);
      if (t) return t;
    }
  }
  return null;
}

/** The instant a time element shows: its `ts`, else an inner/own <time datetime>. Null if neither. */
export function timeElementDate(el: Element): Date | null {
  const raw =
    el.getAttribute(C.time.tsAttr) ??
    el.getAttribute(C.time.datetimeAttr) ??
    el.querySelector(C.time.inner)?.getAttribute(C.time.datetimeAttr) ??
    null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The post's logo anchor(s) in the page header (light DOM). */
export function logoAnchors(doc: Document = document): HTMLAnchorElement[] {
  return [...doc.querySelectorAll(C.chrome.logoLink)].filter(
    (a): a is HTMLAnchorElement => a instanceof HTMLAnchorElement,
  );
}

/** Is this element one of the header's logo anchors? */
export const isLogoAnchor = (el: Element): boolean => el.matches(C.chrome.logoLink);

/** The header's search form(s). */
export function searchForms(doc: Document = document): HTMLFormElement[] {
  return [...doc.querySelectorAll(C.chrome.searchForm)].filter(
    (f): f is HTMLFormElement => f instanceof HTMLFormElement,
  );
}

/** The search text input inside a search form, or null. */
export const searchInput = (form: HTMLFormElement): HTMLInputElement | null =>
  form.querySelector<HTMLInputElement>(C.chrome.searchInput);

export interface SearchDefaults {
  /** `none` leaves Reddit's own choice alone. */
  sort: string;
  time: string;
}

/**
 * The search page address with the reader's default sort / time added where the address has none,
 * or null when it is not a search results address or nothing needs adding (so it cannot loop).
 */
export function searchWithDefaults(href: string, d: SearchDefaults): string | null {
  const u = new URL(href, 'https://www.reddit.com');
  const p = C.searchParams;
  if (!C.searchPathEnd.test(u.pathname) || !u.searchParams.has(p.query)) return null;
  let changed = false;
  if (d.sort !== 'none' && !u.searchParams.has(p.sort)) {
    u.searchParams.set(p.sort, d.sort);
    changed = true;
  }
  if (d.time !== 'none' && !u.searchParams.has(p.time)) {
    u.searchParams.set(p.time, d.time);
    changed = true;
  }
  return changed ? u.pathname + u.search : null;
}

/** The address a header search for `query` should open from inside `subreddit`, restricted to it. */
export function subredditSearchHref(subreddit: string, query: string, d: SearchDefaults): string {
  const u = new URL(`/r/${encodeURIComponent(subreddit)}/search/`, 'https://www.reddit.com');
  const p = C.searchParams;
  u.searchParams.set(p.query, query);
  u.searchParams.set(p.restrict, '1');
  if (d.sort !== 'none') u.searchParams.set(p.sort, d.sort);
  if (d.time !== 'none') u.searchParams.set(p.time, d.time);
  return u.pathname + u.search;
}

/** Is this search already restricted to a subreddit (the address says so, or the form asks)? */
export const hasRestrictField = (form: HTMLFormElement): boolean =>
  form.querySelector(`[name="${C.searchParams.restrict}"]`) !== null;

/** Selector list for the chat entry points in the header (used in a REScue stylesheet). */
export const chatEntrySelector = (): string => C.chrome.chatEntry;

/** Selectors for the visited-link and top-level-comment tweaks (used in a REScue stylesheet). */
export const visitedLinkSelector = (): string => C.chrome.visitedLinks;
export const topLevelCommentSelector = (): string => C.chrome.topLevelComment;

/** Selectors for the comment-style, title and body-link tweaks (used in a REScue stylesheet). */
export const postTitleSelector = (): string => C.chrome.postTitle;
export const commentHostSelector = (): string => C.comment;
/** The thread line inside a comment and the attributes the comment tweaks key their CSS on. */
export const commentThreadlineSelector = (): string => C.commentThreadline;
export const commentCollapsedAttr = (): string => C.commentCollapsedAttr;
export const commentDepthAttr = (): string => C.commentAttr.depth;

/** Links inside a post's or a comment's own body (light DOM), for the long-link truncation. */
export function bodyLinks(root: ParentNode = document): HTMLAnchorElement[] {
  const out: HTMLAnchorElement[] = [];
  for (const a of root.querySelectorAll(`${C.commentBody} a[href], ${C.postBody} a[href]`)) {
    if (a instanceof HTMLAnchorElement) out.push(a);
  }
  return out;
}

/** The comment element with this thing id, or null. */
export function commentHostById(id: string, doc: Document = document): Element | null {
  for (const el of doc.querySelectorAll(C.comment)) {
    if (el.getAttribute(C.commentAttr.id) === id) return el;
  }
  return null;
}

/** Reddit's comment composer (light DOM host), or null when the page has none. */
export const commentComposer = (doc: Document = document): Element | null =>
  doc.querySelector(C.composer.host);

/** The page's first comment, for jumping to the comments when there is no composer. */
export const firstCommentElement = (doc: Document = document): Element | null =>
  doc.querySelector(C.comment);

/** Header and user-drawer containers, where the signed-in name may appear outside a link. */
export function userMenuRoots(doc: Document = document): Element[] {
  return [...doc.querySelectorAll(C.chrome.userMenu)];
}

/** Where a profile page writes its user's name as plain text (header, "u/name", search chip). */
export function profileNameRoots(doc: Document = document): Element[] {
  return [...doc.querySelectorAll(C.chrome.profileNames)];
}

/** `/user/<name>` (or `/u/<name>`) in a link's href, lower-cased; null for any other link. */
export function userOfHref(href: string | null): string | null {
  const m = /^(?:https?:\/\/[^/]+)?\/(?:user|u)\/([^/?#]+)/i.exec(href ?? '');
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!).toLowerCase();
  } catch {
    return null;
  }
}

/** Every link in the document that points at a profile, with the (lower-case) user it names. */
export function profileLinks(root: ParentNode = document): Array<[HTMLAnchorElement, string]> {
  const out: Array<[HTMLAnchorElement, string]> = [];
  for (const a of root.querySelectorAll('a[href]')) {
    if (!(a instanceof HTMLAnchorElement)) continue;
    const user = userOfHref(a.getAttribute('href'));
    if (user) out.push([a, user]);
  }
  return out;
}
