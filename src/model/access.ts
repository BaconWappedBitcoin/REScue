/**
 * What feature modules may reach inside a post or comment element. Modules never import
 * contracts/reddit.ts (constitution Principle I), so every Reddit-owned selector or attribute
 * they need is wrapped here: an item's own body, its tables, the native collapsed marker and the
 * light-DOM thread links. Nothing here pierces a shadow root.
 */
import { C } from '../contracts/reddit';
import { ownQueryAll } from '../core/dom';

/** The item's OWN body element (never a nested reply's), or null. */
export function ownBody(source: Element): Element | null {
  const isComment = source.matches(C.comment);
  return (
    ownQueryAll(
      source,
      isComment ? C.commentBody : C.postBody,
      isComment ? C.comment : C.post,
    )[0] ?? null
  );
}

/** Tables inside the item's own body. */
export function bodyTables(source: Element): HTMLTableElement[] {
  const body = ownBody(source);
  return body ? [...body.querySelectorAll('table')] : [];
}

/** Is the element inside a post's or comment's body (light DOM)? */
export const inItemBody = (el: Element): boolean =>
  el.closest(`${C.commentBody}, ${C.postBody}`) !== null;

/**
 * The comment's OWN collapse element: the <details> with a <summary> child that belongs to this
 * comment rather than to a reply nested inside it (contracts: comment.details).
 */
export function ownDetails(host: Element): HTMLDetailsElement | null {
  for (const d of host.querySelectorAll(C.commentDetails)) {
    if (d.closest(C.comment) !== host || !(d instanceof HTMLDetailsElement)) continue;
    if ([...d.children].some((c) => c.matches(C.commentSummary))) return d;
  }
  return null;
}

/** Is the comment collapsed? Null when it has no collapse element. */
export function isNativeCollapsed(host: Element): boolean | null {
  const d = ownDetails(host);
  return d ? !d.open : null;
}

/** The thing id of the comment a <details> belongs to, if it is a comment's own collapse element. */
function collapseOwner(target: EventTarget | null): { id: string; open: boolean } | null {
  if (!(target instanceof HTMLDetailsElement)) return null;
  const host = target.closest(C.comment);
  const id = host?.getAttribute(C.commentAttr.id);
  if (!host || !id || ownDetails(host) !== target) return null;
  return { id, open: target.open };
}

/**
 * Call `cb` whenever any comment is collapsed or re-opened. `toggle` does not bubble, so this is
 * one capture listener on the document. Returns a disposer.
 */
export function watchCollapseToggles(cb: (id: string, collapsed: boolean) => void): () => void {
  const onToggle = (e: Event) => {
    const o = collapseOwner(e.target);
    if (o) cb(o.id, !o.open);
  };
  document.addEventListener('toggle', onToggle, true);
  return () => document.removeEventListener('toggle', onToggle, true);
}

const nextFrame = (): Promise<void> =>
  new Promise((r) =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(() => r())
      : setTimeout(r, 16),
  );

/** Did collapsing take effect: closed, and the comment's own body takes no room (when measurable)? */
function collapseTookEffect(host: Element, d: HTMLDetailsElement): boolean {
  if (d.open) return false;
  const body = ownBody(host);
  return !body || body.getBoundingClientRect().height === 0;
}

/**
 * Collapse a comment the way Reddit does. First set `details.open = false`; after a frame check it
 * worked; if not, click Reddit's own <summary> (the click is dispatched ON the summary, never on
 * our controls inside it). Resolves true if the comment ended up collapsed, false (nothing
 * changed that could break) otherwise. `onApply` runs just before each attempt.
 */
export async function collapseComment(host: Element, onApply?: () => void): Promise<boolean> {
  const d = ownDetails(host);
  if (!d) return false;
  if (!d.open) return true;
  onApply?.();
  d.open = false;
  await nextFrame();
  if (collapseTookEffect(host, d)) return true;
  const summary = [...d.children].find((c) => c.matches(C.commentSummary));
  if (d.open && summary instanceof HTMLElement) {
    onApply?.();
    summary.click();
    await nextFrame();
  }
  return collapseTookEffect(host, d);
}

/**
 * Collapse or re-open a comment through Reddit's own <details> (Enter on a selected comment).
 * Resolves the new collapsed state, or null when the comment has no collapse element.
 */
export async function toggleCommentCollapse(host: Element): Promise<boolean | null> {
  const d = ownDetails(host);
  if (!d) return null;
  if (d.open) return collapseComment(host);
  d.open = true;
  return false;
}

const hasBox = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** The active element, looking through open shadow roots. */
function deepActive(doc: Document): Element | null {
  let a: Element | null = doc.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a;
}

type SearchField = HTMLInputElement | HTMLTextAreaElement;

/**
 * Search fields under `root`, descending into open shadow roots. `selector` decides what counts;
 * a host element that is itself a root (the header's search box) is searched through its own
 * shadow root, which `querySelectorAll` on the host does not reach.
 */
function searchFieldsIn(
  root: ParentNode,
  selector: string,
  out: SearchField[] = [],
): SearchField[] {
  for (const el of root.querySelectorAll(selector))
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) out.push(el);
  const own = (root as Element).shadowRoot;
  if (own) searchFieldsIn(own, selector, out);
  for (const el of root.querySelectorAll('*'))
    if (el.shadowRoot) searchFieldsIn(el.shadowRoot, selector, out);
  return out;
}

/** The header search field that has a real box (Reddit also renders hidden 0x0 twins). */
function visibleSearchInput(doc: Document): SearchField | null {
  const roots = [...doc.querySelectorAll(C.chromeLive.searchRoots)];
  const inRoots = `${C.chrome.searchInput}, ${C.chromeLive.searchTextarea}`;
  const found = [
    ...roots.flatMap((r) => searchFieldsIn(r, inRoots)),
    ...searchFieldsIn(doc, C.chrome.searchInput),
  ];
  return found.find(hasBox) ?? null;
}

function focusInput(doc: Document, input: SearchField): boolean {
  input.focus();
  if (deepActive(doc) !== input) return false;
  input.select();
  return true;
}

/**
 * Focus Reddit's visible header search box. Returns true when the box is focused now, or when the
 * search trigger was clicked and the box is being waited for (`done` then says whether it got
 * focus). False when there is neither a visible box nor a trigger.
 */
export function focusSearchBox(done?: (ok: boolean) => void, doc: Document = document): boolean {
  const input = visibleSearchInput(doc);
  if (input && focusInput(doc, input)) return true;
  const trigger = doc.querySelector(C.chromeLive.searchTrigger);
  if (!(trigger instanceof HTMLElement)) return false;
  trigger.click();
  let tries = 0;
  const poll = (): void => {
    const box = visibleSearchInput(doc);
    if (box && focusInput(doc, box)) return done?.(true);
    if (++tries >= 10) return done?.(false);
    setTimeout(poll, 60);
  };
  setTimeout(poll, 0);
  return true;
}

/** Light-DOM links to the post's own thread: the anchors in the post element that point at it. */
export function threadLinks(source: Element, permalink: string): HTMLAnchorElement[] {
  const path = pathOf(permalink);
  if (!path) return [];
  return ownQueryAll(source, C.threadLink, C.post).filter(
    (a): a is HTMLAnchorElement =>
      a instanceof HTMLAnchorElement && pathOf(a.getAttribute('href')) === path,
  );
}

/** The thread link (inside a post) an event target is in, or null. */
export function threadLinkOf(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  const a = target.closest(C.threadLink);
  return a instanceof HTMLAnchorElement && a.closest(C.post) ? a : null;
}

/** Every light-DOM link under `root` that points into a comments thread (post or comment permalink). */
export function threadAnchorsIn(root: ParentNode): HTMLAnchorElement[] {
  return [...root.querySelectorAll(C.threadLink)].filter(
    (a): a is HTMLAnchorElement => a instanceof HTMLAnchorElement,
  );
}

/** The comments-thread link an event target is in, wherever it is on the page, or null. */
export function threadAnchorOf(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  const a = target.closest(C.threadLink);
  return a instanceof HTMLAnchorElement ? a : null;
}

function pathOf(href: string | null): string | null {
  if (!href) return null;
  try {
    return new URL(href, 'https://www.reddit.com').pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}
