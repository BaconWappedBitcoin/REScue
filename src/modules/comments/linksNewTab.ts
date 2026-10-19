/**
 * linksNewTab (betteReddit commentsLinksNewTabs): links inside comment and post bodies open in a
 * new tab. Off by default, so Reddit's own behaviour is unchanged. Sets target=_blank and
 * rel="noopener noreferrer" on the links in each item's OWN body (light DOM: `[slot=comment]` and
 * `[slot=text-body]`), skipping in-page and non-web links; turning it off puts back what it changed.
 * Ideas from RES lib/modules/betteReddit.js (GPL-3.0, the RES contributors, commit 4defffc).
 */
import { defineModule } from '../../core/types';
import { ownBody } from '../../model/access';

export const MARK = 'data-rescue-newtab';

function isWebLink(a: HTMLAnchorElement): boolean {
  const href = a.getAttribute('href') ?? '';
  if (!href || href.startsWith('#')) return false;
  try {
    const u = new URL(href, location.href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Open the web links in the item's own body in a new tab. */
export function openLinksInNewTab(source: Element): void {
  const body = ownBody(source);
  if (!body) return;
  for (const a of body.querySelectorAll('a[href]')) {
    if (!(a instanceof HTMLAnchorElement) || a.hasAttribute(MARK) || !isWebLink(a)) continue;
    a.setAttribute(MARK, a.getAttribute('target') ?? '');
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
}

function restore(): void {
  for (const a of document.querySelectorAll(`a[${MARK}]`)) {
    const before = a.getAttribute(MARK);
    if (before) a.setAttribute('target', before);
    else a.removeAttribute('target');
    a.removeAttribute('rel');
    a.removeAttribute(MARK);
  }
}

export const linksNewTab = defineModule({
  id: 'linksNewTab',
  category: 'comments',
  title: 'Links in comments open in a new tab',
  description:
    'Links inside comments and post text open in a new tab, so you keep your place in the thread. Links to other parts of the same page are left alone. Off by default.',
  enabledByDefault: false,
  options: {},

  onItems(batch) {
    for (const c of batch.comments) openLinksInNewTab(c.source);
    for (const p of batch.posts) openLinksInNewTab(p.source);
  },

  dispose() {
    restore();
  },
});
