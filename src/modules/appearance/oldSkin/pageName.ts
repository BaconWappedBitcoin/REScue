/**
 * Old Reddit look: the page name beside the logo in the header ("popular", "all", a subreddit's
 * name), in old Reddit's small capitals. REScue's own element, put after Reddit's logo link; Reddit's
 * header is otherwise left as it is. The front page and other pages get none, as on old Reddit.
 */
import { C } from '../../../contracts/reddit';
import { h } from '../../../core/dom';
import type { Route } from '../../../core/types';
import { setText } from './shared';

/** The name old Reddit showed beside its logo on this kind of page, or null for none. */
export function pageNameOf(route: Route): string | null {
  if (route.kind === 'popular') return 'popular';
  if (route.kind === 'all') return 'all';
  if ((route.kind === 'subreddit' || route.kind === 'thread') && route.subreddit) {
    return route.subreddit;
  }
  return null;
}

export class PageName {
  private el: HTMLAnchorElement | null = null;

  sync(route: Route, doc: Document = document): void {
    const name = pageNameOf(route);
    const logo = doc.querySelector(C.skin.headerLogo);
    if (!name || !logo) {
      this.clear();
      return;
    }
    this.el ??= h('a', { class: 'rescue-opagename' });
    setText(this.el, name);
    const href = `/r/${name}/`;
    if (this.el.getAttribute('href') !== href) this.el.setAttribute('href', href);
    if (this.el.previousElementSibling !== logo) logo.after(this.el);
  }

  clear(): void {
    this.el?.remove();
    this.el = null;
  }
}
