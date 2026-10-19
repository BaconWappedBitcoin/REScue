/**
 * The data side of the dashboard (RES dashboard): turning the widgets you listed (and, if you like,
 * your shortcut bar) into cards of links. No DOM and no requests. RES's widgets showed the latest
 * posts of each subreddit; REScue may only read the few Reddit data addresses listed in its
 * contracts, which do not include post listings, so a card is a heading and sort links that open
 * the real page. Ideas from RES lib/modules/dashboard.js (GPL-3.0, the RES contributors, commit
 * 4defffc); the code is new.
 */
import { shortcutHref, shortcutItems, type RawRow } from './shortcutModel';

export type WidgetKind = 'subreddit' | 'user' | 'search' | 'multi';

export const WIDGET_KINDS: WidgetKind[] = ['subreddit', 'user', 'search', 'multi'];
export const POST_SORTS = ['hot', 'new', 'top', 'rising'];
export const SEARCH_SORTS = ['relevance', 'hot', 'top', 'new', 'comments'];

export interface Card {
  kind: WidgetKind;
  title: string;
  /** The page the heading opens (with the default sort). */
  href: string;
  links: Array<{ text: string; href: string }>;
}

export interface CardOptions {
  defaultSort: string;
  defaultSortSearch: string;
  includeShortcuts: boolean;
}

const USER = /^(?:u\/|user\/)?([A-Za-z0-9_-]{3,20})$/;
const SORTED = /^\/r\/[^/]+\/$/;

const sorted = (base: string, sort: string): string => `${base}${sort}/`;

function postLinks(base: string): Array<{ text: string; href: string }> {
  return POST_SORTS.map((s) => ({ text: s, href: sorted(base, s) }));
}

const searchHref = (q: string, sort: string): string =>
  `/search/?q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}`;

/** The card one widget row stands for, or null when it is blank or not usable. */
export function cardFor(row: RawRow, o: CardOptions): Card | null {
  const kind = row.kind as WidgetKind;
  const target = typeof row.target === 'string' ? row.target.trim() : '';
  const label = typeof row.label === 'string' ? row.label.trim().slice(0, 40) : '';
  if (!target || !WIDGET_KINDS.includes(kind)) return null;
  if (kind === 'search') {
    return {
      kind,
      title: label || `search: ${target}`.slice(0, 60),
      href: searchHref(target, o.defaultSortSearch),
      links: SEARCH_SORTS.map((s) => ({ text: s, href: searchHref(target, s) })),
    };
  }
  if (kind === 'user') {
    const m = USER.exec(target);
    if (!m) return null;
    const base = `/user/${m[1]}/`;
    return {
      kind,
      title: label || `u/${m[1]}`,
      href: base,
      links: ['submitted', 'comments'].map((s) => ({ text: s, href: `${base}${s}/` })),
    };
  }
  const href = shortcutHref(target);
  if (!href || (kind === 'multi' && !/^\/user\/[^/]+\/m\/[^/]+\/$/.test(href))) return null;
  const base = href;
  return {
    kind,
    title: label || href.replace(/^\/|\/$/g, '').replace(/^user\//, 'u/'),
    href: SORTED.test(base) ? sorted(base, o.defaultSort) : base,
    links: SORTED.test(base) || kind === 'multi' ? postLinks(base) : [],
  };
}

/** Cards for the widget table, then (if asked) one for each shortcut not already shown. */
export function cardsFrom(
  widgets: readonly RawRow[],
  shortcuts: readonly RawRow[],
  o: CardOptions,
): Card[] {
  const cards = widgets.map((w) => cardFor(w, o)).filter((c): c is Card => c !== null);
  if (!o.includeShortcuts) return cards;
  const seen = new Set(cards.map((c) => c.href.toLowerCase()));
  for (const item of shortcutItems(shortcuts)) {
    const card = cardFor({ kind: 'subreddit', target: item.target, label: item.label }, o);
    if (!card || seen.has(card.href.toLowerCase())) continue;
    seen.add(card.href.toLowerCase());
    cards.push(card);
  }
  return cards;
}
