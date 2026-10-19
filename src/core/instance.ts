/**
 * One live REScue per page. Reloading the add-on (about:debugging, an update, a second install)
 * can leave the previous content script running in a page that is already open, so the same post
 * got every REScue control three times. The newest instance wins: it writes a fresh token on
 * <html data-rescue-instance>, which every older instance watches (a DOM attribute is visible
 * across extension worlds) and tears itself down when the token is no longer its own. Every node
 * REScue puts on the page carries `data-rescue-owner="<token>"`, so the newest instance can also
 * sweep up what an older instance left behind, even one that can no longer run (lost context).
 */

export const INSTANCE_ATTR = 'data-rescue-instance';
export const OWNER_ATTR = 'data-rescue-owner';

let current: string | null = null;

/** Marks a node as belonging to this page's live REScue instance (no-op before takeOver). */
export function stamp<T extends Element>(el: T): T {
  if (current) el.setAttribute(OWNER_ATTR, current);
  return el;
}

/** The live token (tests). */
export function currentToken(): string | null {
  return current;
}

export interface Instance {
  token: string;
  /** True while no newer instance has taken over. */
  alive(): boolean;
  /** Stop watching (the caller's own teardown, or tests). */
  release(): void;
}

function freshToken(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(2));
  return `${Date.now().toString(36)}-${bytes[0]!.toString(36)}${bytes[1]!.toString(36)}`;
}

/**
 * State an instance leaves on Reddit's own elements. A new instance starts from a clean page: a
 * post the old one marked "seen" would otherwise never be decorated again (live 2026-10-16: after
 * an add-on reload the new instance found every post already seen and decorated nothing).
 */
export const STALE_ATTRS = [
  'data-rescue-seen',
  'data-rescue-hidden',
  'data-rescue-collapsed',
  'data-rescue-selected',
  // The old Reddit look's switch on <html>: a new instance sets it again if its module is on.
  'data-rescue-skin',
];

/** Remove everything an instance other than `token` left on the page. Returns how many. */
export function sweepForeign(token: string, doc: Document = document): number {
  let n = 0;
  for (const el of doc.querySelectorAll(`[${OWNER_ATTR}]`)) {
    if (el.getAttribute(OWNER_ATTR) === token) continue;
    el.remove();
    n++;
  }
  for (const attr of STALE_ATTRS) {
    for (const el of doc.querySelectorAll(`[${attr}]`)) el.removeAttribute(attr);
  }
  return n;
}

/** Remove everything this instance put on the page. */
export function sweepOwn(token: string, doc: Document = document): void {
  for (const el of doc.querySelectorAll(`[${OWNER_ATTR}="${token}"]`)) el.remove();
}

/**
 * Become the page's instance. `onSuperseded` runs once, when a newer instance takes over; it must
 * stop this instance's observers and listeners and remove its nodes (see sweepOwn).
 */
export function takeOver(onSuperseded: () => void, doc: Document = document): Instance {
  const root = doc.documentElement;
  const token = freshToken();
  const previous = root.getAttribute(INSTANCE_ATTR);
  root.setAttribute(INSTANCE_ATTR, token);
  current = token;
  if (previous) console.warn('[REScue] replacing an earlier REScue instance on this page');
  sweepForeign(token, doc);

  let live = true;
  const check = (): void => {
    if (!live || root.getAttribute(INSTANCE_ATTR) === token) return;
    live = false;
    observer.disconnect();
    try {
      onSuperseded();
    } catch {
      /* the newer instance sweeps whatever is left */
    }
  };
  const observer = new MutationObserver(check);
  observer.observe(root, { attributes: true, attributeFilter: [INSTANCE_ATTR] });
  return {
    token,
    alive: () => live,
    release() {
      live = false;
      observer.disconnect();
    },
  };
}
