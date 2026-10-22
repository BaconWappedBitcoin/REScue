/**
 * The shortcut bar's small fixed controls, split out of shortcutBar.ts: the scroll arrows, the
 * "sort" word with its menu, and the helper that puts a fixed menu above its anchor. They hold no
 * rows of their own; the bar hands them what to do. Ported in spirit from RES
 * lib/modules/subredditManager.js (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */
import { h } from '../../core/dom';
import { hint, label } from '../../core/hints';
import { SORT_MODES, type SortMode } from './shortcutModel';

let closeSortMenu: (() => void) | null = null;

/** Close the sort menu if it is open. */
export function closeSort(): void {
  closeSortMenu?.();
}

/**
 * Put a fixed-position menu just above its anchor (it must not be clipped by the scrolling list),
 * or just below it when there is not room above and there is more below: the Old Reddit look puts
 * the bar at the very top of the page, where every menu used to open off-screen (live 2026-10-21).
 */
export function placeAbove(menu: HTMLElement, anchor: HTMLElement): void {
  menu.hidden = false; // it has to be laid out to be measured
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const left = Math.min(r.left, vw - menu.offsetWidth - 8);
  menu.style.left = `${Math.max(0, Math.round(left))}px`;
  const below = window.innerHeight - r.bottom;
  if (menu.offsetHeight + 4 > r.top && below > r.top) {
    menu.style.bottom = '';
    menu.style.top = `${Math.round(r.bottom + 2)}px`;
  } else {
    menu.style.top = '';
    menu.style.bottom = `${Math.round(window.innerHeight - r.top + 2)}px`;
  }
}

/** The "sort" word and its menu; `showVisits` offers the "Last visited" sort. */
export function sortControl(o: { showVisits: boolean; onSort: (mode: SortMode) => void }): {
  button: HTMLElement;
  menu: HTMLElement;
} {
  const button = h(
    'button',
    {
      type: 'button',
      title: hint.shortcutSort,
      'aria-label': 'Sort shortcuts',
      'aria-haspopup': 'true',
      'data-rescue-sort': '',
    },
    label.sort,
  );
  const menu = h(
    'div',
    { class: 'rescue-sc-menu', role: 'menu', hidden: true, 'data-rescue-sort-menu': '' },
    ...SORT_MODES.filter((m) => m.mode !== 'visitDesc' || o.showVisits).map(({ mode, label }) => {
      const b = h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          'data-sort': mode,
          title: hint.shortcutSortMode(label),
        },
        label,
      );
      b.addEventListener('click', () => {
        closeSortMenu?.();
        o.onSort(mode);
      });
      return b;
    }),
  );
  button.addEventListener('click', () => {
    if (!menu.hidden) return closeSortMenu?.();
    placeAbove(menu, button);
    menu.hidden = false;
    const outside = (e: Event) => {
      if (!menu.contains(e.target as Node) && e.target !== button) closeSortMenu?.();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSortMenu?.();
    };
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', key, true);
    closeSortMenu = () => {
      menu.hidden = true;
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', key, true);
      closeSortMenu = null;
    };
  });
  return { button, menu };
}

/** Show each scroll arrow only while there is more of the list on its side. */
export function updateArrows(bar: HTMLElement): void {
  const vp = bar.querySelector<HTMLElement>('.rescue-sc-viewport');
  const left = bar.querySelector<HTMLElement>('[data-dir="left"]');
  const right = bar.querySelector<HTMLElement>('[data-dir="right"]');
  if (!vp || !left || !right) return;
  left.hidden = vp.scrollLeft <= 1;
  right.hidden = vp.scrollLeft + vp.clientWidth >= vp.scrollWidth - 1;
}

export function arrow(dir: 'left' | 'right', viewport: HTMLElement): HTMLElement {
  const b = h(
    'button',
    {
      type: 'button',
      class: 'rescue-sc-arrow',
      'data-dir': dir,
      'aria-label': `Scroll shortcuts ${dir}`,
      title: hint.shortcutArrow(dir),
      hidden: true,
    },
    dir === 'left' ? label.scrollBack : label.scrollMore,
  );
  b.addEventListener('click', () => {
    const step = Math.max(80, Math.round(viewport.clientWidth * 0.8));
    viewport.scrollLeft += dir === 'left' ? -step : step;
  });
  return b;
}
