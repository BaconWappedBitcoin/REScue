/**
 * Old Reddit look, REScue's own replacement rows: what every piece shares (oldRedditSkin).
 *
 * The skin draws a few pieces of its own on top of Reddit's page (a vote column, the title / tagline
 * / link rows, a comment's points and links, sort tabs). Each is a REScue-owned light-DOM element
 * that ACTS through Reddit's own controls (ctx.actions: the bridge presses Reddit's buttons) and
 * reads state from Reddit's own attributes and open shadow roots; nothing is written into a shadow
 * root and Reddit's API is never called. A host carries `data-rescue-ov` only once its column is
 * really mounted: the stylesheet hides Reddit's own controls only for such hosts, so a post whose
 * pieces cannot be built keeps Reddit's own vote buttons.
 */
import { C } from '../../../contracts/reddit';
import type { ActionResult } from '../../../core/actions';
import type { ModuleContext } from '../../../core/types';

/** Set on a post / comment host while REScue's replacement rows are mounted. */
export const MOUNT_ATTR = C.skin.mountAttr;
/** Marks the elements the adapter should place decorations after (author, title, end of tagline). */
export const ANCHOR_ATTR = C.skin.anchorAttr;

export type Ctx = ModuleContext;

/** A REScue-owned element is any node carrying a `rescue-o…` class (so repairs ignore their own writes). */
export const OWN_CLASS = /(^|\s)rescue-o[a-z]/;

export const isOwn = (n: Node): boolean =>
  n instanceof Element && typeof n.className === 'string' && OWN_CLASS.test(n.className);

/** Click handler that keeps the click away from Reddit's card (which would open the post). */
export function onActivate(el: HTMLElement, run: (e: MouseEvent) => void): void {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    run(e);
  });
}

/** Set text only when it differs (keeps the page quiet and the mutation observers calm). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/**
 * The slot name REScue's pieces need on this host to be drawn: none when its (open) shadow root has
 * a top-level default slot or no shadow root at all, else the first of `C.skin.hostSlots` that is a
 * top-level slot there. Only reads the shadow root.
 */
export function hostSlot(host: Element): string | null {
  const top = host.shadowRoot ? [...host.shadowRoot.children] : null;
  if (!top) return null;
  const names = top.filter((n) => n.localName === 'slot').map((n) => n.getAttribute('name') ?? '');
  if (names.includes('')) return null;
  return C.skin.hostSlots.find((n) => names.includes(n)) ?? null;
}

/** Puts REScue's own pieces where the host draws them (see hostSlot). */
export function slotPieces(host: Element, pieces: Element[]): void {
  const slot = hostSlot(host);
  for (const p of pieces) setAttr(p, 'slot', slot);
}

/** One short message for a failed delegated action. */
export function failureText(what: string, r: Extract<ActionResult, { ok: false }>): string {
  if (r.reason === 'signed-out') return `Sign in to ${what}.`;
  if (r.reason === 'rejected') return `Reddit is still busy with the last ${what}; try again.`;
  if (r.reason === 'timeout') return `Reddit did not confirm the ${what}.`;
  return `REScue could not ${what} here: Reddit's own control was not found.`;
}

export function say(ctx: Ctx, message: string): void {
  ctx.notices.show(message, { kind: 'info', id: 'old-skin', timeoutMs: 4000 });
}
