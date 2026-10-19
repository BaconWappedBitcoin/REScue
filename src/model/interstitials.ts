/**
 * Detection of Reddit's interstitials (FR-008). Modules use these helpers instead of selectors,
 * keeping Reddit's names in src/contracts (Principle I).
 */
import { C } from '../contracts/reddit';

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

/** Reddit's undismissable login-wall overlays (inherited from Sheddit NATIVE_UPSELL). */
export function findLoginWalls(doc: Document = document): Element[] {
  return C.loginWall.overlay ? [...doc.querySelectorAll(C.loginWall.overlay)] : [];
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
