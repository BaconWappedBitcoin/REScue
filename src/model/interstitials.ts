/**
 * Detection of Reddit's interstitials (FR-008). Modules use these helpers instead of selectors,
 * keeping Reddit's names in src/contracts (Principle I).
 */
import { C } from '../contracts/reddit';
import { deepQuery } from '../core/deepQuery';

/** The NSFW age gate, if Reddit is showing one. */
export function findAgeGate(doc: Document = document): Element | null {
  const host = doc.querySelector(C.ageGate.host);
  if (!host) return null;
  const scope = (host as HTMLElement).shadowRoot ?? host;
  const affirm = [...scope.querySelectorAll('button, a[role="button"]')].some((b) => {
    const t = (b.textContent ?? '').trim();
    return C.ageGate.affirm.test(t) && !C.ageGate.decline.test(t);
  });
  return affirm ? host : null;
}

/**
 * Reddit's undismissable login-wall overlays (inherited from Sheddit NATIVE_UPSELL). A dialog that
 * holds a log-in form is the reader's own sign-in (Reddit uses the same dialog), so it is left.
 */
export function findLoginWalls(doc: Document = document): Element[] {
  if (!C.loginWall.overlay) return [];
  return [...doc.querySelectorAll(C.loginWall.overlay)].filter(
    (w) => !deepQuery(w, C.loginWall.authForm),
  );
}

/**
 * Whether an event target is one of Reddit's own log-in / sign-up controls (or inside one), so
 * the reader is asking to sign in. Looks through shadow-root boundaries via the composed path.
 */
export function isAuthControl(path: readonly EventTarget[]): boolean {
  for (const t of path.slice(0, 12)) {
    if (!(t instanceof Element)) continue;
    if (C.loginWall.authControlId.test(t.id)) return true;
    const href = t.getAttribute('href');
    if (href && t.matches('a') && C.loginWall.authControlHref.test(href)) return true;
    if (
      t.matches('a, button, [role="button"]') &&
      C.loginWall.authControlText.test(t.textContent ?? '')
    )
      return true;
  }
  return false;
}

/** Remove login-wall overlays and the scroll lock they impose. Never clicks anything. */
export function removeLoginWalls(doc: Document = document): number {
  const walls = findLoginWalls(doc);
  for (const w of walls) w.remove();
  if (walls.length) doc.body?.classList.remove(C.loginWall.scrollLockClass);
  return walls.length;
}

const QUARANTINE = /\bquarantined\b/i;

/** A quarantine interstitial: no content items, and the page says the community is quarantined. */
export function isQuarantinePrompt(doc: Document = document): boolean {
  if (doc.querySelector(`${C.post}, ${C.comment}`)) return false;
  return QUARANTINE.test(doc.querySelector(C.main)?.textContent ?? doc.body?.textContent ?? '');
}
