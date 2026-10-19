/**
 * dashboard (RES dashboard: menuItem, defaultSort, defaultSortSearch, dashboardShortcut): a page of
 * cards, one for each subreddit, user, search or custom feed you listed, each a heading and sort
 * links that open the real page. It is a REScue panel over Reddit's page (opened from the REScue
 * menu, a "Dashboard" word in the shortcut bar, or the address `#rescue:dashboard`); it never
 * replaces anything of Reddit's. RES also showed the latest posts inside each widget. That needs
 * Reddit's listing data, which is not among the few read-only addresses REScue may use, so the
 * cards link instead (the number-of-posts option is not built). Ideas from RES
 * lib/modules/dashboard.js (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */
import { h } from '../../core/dom';
import { hint, label } from '../../core/hints';
import { defineModule, type ModuleContext } from '../../core/types';
import { cardsFrom, SEARCH_SORTS, POST_SORTS, WIDGET_KINDS, type Card } from './dashboardModel';
import type { RawRow } from './shortcutModel';

export const DASHBOARD_HASH = '#rescue:dashboard';
export const PANEL_ID = 'rescue-dashboard';
const PANEL_STYLE =
  'position:fixed;top:5vh;left:50%;transform:translateX(-50%);z-index:2147483646;box-sizing:border-box;' +
  'width:min(900px,96vw);max-height:90vh;overflow:auto;padding:10px 14px;' +
  'background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc);' +
  'border-radius:6px;box-shadow:0 8px 28px var(--rescue-shadow,rgba(0,0,0,.35));font:13px/1.5 system-ui,sans-serif';
const GRID_STYLE =
  'display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-top:8px';
const CARD_STYLE =
  'border:1px solid var(--rescue-border,#ccc);border-radius:4px;padding:6px 10px;display:flex;flex-direction:column;gap:2px';
const LINK_STYLE = 'color:var(--rescue-accent,#336699)';

let closePanel: (() => void) | null = null;

function cardNode(card: Card): HTMLElement {
  const title = h('a', { href: card.href, title: hint.dashboardCard(card.title) }, card.title);
  title.style.cssText = `${LINK_STYLE};font-weight:600;overflow-wrap:anywhere`;
  const links = h('div', null);
  links.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;font-size:12px';
  for (const l of card.links) {
    const a = h('a', { href: l.href, title: hint.dashboardSort(card.title, l.text) }, l.text);
    a.style.cssText = LINK_STYLE;
    links.append(a);
  }
  const box = h(
    'section',
    { class: 'rescue-dashboard-card', 'data-kind': card.kind },
    title,
    links,
  );
  box.style.cssText = CARD_STYLE;
  return box;
}

function openPanel(ctx: ModuleContext): void {
  closePanel?.();
  const o = ctx.options as unknown as {
    widgets: RawRow[];
    includeShortcuts: boolean;
    defaultSort: string;
    defaultSortSearch: string;
  };
  const shortcuts = ctx.settings.profile().modules.subredditManager?.options?.subreddits;
  const cards = cardsFrom(o.widgets, Array.isArray(shortcuts) ? (shortcuts as RawRow[]) : [], o);

  const close = h('button', { type: 'button', title: hint.dashboardClose }, label.close);
  close.style.cssText =
    'font:inherit;cursor:pointer;background:none;border:0;text-decoration:underline;color:inherit';
  const settings = h(
    'a',
    { href: '#rescue:settings/dashboard', title: hint.dashboardSettings },
    label.settings,
  );
  settings.style.cssText = LINK_STYLE;
  const head = h('div', null, h('strong', null, 'Dashboard'), settings, close);
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px';
  const body = cards.length
    ? h('div', { class: 'rescue-dashboard-grid' }, ...cards.map(cardNode))
    : h(
        'p',
        null,
        'Nothing to show yet. List subreddits, users, searches or custom feeds in the Dashboard settings, or turn on “Also show my shortcut bar”.',
      );
  if (cards.length) body.style.cssText = GRID_STYLE;
  const panel = h(
    'div',
    { id: PANEL_ID, class: 'rescue-overlay', role: 'dialog', 'aria-label': 'REScue dashboard' },
    head,
    body,
  );
  panel.style.cssText = PANEL_STYLE;

  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    shut();
  };
  const shut = (): void => {
    document.removeEventListener('keydown', onKey, true);
    panel.remove();
    closePanel = null;
    before?.focus();
  };
  close.addEventListener('click', shut);
  document.addEventListener('keydown', onKey, true);
  (document.body ?? document.documentElement).appendChild(panel);
  closePanel = shut;
  close.focus();
}

let teardown: Array<() => void> = [];
let removeMenu: (() => void) | null = null;

function syncMenu(ctx: ModuleContext): void {
  removeMenu?.();
  removeMenu = null;
  if (ctx.options.menuItem !== true) return;
  removeMenu = ctx.ui.addMenuItem({
    id: 'dashboard',
    label: 'Dashboard',
    order: 20,
    hint: () => hint.dashboardMenu,
    onClick: () => openPanel(ctx),
  });
}

export const dashboard = defineModule({
  id: 'dashboard',
  category: 'appearance',
  title: 'Dashboard',
  description:
    'A page of cards for the subreddits, users, searches and custom feeds you list (and, if you like, your shortcut bar), each opening the real page in your chosen sort. RES also showed the latest posts inside each card; REScue may not read post listings, so the cards are links. Opens from the REScue menu, a “Dashboard” word in the shortcut bar, or the address #rescue:dashboard.',
  enabledByDefault: false,
  options: {
    menuItem: { type: 'boolean', default: true, title: 'Put “Dashboard” in the REScue menu' },
    dashboardShortcut: {
      type: 'boolean',
      default: true,
      title: 'Put a “Dashboard” word in the shortcut bar',
      description: 'Needs the Subreddit shortcut bar to be on.',
    },
    includeShortcuts: {
      type: 'boolean',
      default: true,
      title: 'Also show a card for each link in my shortcut bar',
    },
    defaultSort: {
      type: 'enum',
      default: 'hot',
      title: 'Sort a subreddit card opens in',
      values: POST_SORTS.map((v) => ({ value: v, label: v })),
    },
    defaultSortSearch: {
      type: 'enum',
      default: 'relevance',
      title: 'Sort a search card opens in',
      values: SEARCH_SORTS.map((v) => ({ value: v, label: v })),
    },
    widgets: {
      type: 'table',
      default: [],
      title: 'Cards',
      description:
        'Kind: subreddit (askscience, or a+b), user (spez), search (any search words) or multi (u/name/m/feed). The label is optional.',
      columns: [
        { key: 'kind', title: 'Kind', type: 'enum', values: WIDGET_KINDS, default: 'subreddit' },
        { key: 'target', title: 'Name or words', type: 'text' },
        { key: 'label', title: 'Label (optional)', type: 'text' },
      ],
    },
  },

  init(ctx) {
    syncMenu(ctx);
    const fromHash = (): void => {
      if (location.hash === DASHBOARD_HASH) openPanel(ctx);
    };
    // Capture phase, so Reddit's router cannot swallow the click before it gets here.
    const onClick = (e: MouseEvent): void => {
      const path = e.composedPath();
      const panel = document.getElementById(PANEL_ID);
      // A link inside the panel leaves the page (or opens the settings): the panel is done either way.
      if (panel && path.includes(panel) && path.some((n) => n instanceof HTMLAnchorElement)) {
        closePanel?.();
        return;
      }
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const link = path.find(
        (n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement && n.hash === DASHBOARD_HASH,
      );
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      openPanel(ctx);
    };
    window.addEventListener('hashchange', fromHash);
    document.addEventListener('click', onClick, true);
    teardown = [
      () => window.removeEventListener('hashchange', fromHash),
      () => document.removeEventListener('click', onClick, true),
    ];
    fromHash();
  },
  onSettings: syncMenu,
  dispose() {
    for (const t of teardown) t();
    teardown = [];
    removeMenu?.();
    removeMenu = null;
    closePanel?.();
  },
});
