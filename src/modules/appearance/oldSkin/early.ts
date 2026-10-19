/**
 * Old Reddit look from the first paint. Modules start only after the page's DOM is ready and the
 * settings are read, about a second after Reddit's first posts are on screen, so the page would
 * show Reddit's own look first. The module therefore keeps a copy of its options in the page's
 * localStorage while it is on (nothing else, and nothing at all while it is off), and the content
 * script reads it at document_start: the skin attribute and stylesheet go on at once, and the
 * stylesheet's veil keeps each post and comment unseen until REScue's rows are on it (or for three
 * seconds at most, see model/oldSkin.ts). Once the module has started, its own stylesheet takes
 * over and this one goes; if the module is off or fails to start, the attribute goes too, so a
 * stale copy can never leave the page skinned without a way back (content.ts).
 */
import { classify } from '../../../core/route';
import { oldSkinCss, SKIN_ATTR, SKIN_VALUE, skinApplies, type OldSkinOptions } from '../../../model/oldSkin';

export const EARLY_SKIN_ID = 'rescue-old-skin-early';
const KEY = 'rescue:oldSkin';

/** Keep the options for the next page load, or forget them (module off). */
export function writeSkinMirror(options: OldSkinOptions | null): void {
  try {
    if (!options) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(options));
  } catch {
    /* storage blocked: the look then comes a moment later, from the module */
  }
}

function readSkinMirror(): OldSkinOptions | null {
  try {
    const raw = localStorage.getItem(KEY);
    const o = raw ? (JSON.parse(raw) as OldSkinOptions) : null;
    return o && typeof o === 'object' && typeof o.thumbnails === 'string' ? o : null;
  } catch {
    return null;
  }
}

/** document_start: put the look on at once, if the skin was on when the page was last seen. */
export function applyEarlySkin(url: string, doc: Document = document): boolean {
  const o = readSkinMirror();
  if (!o || !skinApplies(classify(url))) return false;
  const html = doc.documentElement;
  html.setAttribute(SKIN_ATTR, SKIN_VALUE);
  const style = doc.createElement('style');
  style.id = EARLY_SKIN_ID;
  style.textContent = oldSkinCss(o);
  (doc.head ?? html).appendChild(style);
  return true;
}

/**
 * After the modules started: drop the early stylesheet. If the module did not put its own on
 * (it is off, or the page is not one it covers), take the attribute away too.
 */
export function clearEarlySkin(ownStyleId: string, doc: Document = document): void {
  const early = doc.getElementById(EARLY_SKIN_ID);
  if (!early) return;
  early.remove();
  if (!doc.getElementById(ownStyleId)) doc.documentElement.removeAttribute(SKIN_ATTR);
}
