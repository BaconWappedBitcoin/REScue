/**
 * The shortcut bar itself: a small fixed REScue element in the bottom-left corner that you edit in
 * place. Hover (or right-click) a link to edit it, "+" adds one, drag links to reorder them or onto
 * the delete zone (Alt+Left/Right moves the focused link), "sort" reorders by name or date, arrows
 * scroll a long bar, and a group link (`a+b`) lists its subreddits on hover. Every change is handed
 * to `save`, which writes the `subreddits` table option; the bar redraws when the settings return.
 * Ported in spirit from RES lib/modules/subredditManager.js (GPL-3.0, the RES contributors,
 * commit 4defffc); the code is new. All text is placed with the DOM builder, never as markup.
 */
import { h } from '../../core/dom';
import { hint, label } from '../../core/hints';
import type { Route } from '../../core/types';
import { closeMine, openMine, type MineHost } from './shortcutMine';
import { closePopup, openPopup } from './shortcutPopup';
import {
  addRow,
  deleteRow,
  hasSubreddit,
  moveRow,
  removeSubreddit,
  shortcutHref,
  shortcutItems,
  SORT_MODES,
  sortRows,
  staticLinks,
  updateRow,
  type RawRow,
  type ShortcutItem,
  type StaticLinkOptions,
  type Visits,
} from './shortcutModel';
import { BAR_ID } from './shortcutStyle';

export interface BarCtx {
  options: StaticLinkOptions & {
    subreddits: RawRow[];
    showAddCurrent: boolean;
    showMySubreddits?: boolean;
    shortcutDropdownDelay?: number;
    shortcutEditDropdownDelay?: number;
    allowLowercase?: boolean;
    storeSubredditVisit?: boolean;
  };
  /** When each subreddit was last opened (for the "Last visited" sort). */
  visits?: Visits;
  route: Route;
  session: { signedIn: boolean; username: string | null };
}

export type SaveRows = (rows: RawRow[]) => Promise<void>;

let live: { ctx: BarCtx; save: SaveRows } | null = null;
let dragFrom: number | null = null;
let pendingFocus: number | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let observer: ResizeObserver | null = null;
let closeSortMenu: (() => void) | null = null;

const rows = (): RawRow[] => live?.ctx.options.subreddits ?? [];

/** Hand new rows to the settings; the redraw comes back through the module's onSettings. */
function commit(next: RawRow[], focus: number | null = null): void {
  if (!live) return;
  pendingFocus = focus;
  live.save(next).catch(() => {
    pendingFocus = null;
  });
}

function link(text: string, href: string, title: string): HTMLAnchorElement {
  const a = h('a', { href, title }, text);
  const here = location.pathname.replace(/\/+$/, '') || '/';
  if (href.replace(/\/+$/, '') === here || (href === '/' && here === '/'))
    a.setAttribute('aria-current', 'page');
  return a;
}

/** The message to show when `target` already has a shortcut (other than the row being edited). */
function duplicate(target: string, ignore: number): string | null {
  const href = shortcutHref(target)?.toLowerCase();
  const clash = shortcutItems(rows()).some(
    (i) => i.index !== ignore && i.href.toLowerCase() === href,
  );
  return clash ? 'That shortcut is already in the bar.' : null;
}

function openAdd(from: HTMLElement): void {
  openPopup({
    heading: 'Add shortcut',
    target: '',
    label: '',
    returnFocus: from,
    onSave: (t, l) => {
      const problem = duplicate(t, -1);
      if (problem) return problem;
      commit(addRow(rows(), t, l, Date.now()), rows().length);
      return null;
    },
  });
}

function openEdit(item: ShortcutItem, from: HTMLElement): void {
  openPopup({
    heading: 'Edit shortcut',
    target: item.target,
    label: item.label,
    returnFocus: from,
    onSave: (t, l) => {
      const problem = duplicate(t, item.index);
      if (problem) return problem;
      commit(updateRow(rows(), item.index, t, l), item.index);
      return null;
    },
    onDelete: () => commit(deleteRow(rows(), item.index)),
  });
}

/** Put a fixed-position menu just above its anchor (it must not be clipped by the scrolling list). */
function placeAbove(menu: HTMLElement, anchor: HTMLElement): void {
  menu.hidden = false; // it has to be laid out to be measured
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const left = Math.min(r.left, vw - menu.offsetWidth - 8);
  menu.style.left = `${Math.max(0, Math.round(left))}px`;
  menu.style.bottom = `${Math.round(window.innerHeight - r.top + 2)}px`;
}

function hideGroupMenu(menu: HTMLElement): void {
  clearTimeout(hideTimer);
  clearTimeout(showTimer);
  menu.hidden = true;
}

function showGroupMenu(menu: HTMLElement, item: ShortcutItem, anchor: HTMLElement): void {
  clearTimeout(hideTimer);
  menu.replaceChildren(
    ...(item.members ?? []).map((m) =>
      h('a', { href: `/r/${m}/`, role: 'menuitem', title: hint.shortcutGroupLink(m) }, `r/${m}`),
    ),
  );
  placeAbove(menu, anchor);
  menu.hidden = false;
}

function moveByKey(items: ShortcutItem[], item: ShortcutItem, dir: -1 | 1): void {
  const neighbour = items[items.findIndex((i) => i.index === item.index) + dir];
  if (neighbour) commit(moveRow(rows(), item.index, neighbour.index), neighbour.index);
}

interface Parts {
  items: ShortcutItem[];
  trash: HTMLElement;
  groupMenu: HTMLElement;
}

function itemNode(item: ShortcutItem, parts: Parts): HTMLElement {
  const a = link(item.text, item.href, hint.shortcutLink(item.text));
  a.setAttribute('draggable', 'false'); // the wrapper is what is dragged, not the link
  const edit = h(
    'button',
    {
      type: 'button',
      class: 'rescue-sc-edit',
      'aria-label': `Edit shortcut ${item.text}`,
      title: hint.shortcutEdit,
    },
    label.edit,
  );
  const wrap = h(
    'span',
    {
      class: item.members ? 'rescue-sc rescue-sc-group' : 'rescue-sc',
      draggable: 'true',
      'data-index': item.index,
    },
    a,
    edit,
  );
  edit.addEventListener('click', () => openEdit(item, edit));
  wrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openEdit(item, a);
  });
  a.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      moveByKey(parts.items, item, e.key === 'ArrowLeft' ? -1 : 1);
    }
  });

  wrap.addEventListener('dragstart', (e) => {
    dragFrom = item.index;
    e.dataTransfer?.setData('text/plain', item.href);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    wrap.classList.add('rescue-sc-dragging');
    parts.trash.hidden = false;
  });
  wrap.addEventListener('dragend', () => {
    dragFrom = null;
    wrap.classList.remove('rescue-sc-dragging');
    parts.trash.hidden = true;
  });
  wrap.addEventListener('dragover', (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    wrap.classList.add('rescue-sc-over');
  });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('rescue-sc-over'));
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    wrap.classList.remove('rescue-sc-over');
    if (dragFrom !== null && dragFrom !== item.index) {
      commit(moveRow(rows(), dragFrom, item.index), item.index);
    }
    dragFrom = null;
  });

  if (item.members) {
    const { groupMenu } = parts;
    const show = () => showGroupMenu(groupMenu, item, wrap);
    // Hovering waits for the dropdown delay (RES shortcutDropdownDelay); the keyboard does not.
    const delayed = () => {
      clearTimeout(showTimer);
      showTimer = setTimeout(show, live?.ctx.options.shortcutDropdownDelay ?? 0);
    };
    const later = () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => hideGroupMenu(groupMenu), 200);
    };
    wrap.addEventListener('mouseenter', delayed);
    wrap.addEventListener('focusin', show);
    wrap.addEventListener('mouseleave', later);
    wrap.addEventListener('focusout', later);
  }
  return wrap;
}

function trashZone(): HTMLElement {
  const trash = h(
    'div',
    { class: 'rescue-sc-trash', hidden: true, 'data-rescue-trash': '', title: hint.shortcutTrash },
    'Drop here to delete',
  );
  trash.addEventListener('dragover', (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    trash.classList.add('rescue-sc-over');
  });
  trash.addEventListener('dragleave', () => trash.classList.remove('rescue-sc-over'));
  trash.addEventListener('drop', (e) => {
    e.preventDefault();
    trash.classList.remove('rescue-sc-over');
    trash.hidden = true;
    if (dragFrom !== null) commit(deleteRow(rows(), dragFrom));
    dragFrom = null;
  });
  return trash;
}

function sortControl(): { button: HTMLElement; menu: HTMLElement } {
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
    ...SORT_MODES.filter(
      (m) => m.mode !== 'visitDesc' || live?.ctx.options.storeSubredditVisit !== false,
    ).map(({ mode, label }) => {
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
        commit(sortRows(rows(), mode, live?.ctx.visits));
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

function toggleButton(sub: string): HTMLElement {
  const present = hasSubreddit(rows(), sub);
  const b = h(
    'button',
    {
      type: 'button',
      'data-rescue-toggle': present ? 'remove' : 'add',
      title: hint.shortcutToggle(sub, present),
    },
    present ? '−shortcut' : '+shortcut',
  );
  b.addEventListener('click', () =>
    commit(present ? removeSubreddit(rows(), sub) : addRow(rows(), `r/${sub}`, '', Date.now())),
  );
  return b;
}

function updateArrows(bar: HTMLElement): void {
  const vp = bar.querySelector<HTMLElement>('.rescue-sc-viewport');
  const left = bar.querySelector<HTMLElement>('[data-dir="left"]');
  const right = bar.querySelector<HTMLElement>('[data-dir="right"]');
  if (!vp || !left || !right) return;
  left.hidden = vp.scrollLeft <= 1;
  right.hidden = vp.scrollLeft + vp.clientWidth >= vp.scrollWidth - 1;
}

function arrow(dir: 'left' | 'right', viewport: HTMLElement): HTMLElement {
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

/**
 * The "my subreddits" word: lists your subscriptions (read from Reddit on demand) so you can open
 * them or add them to the bar. Signed out it is shown disabled with a sign-in hint.
 */
function mineControl(mine: MineHost | undefined): HTMLElement | null {
  if (!mine) return null;
  const b = h(
    'button',
    {
      type: 'button',
      title: mine.signedIn ? hint.mineButton : hint.mineSignedOut,
      'aria-label': 'My subreddits',
      'aria-haspopup': 'dialog',
      'data-rescue-mine': '',
      disabled: !mine.signedIn,
    },
    label.mySubs,
  );
  b.addEventListener('click', () => {
    if (!live) return;
    const cur = live;
    openMine({ host: mine, rows, save: (next) => cur.save(next) }, b);
  });
  return b;
}

export function renderBar(ctx: BarCtx, save: SaveRows, mine?: MineHost): void {
  live = { ctx, save };
  closeSortMenu?.();
  const items = shortcutItems(ctx.options.subreddits);
  const statics = staticLinks(ctx.options, ctx.session);
  const sub = ctx.route.kind === 'subreddit' ? ctx.route.subreddit : undefined;

  const trash = trashZone();
  const groupMenu = h('div', { class: 'rescue-sc-menu', role: 'menu', hidden: true });
  groupMenu.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  groupMenu.addEventListener('mouseleave', () => hideGroupMenu(groupMenu));
  const parts: Parts = { items, trash, groupMenu };

  const viewport = h('div', { class: 'rescue-sc-viewport' });
  viewport.append(...statics.map((s) => link(s.text, s.href, hint.shortcutStatic(s.text))));
  if (statics.length && items.length) {
    viewport.append(h('span', { class: 'rescue-bar-sep', title: hint.shortcutSeparator }, '|'));
  }
  viewport.append(...items.map((i) => itemNode(i, parts)));

  const add = h(
    'button',
    {
      type: 'button',
      title: hint.shortcutAdd,
      'aria-label': 'Add a shortcut',
      'data-rescue-new': '',
    },
    label.add,
  );
  add.addEventListener('click', () => openAdd(add));
  const sort = sortControl();
  const toggle = ctx.options.showAddCurrent && sub ? toggleButton(sub) : null;

  const bar =
    document.getElementById(BAR_ID) ??
    h('nav', { id: BAR_ID, class: 'rescue-overlay', 'aria-label': 'Subreddit shortcuts' });
  const kids: Array<Node | null> = [
    arrow('left', viewport),
    viewport,
    arrow('right', viewport),
    toggle,
    add,
    mineControl(mine),
    sort.button,
    sort.menu,
    groupMenu,
    trash,
  ];
  bar.replaceChildren(...kids.filter((k): k is Node => k !== null));
  bar.style.setProperty(
    '--rescue-sc-edit-delay',
    `${ctx.options.shortcutEditDropdownDelay ?? 0}ms`,
  );
  bar.toggleAttribute('data-rescue-uppercase', ctx.options.allowLowercase === false);
  if (!bar.isConnected) (document.body ?? document.documentElement).appendChild(bar);

  viewport.addEventListener('scroll', () => updateArrows(bar));
  observer?.disconnect();
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => updateArrows(bar));
    observer.observe(viewport);
  }
  updateArrows(bar);

  if (pendingFocus !== null) {
    bar.querySelector<HTMLElement>(`.rescue-sc[data-index="${pendingFocus}"] a`)?.focus();
    pendingFocus = null;
  }
}

export function removeBar(): void {
  closeMine();
  closeSortMenu?.();
  closePopup();
  clearTimeout(hideTimer);
  clearTimeout(showTimer);
  observer?.disconnect();
  observer = null;
  document.getElementById(BAR_ID)?.remove();
  live = null;
  dragFrom = null;
  pendingFocus = null;
}
