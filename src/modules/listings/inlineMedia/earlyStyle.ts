/**
 * The early stylesheet for hidden comment media. Modules start after the page's DOM is ready, and
 * Reddit's first HTML already holds the comments, so a stylesheet added then would let their
 * pictures flash on every refresh. The module therefore keeps a one-line copy of its decision in
 * the page's localStorage (a switch and the subreddit rows, nothing else), and the content script
 * reads it at document_start and adds the same stylesheet at once. Once the module has started it
 * puts its own stylesheet in and this one goes; if the module is off or fails to start, this one
 * goes too, so a stale copy can never leave media hidden without a way back (content.ts).
 */
import { classify } from '../../../core/route';
import { commentMediaCss } from '../../../model/comment-media';
import { commentMediaHidden, type SubAction } from './policy';

export const EARLY_STYLE_ID = 'rescue-cm-early';
const KEY = 'rescue:commentMedia';

interface Mirror {
  h: boolean;
  s: Array<[string, SubAction]>;
}

/** Keep the decision for the next page load (nothing is stored when comment media is shown). */
export function writeMirror(hide: boolean, subs: ReadonlyMap<string, SubAction>): void {
  try {
    if (!hide && !subs.size) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ h: hide, s: [...subs] } satisfies Mirror));
  } catch {
    /* storage blocked: the stylesheet then comes a moment later, from the module */
  }
}

function readMirror(): Mirror | null {
  try {
    const raw = localStorage.getItem(KEY);
    const m = raw ? (JSON.parse(raw) as Mirror) : null;
    return m && typeof m.h === 'boolean' && Array.isArray(m.s) ? m : null;
  } catch {
    return null;
  }
}

/** document_start: hide comment media at once, if the last decision was to hide it here. */
export function applyEarlyCommentMedia(url: string): void {
  const m = readMirror();
  if (!m) return;
  const subs = new Map(m.s.filter((r) => Array.isArray(r) && r.length === 2));
  if (!commentMediaHidden(m.h, subs, classify(url).subreddit)) return;
  const style = document.createElement('style');
  style.id = EARLY_STYLE_ID;
  style.textContent = commentMediaCss(true);
  (document.head ?? document.documentElement).appendChild(style);
}

export function clearEarlyCommentMedia(): void {
  document.getElementById(EARLY_STYLE_ID)?.remove();
}
