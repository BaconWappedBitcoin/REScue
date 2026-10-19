/**
 * Small REScue-owned UI pieces shared by the comment modules. Styling is inline so there is no
 * stylesheet to inject or remove, and none of it targets Reddit's own elements.
 */
import { h } from '../../core/dom';
import { rescueButton } from '../../core/buttons';

const PANEL =
  'background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc);border-radius:4px;padding:4px 8px;box-shadow:0 1px 4px var(--rescue-shadow,rgba(0,0,0,.25));font:13px/1.4 system-ui,sans-serif';

/** A REScue button chip for a comment's meta line (class lets tests and users find it). */
export function linkButton(cls: string, label: string, title: string): HTMLButtonElement {
  return rescueButton(cls, label, title);
}

/** Style a node as a small floating panel (banners, widgets in REScue's tool strip). */
export function panel(node: HTMLElement): HTMLElement {
  node.style.cssText = PANEL;
  return node;
}

/** A small pill, for markers beside an author name. */
export function pill(cls: string, text: string, title: string): HTMLElement {
  const el = h('span', { class: cls, title }, text);
  el.classList.add('rescue-label');
  el.style.cssText = 'background:var(--rescue-warn,#cc9900);color:var(--rescue-warn-fg,#000)';
  return el;
}

/** Handle a click that belongs to REScue only (never Reddit's own handlers). */
export function onClick(el: HTMLElement, fn: () => void): void {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  });
}
