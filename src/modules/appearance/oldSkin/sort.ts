/**
 * Old Reddit look: the sort tabs "best hot new rising controversial top" of a listing, drawn where
 * Reddit's own "Best ▾" dropdown is. The tabs are plain links; the dropdown is only hidden by the
 * stylesheet (while `data-rescue-tabs` is on it), and its own list of sorts and links is read to
 * build the tabs, so the links are Reddit's. A listing without such a dropdown gets no tabs.
 */
import { C } from '../../../contracts/reddit';
import { h } from '../../../core/dom';
import type { Route } from '../../../core/types';
import { sortTabs, type NativeSort } from '../../../model/oldSkinText';
import { setAttr } from './shared';

export const TABS_ATTR = C.skin.tabsAttr;

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
    if (!dropdown) {
      this.clear(doc);
      return;
    }
    const tabs = sortTabs(route, readNativeSorts(dropdown));
    if (!tabs.length) {
      this.clear(doc);
      return;
    }
    const sig = JSON.stringify(tabs);
    if (!this.nav || this.signature !== sig) {
      const next = h(
        'nav',
        { class: 'rescue-otabs', 'aria-label': 'sort' },
        ...tabs.map((t) =>
          h('a', { href: t.href, class: t.active ? 'rescue-otab rescue-oon' : 'rescue-otab' }, t.label),
        ),
      );
      this.nav?.remove();
      this.nav = next;
      this.signature = sig;
    }
    if (this.nav.nextElementSibling !== dropdown) dropdown.before(this.nav);
    setAttr(dropdown, TABS_ATTR, '1');
  }

  /** Remove the tabs and give Reddit's own dropdown back. */
  clear(doc: Document = document): void {
    this.nav?.remove();
    this.nav = null;
    this.signature = '';
    for (const d of doc.querySelectorAll(`[${TABS_ATTR}]`)) d.removeAttribute(TABS_ATTR);
  }
}
