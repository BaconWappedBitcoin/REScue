/**
 * The shortcut bar's "mail ▾" and "feeds ▾" words (RES messageMenu and multiredditNavbar). RES
 * hung these dropdowns on old Reddit's header; modern Reddit's header is not reachable as a
 * contract, so REScue puts them in its own bar. Ported in spirit from RES
 * lib/modules/messageMenu.js and lib/modules/multiredditNavbar.js (GPL-3.0, the RES contributors,
 * commit 4defffc); the code is new.
 *
 * Hovering a word opens its menu after the hover delay, a click or Enter/Space opens it at once,
 * Escape closes it, and it closes 200 ms after the pointer leaves (RES fadeDelay). The feeds menu
 * reads your custom feeds from Reddit (read-only) the first time it is opened, never on page load;
 * hovering a feed, or pressing → on it, lists its section links (hot, new, top…).
 */
import { h } from '../../core/dom';
import type { FeedsResult, MultiFeed } from '../../core/redditJson';
import { placeAbove } from './shortcutControls';

/** How long a menu stays after the pointer leaves it (RES fadeDelay). */
export const FADE_DELAY = 200;

export interface MailLink {
  text: string;
  url: string;
}
export interface SectionLink {
  text: string;
  path: string;
}

/** RES's mail links, as same-origin paths on modern Reddit (each verified live 2026-10-21). */
export const DEFAULT_MAIL_LINKS: MailLink[] = [
  { text: 'compose', url: '/message/compose/' },
  { text: 'all', url: '/message/inbox/' },
  { text: 'unread', url: '/message/unread/' },
  { text: 'messages', url: '/message/messages/' },
  { text: 'comment replies', url: '/message/comments/' },
  { text: 'post replies', url: '/message/selfreply/' },
  { text: 'username mentions', url: '/message/mentions/' },
  { text: 'sent', url: '/message/sent/' },
  { text: 'modmail', url: 'https://mod.reddit.com/mail/all' },
];

/** RES's section links, appended to a feed's path. */
export const DEFAULT_SECTION_LINKS: SectionLink[] = [
  { text: 'hot', path: '' },
  { text: 'new', path: 'new/' },
  { text: 'rising', path: 'rising/' },
  { text: 'controversial', path: 'controversial/' },
  { text: 'top', path: 'top/' },
];

/** A mail link's address if it is a same-origin path or on https://mod.reddit.com, else null. */
export function mailHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (/^\/(?![/\\])[^\s\\]*$/.test(url)) return url;
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && u.hostname === 'mod.reddit.com' && !u.username && !u.port) {
      return u.href;
    }
  } catch {
    // not an address at all
  }
  return null;
}

// Each segment must end in "/" except the last, so the pattern never backtracks (an earlier
// `(?:[…]+\/?)*` took seconds on a 30-character row: security scan 2026-10-21).
const SECTION = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*(?:\?[A-Za-z0-9_=&-]*)?$/;
const MAX_SECTION = 64;

/** A section path to append to a feed's path (`new/`, `top/?t=week`), or null when unsafe. */
export function sectionPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const p = raw.trim().replace(/^\/+/, '');
  return p.length <= MAX_SECTION && SECTION.test(p) ? p : null;
}

export interface MenuHost {
  signedIn: boolean;
  mail?: { links: MailLink[]; hoverDelay: number };
  feeds?: {
    sections: SectionLink[];
    hoverDelay: number;
    /** Reads the custom feeds; null when Reddit could not be read. */
    load: () => Promise<FeedsResult | null>;
  };
}

interface Open {
  word: HTMLButtonElement;
  menu: HTMLElement;
  sub?: HTMLElement;
}
let open: Open | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let feedsLoad: Promise<FeedsResult | null> | null = null;

/** Close whichever bar menu is open. */
export function closeMenus(): void {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (!open) return;
  open.menu.hidden = true;
  if (open.sub) open.sub.hidden = true;
  open.word.setAttribute('aria-expanded', 'false');
  open = null;
}

/** Close the menus and forget the custom feeds read so far (the module was turned off). */
export function forgetMenus(): void {
  closeMenus();
  feedsLoad = null;
}

function show(word: HTMLButtonElement, menu: HTMLElement, sub?: HTMLElement): void {
  if (open?.menu === menu) return;
  closeMenus();
  placeAbove(menu, word);
  word.setAttribute('aria-expanded', 'true');
  open = { word, menu, sub };
}

const menuItem = (text: string, href: string): HTMLAnchorElement =>
  h('a', { href, role: 'menuitem' }, text);

/**
 * One word with its dropdown: hover opens it after `delay`, a click or Enter/Space at once (and
 * moves the focus into it), Escape closes it, and leaving it closes it after FADE_DELAY.
 */
function menuWord(
  o: { text: string; title: string; key: string; delay: number; sub?: HTMLElement },
  fill: (menu: HTMLElement) => void,
): HTMLElement {
  const word = h(
    'button',
    {
      type: 'button',
      title: o.title,
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      [`data-rescue-${o.key}`]: '',
    },
    `${o.text} ▾`,
  ) as HTMLButtonElement;
  const menu = h('div', {
    class: 'rescue-sc-menu',
    role: 'menu',
    hidden: true,
    'aria-label': o.text,
    [`data-rescue-${o.key}-menu`]: '',
  });
  const wrap = h('span', { class: 'rescue-bm' }, word, menu, o.sub ?? null);
  const openNow = (focus: boolean) => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (open?.menu !== menu) {
      fill(menu);
      show(word, menu, o.sub);
    }
    if (!focus) return;
    const first = menu.querySelector<HTMLElement>('a');
    // The feeds arrive later: remember to move the focus in once they are there.
    if (first) first.focus();
    else menu.dataset.rescueFocusFirst = '';
  };
  const isOpen = () => open?.menu === menu;
  word.addEventListener('click', () => (isOpen() ? closeMenus() : openNow(false)));
  word.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openNow(true);
  });
  wrap.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenus();
      word.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Up and down move through the open menu's links (the feed sections list has its own).
      const items = [...menu.querySelectorAll<HTMLElement>('a[role="menuitem"]')];
      if (!items.length || (o.sub && o.sub.contains(e.target as Node))) return;
      e.preventDefault();
      const at = items.indexOf(e.target as HTMLElement);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    }
  });
  wrap.addEventListener('mouseenter', () => {
    clearTimeout(hideTimer);
    if (isOpen()) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => openNow(false), o.delay);
  });
  wrap.addEventListener('mouseleave', () => {
    clearTimeout(showTimer);
    if (!isOpen()) return;
    hideTimer = setTimeout(closeMenus, FADE_DELAY);
  });
  wrap.addEventListener('focusout', (e) => {
    const to = (e as FocusEvent).relatedTarget;
    if (isOpen() && !(to instanceof Node && wrap.contains(to))) closeMenus();
  });
  return wrap;
}

function mailWord(mail: NonNullable<MenuHost['mail']>): HTMLElement {
  const links = mail.links.flatMap((l) => {
    const href = mailHref(l.url);
    const text = typeof l.text === 'string' ? l.text.trim() : '';
    return href && text ? [{ text, href }] : [];
  });
  return menuWord(
    { text: 'mail', title: 'Your Reddit mail pages', key: 'mail', delay: mail.hoverDelay },
    (menu) => menu.replaceChildren(...links.map((l) => menuItem(l.text, l.href))),
  );
}

/** Put a feed's section list beside the feed's row. */
function placeBeside(sub: HTMLElement, row: HTMLElement): void {
  sub.hidden = false;
  const r = row.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const left = Math.min(r.right + 2, vw - sub.offsetWidth - 8);
  sub.style.left = `${Math.max(0, Math.round(left))}px`;
  // Bottom-aligned with the feed's row, or top-aligned when that would run off the top of the page.
  if (sub.offsetHeight > r.bottom) {
    sub.style.bottom = '';
    sub.style.top = `${Math.round(r.top)}px`;
  } else {
    sub.style.top = '';
    sub.style.bottom = `${Math.round(window.innerHeight - r.bottom)}px`;
  }
}

function feedsWord(feeds: NonNullable<MenuHost['feeds']>): HTMLElement {
  const sub = h('div', {
    class: 'rescue-sc-menu',
    role: 'menu',
    hidden: true,
    'data-rescue-feed-sections': '',
  });
  const sections = feeds.sections.flatMap((s) => {
    const path = sectionPath(s.path);
    const text = typeof s.text === 'string' ? s.text.trim() : '';
    return path !== null && text ? [{ text, path }] : [];
  });
  let subFor: string | null = null;
  let subRow: HTMLElement | null = null;
  const showSections = (feed: MultiFeed, row: HTMLElement, focus: boolean) => {
    subRow = row;
    if (subFor !== feed.path) {
      subFor = feed.path;
      sub.replaceChildren(...sections.map((s) => menuItem(s.text, feed.path + s.path)));
      sub.setAttribute('aria-label', feed.name);
    }
    placeBeside(sub, row);
    if (focus) sub.querySelector<HTMLElement>('a')?.focus();
  };
  const row = (feed: MultiFeed): HTMLElement => {
    const a = menuItem(feed.name, feed.path);
    a.setAttribute('aria-haspopup', 'menu');
    a.addEventListener('mouseenter', () => showSections(feed, a, false));
    a.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight') return;
      e.preventDefault();
      showSections(feed, a, true);
    });
    return a;
  };
  sub.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft') return;
    e.preventDefault();
    sub.hidden = true;
    subRow?.focus();
  });
  const say = (menu: HTMLElement, text: string) =>
    menu.replaceChildren(h('span', { class: 'rescue-bm-note', role: 'none' }, text));
  return menuWord(
    {
      text: 'feeds',
      title: 'Your custom feeds, each with its hot, new and top pages',
      key: 'feeds',
      delay: feeds.hoverDelay,
      sub,
    },
    (menu) => {
      sub.hidden = true;
      say(menu, 'Loading your custom feeds…');
      const loading = (feedsLoad ??= feeds.load());
      void loading.then((res) => {
        if (!res) feedsLoad = null; // try again next time it is opened
        if (open?.menu !== menu) return;
        if (!res) return say(menu, 'Could not load your custom feeds.');
        if (!res.feeds.length) return say(menu, 'You have no custom feeds.');
        menu.replaceChildren(...res.feeds.map(row));
        placeAbove(menu, open.word);
        if ('rescueFocusFirst' in menu.dataset) {
          delete menu.dataset.rescueFocusFirst;
          menu.querySelector<HTMLElement>('a')?.focus();
        }
      });
    },
  );
}

/** The menu words to put in the bar (none when signed out). */
export function menuWords(host: MenuHost | undefined): HTMLElement[] {
  if (!host?.signedIn) return [];
  const out: HTMLElement[] = [];
  if (host.mail) out.push(mailWord(host.mail));
  if (host.feeds) out.push(feedsWord(host.feeds));
  return out;
}
