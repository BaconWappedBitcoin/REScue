/**
 * The single helper for REScue's clickable words. `cls` is the control's own class (tests, users
 * and the decoration de-duplicator find it by that); the shared look comes from `.rescue-btn`
 * (buttonStyle.ts). Keep the label a word, not an icon, and the hover text a `hint.*` string.
 */
import { h } from './dom';

export const BTN_CLASS = 'rescue-btn';
export const LABEL_CLASS = 'rescue-label';

/** A button chip. `title` is the hover text ("REScue: ..."), `text` the visible word(s). */
export function rescueButton(cls: string, text: string, title: string): HTMLButtonElement {
  return h('button', { type: 'button', class: `${cls} ${BTN_CLASS}`, title }, text);
}

/** A link styled as the same chip (for controls that really navigate, e.g. the x-post link). */
export function rescueLink(
  cls: string,
  text: string,
  href: string,
  title: string,
): HTMLAnchorElement {
  return h('a', { class: `${cls} ${BTN_CLASS}`, href, title }, text);
}

/** Mark an existing element as a button chip (adds the shared class, keeps its own). */
export function asButton<T extends Element>(el: T): T {
  el.classList.add(BTN_CLASS);
  return el;
}

/** Mark an existing element as an information label (not clickable). */
export function asLabel<T extends Element>(el: T): T {
  el.classList.add(LABEL_CLASS);
  return el;
}
