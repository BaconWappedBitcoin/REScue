/**
 * The page colour behind an element, for choosing a readable text colour on a tinted vote pill
 * (userTagger's "colour vote weight"). Answers are kept per element for the theme they were read
 * under: every pill of a thread walked the same ancestors through getComputedStyle.
 */
import { THEME_ATTR } from '../../core/theme';
import { validColor } from './tagStore';

let backgrounds: { theme: string; byEl: WeakMap<Element, string | null> } | null = null;

const hex = (n: string): string => Number(n).toString(16).padStart(2, '0');

/** The first opaque background up the tree, as #rrggbb; the theme background when there is none. */
export function pageBackground(from: Element): string {
  const root = document.documentElement;
  // Reddit's light/dark switch changes the class on <html>; REScue's theme follows it.
  const theme = `${root.getAttribute(THEME_ATTR) ?? ''}|${root.className}`;
  if (backgrounds?.theme !== theme) backgrounds = { theme, byEl: new WeakMap() };
  const known = backgrounds.byEl;
  const path: Element[] = [];
  let found: string | null = null;
  for (let el: Element | null = from; el; el = el.parentElement) {
    const cached = known.get(el);
    if (cached !== undefined) {
      found = cached;
      break;
    }
    path.push(el);
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(
      getComputedStyle(el).backgroundColor,
    );
    if (m && (m[4] === undefined || Number(m[4]) >= 0.99)) {
      found = `#${hex(m[1]!)}${hex(m[2]!)}${hex(m[3]!)}`;
      break;
    }
  }
  // Every element walked has the same first opaque background (null: none up to the root).
  for (const el of path) known.set(el, found);
  if (found) return found;
  const fallback = getComputedStyle(root).getPropertyValue('--rescue-bg').trim();
  return validColor(fallback) ?? '#ffffff';
}

/** Forget the answers (tests, and a module switched off and on again). */
export function forgetBackgrounds(): void {
  backgrounds = null;
}
