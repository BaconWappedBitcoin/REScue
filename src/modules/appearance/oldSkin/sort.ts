/**
 * Old Reddit look: the sort tabs "best hot new rising controversial top" of a listing, drawn where
 * Reddit's own "Best ▾" dropdown is. The tabs are plain links; the dropdown is only hidden by the
 * stylesheet (while `data-rescue-tabs` is on it), and its own list of sorts and links is read to
 * build the tabs, so the links are Reddit's. A listing without such a dropdown gets no tabs.
 */
import { C } from '../../../contracts/reddit';
import { h } from '../../../core/dom';
import type { Route } from '../../../core/types';
import {
  feedTabs,
  SORT_ORDER,
  sortTabs,
  type FeedKey,
  type NativeSort,
  type SortTab,
} from '../../../model/oldSkinText';
import { setAttr } from './shared';

export const TABS_ATTR = C.skin.tabsAttr;

/** The feed tabs the user turned on (options tabPopular, tabNews). */
let shownFeeds: ReadonlySet<FeedKey> = new Set();
export function setFeedTabs(shown: ReadonlySet<FeedKey>): void {
  shownFeeds = shown;
}

const tabLink = (t: SortTab, extra = ''): HTMLElement =>
  h('a', { href: t.href, class: `rescue-otab${extra}${t.active ? ' rescue-oon' : ''}` }, t.label);

/** Whether the skin shows sort tabs on this kind of page. */
export const tabsApply = (route: Route): boolean =>
  route.kind === 'front' ||
  route.kind === 'subreddit' ||
  route.kind === 'all' ||
  route.kind === 'popular' ||
  route.kind === 'customFeed';

/** The sorts Reddit's own dropdown lists, with the link each one goes to. */
export function readNativeSorts(dropdown: Element): NativeSort[] {
  const out: NativeSort[] = [];
  for (const d of dropdown.querySelectorAll('data[value]')) {
    const key = d.getAttribute('value')?.toLowerCase();
    const href = d.querySelector('a[href]')?.getAttribute('href');
    if (key && href) out.push({ key, href, selected: !!d.querySelector('[rpl-selected]') });
  }
  return out;
}

export class SortTabs {
  private nav: HTMLElement | null = null;
  private signature = '';

  /** Mount (or refresh) the tabs for the page as it is now; takes them away where they do not apply. */
  sync(route: Route, doc: Document = document): void {
    const dropdown = tabsApply(route)
      ? doc.querySelector<HTMLElement>(`${C.main} ${C.skin.feedSort}`)
      : null;
    const feeds = feedTabs(route, shownFeeds);
    // A feed page without Reddit's sort dropdown (news) still gets its feed tabs, at the top.
    const anchor =
      dropdown ?? (feeds.length ? doc.querySelector<HTMLElement>(C.main)?.firstElementChild : null);
    if (!anchor) {
      this.clear(doc);
      return;
    }
    const tabs = dropdown ? sortTabs(route, readNativeSorts(dropdown)) : [];
    if (!tabs.length && !feeds.length) {
      this.clear(doc);
      return;
    }
    // Reddit's News feed has no sorts: the sort words stay in place, greyed, so the row keeps its shape.
    const unsorted = !dropdown && feeds.length ? SORT_ORDER : [];
    const sig = JSON.stringify([feeds, tabs, unsorted]);
    if (!this.nav || this.signature !== sig) {
      const next = h(
        'nav',
        { class: 'rescue-otabs', 'aria-label': 'sort' },
        ...feeds.map((t) => tabLink(t, ' rescue-ofeed')),
        ...(feeds.length && (tabs.length || unsorted.length)
          ? [h('span', { class: 'rescue-otabgap' })]
          : []),
        ...tabs.map((t) => tabLink(t)),
        ...unsorted.map((k) =>
          h(
            'span',
            { class: 'rescue-otab rescue-ooff', title: 'Reddit’s News feed has no sorts' },
            k,
          ),
        ),
      );
      this.nav?.remove();
      this.nav = next;
      this.signature = sig;
    }
    if (this.nav.nextElementSibling !== anchor) anchor.before(this.nav);
    if (dropdown) setAttr(dropdown, TABS_ATTR, '1');
  }

  /** Remove the tabs and give Reddit's own dropdown back. */
  /** REScue's tabs were drawn and has since been taken out of the page (Reddit re-rendered there). */
  gone(): boolean {
    return !!this.nav && !this.nav.isConnected;
  }

  clear(doc: Document = document): void {
    this.nav?.remove();
    this.nav = null;
    this.signature = '';
    for (const d of doc.querySelectorAll(`[${TABS_ATTR}]`)) d.removeAttribute(TABS_ATTR);
  }
}
