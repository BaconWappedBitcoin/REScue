/**
 * The gear dropdown menu (RES menu). Modules add rows through `ui.addMenuItem`; the gear opens
 * the menu. Keyboard: arrows/Home/End move, Enter/Space activate, Escape or Tab closes, and a
 * click anywhere outside closes. All text is set with textContent.
 */
import { h } from '../../core/dom';
import { hint } from '../../core/hints';
import { ensureTheme } from '../../core/theme';
import type { MenuItem } from '../../core/types';

export const MENU_ID = 'rescue-menu';
const STYLE_ID = 'rescue-menu-css';

const MENU_CSS = `
#${MENU_ID} { position: fixed; z-index: 2147483646; min-width: 220px; box-sizing: border-box;
  padding: 4px; overflow: auto; background: var(--rescue-bg, #fff); color: var(--rescue-fg, #1a1a1b);
  border: 1px solid var(--rescue-border, #ccc); border-radius: 4px;
  box-shadow: 0 6px 20px rgba(0,0,0,.25); font: 13px/1.4 system-ui, sans-serif; }
#${MENU_ID} .rescue-menu-row { display: flex; align-items: center; }
#${MENU_ID} button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer;
  text-align: left; padding: 6px 8px; border-radius: 3px; }
#${MENU_ID} button:hover, #${MENU_ID} button:focus-visible { background: var(--rescue-hover, #eef4fa); outline: none; }
#${MENU_ID} button:focus-visible { box-shadow: inset 0 0 0 2px var(--rescue-accent, #336699); }
#${MENU_ID} .rescue-menu-main { flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
#${MENU_ID} .rescue-switch { flex: none; width: 28px; height: 14px; border-radius: 7px; position: relative;
  background: var(--rescue-meta, #888); }
#${MENU_ID} .rescue-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 10px;
  height: 10px; border-radius: 50%; background: var(--rescue-bg, #fff); transition: left .1s; }
#${MENU_ID} .rescue-switch[data-on] { background: var(--rescue-accent, #336699); }
#${MENU_ID} .rescue-switch[data-on]::after { left: 16px; }
`;

export interface MenuController {
  add(item: MenuItem): () => void;
  items(): MenuItem[];
  open(anchor: HTMLElement): void;
  close(): void;
  isOpen(): boolean;
}

function ensureStyle(doc: Document): void {
  ensureTheme(doc);
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = MENU_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}

export function createMenu(doc: Document = document): MenuController {
  const registered = new Map<string, MenuItem>();
  let openState: { box: HTMLElement; anchor: HTMLElement; teardown(): void } | null = null;

  const sorted = (): MenuItem[] =>
    [...registered.values()]
      .map((item, i) => ({ item, i }))
      .sort((a, b) => a.item.order - b.item.order || a.i - b.i)
      .map((e) => e.item);

  const close = (): void => {
    if (!openState) return;
    const { anchor, teardown, box } = openState;
    openState = null;
    teardown();
    box.remove();
    if (doc.activeElement === doc.body || !doc.activeElement) anchor.focus();
  };

  const row = (item: MenuItem): HTMLElement => {
    const main = h('button', {
      type: 'button',
      class: 'rescue-menu-main',
      'data-menu-id': item.id,
    });
    const label = h('span', null, item.label);
    main.append(label);
    const retitle = (): void => {
      main.title = item.hint?.() ?? hint.menuItem(item.label);
    };
    retitle();
    if (item.toggle) {
      const toggle = item.toggle;
      const sw = h('span', { class: 'rescue-switch', 'aria-hidden': 'true' });
      const paint = (): void => {
        const on = toggle.get();
        main.setAttribute('aria-checked', String(on));
        sw.toggleAttribute('data-on', on);
        retitle();
      };
      main.setAttribute('role', 'menuitemcheckbox');
      main.append(sw);
      paint();
      main.addEventListener('click', () => {
        toggle.set(!toggle.get());
        paint();
      });
    } else {
      main.setAttribute('role', 'menuitem');
      main.addEventListener('click', () => {
        close();
        item.onClick();
      });
    }
    const wrap = h('div', { class: 'rescue-menu-row', role: 'none' }, main);
    if (item.secondary) {
      const sec = item.secondary;
      const b = h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          'aria-label': sec.label,
          title: sec.hint ?? hint.menuItem(sec.label),
        },
        sec.icon,
      );
      b.addEventListener('click', () => {
        close();
        sec.onClick();
      });
      wrap.append(b);
    }
    return wrap;
  };

  const open = (anchor: HTMLElement): void => {
    if (openState?.anchor === anchor) return close();
    close();
    ensureStyle(doc);
    const box = h('div', {
      id: MENU_ID,
      class: 'rescue-overlay',
      role: 'menu',
      'aria-label': 'REScue menu',
    });
    for (const item of sorted()) if (item.visible?.() !== false) box.append(row(item));
    const r = anchor.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;
    box.style.right = `${Math.max(8, vw - r.right)}px`;
    if (r.top < vh / 2) {
      // An anchor in the top half (the header button) opens the menu downward.
      box.style.top = `${r.bottom + 4}px`;
      box.style.maxHeight = `${Math.max(120, vh - r.bottom - 12)}px`;
    } else {
      // The corner tool strip is at the bottom, so its gear opens the menu upward.
      box.style.bottom = `${Math.max(8, vh - r.top + 4)}px`;
      box.style.maxHeight = `${Math.max(120, r.top - 12)}px`;
    }
    (doc.body ?? doc.documentElement).appendChild(box);

    const buttons = (): HTMLElement[] => [...box.querySelectorAll<HTMLElement>('button')];
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === 'Tab') return close();
      const list = buttons();
      const at = list.indexOf(doc.activeElement as HTMLElement);
      let next: number;
      if (e.key === 'ArrowDown') next = (at + 1) % list.length;
      else if (e.key === 'ArrowUp') next = (at <= 0 ? list.length : at) - 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = list.length - 1;
      else return;
      e.preventDefault();
      list[next]?.focus();
    };
    const onOutside = (e: Event): void => {
      const path = e.composedPath();
      if (path.includes(box) || path.includes(anchor)) return;
      close();
    };
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('click', onOutside, true);
    openState = {
      box,
      anchor,
      teardown() {
        doc.removeEventListener('keydown', onKey, true);
        doc.removeEventListener('click', onOutside, true);
      },
    };
    buttons()[0]?.focus();
  };

  return {
    add(item) {
      registered.set(item.id, item);
      return () => {
        if (registered.get(item.id) === item) registered.delete(item.id);
      };
    },
    items: sorted,
    open,
    close,
    isOpen: () => openState !== null,
  };
}
