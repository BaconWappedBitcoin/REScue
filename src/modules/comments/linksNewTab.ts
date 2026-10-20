/**
 * linksNewTab (betteReddit commentsLinksNewTabs): links inside comment and post bodies open in a
 * new tab. Off by default, so Reddit's own behaviour is unchanged. Sets target=_blank and
 * rel="noopener noreferrer" on the links in each item's OWN body (light DOM: `[slot=comment]` and
 * `[slot=text-body]`), skipping in-page and non-web links; turning it off puts back what it changed.
 * Option postLinks: in the Old Reddit look, a post's title and thumbnail open in a new tab too
 * (old Reddit's "open links in a new window"); a plain left click only, modified clicks stay the
 * browser's.
 * Ideas from RES lib/modules/betteReddit.js (GPL-3.0, the RES contributors, commit 4defffc).
 */
import { defineModule } from '../../core/types';
import { ownBody } from '../../model/access';
import { C } from '../../contracts/reddit';

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

/** The link a click on a post's old-look title or feed thumbnail opens, or null for any other click. */
export function postLinkOf(target: Element): string | null {
  const post = target.closest(C.post);
  if (!post) return null;
  const title = target.closest('a.rescue-otitle');
  if (title) return title.getAttribute('href');
  const thumb =
    target.closest('.rescue-oth') ||
    (target.closest(C.mediaContainer)?.parentElement === post &&
      post.hasAttribute(C.skin.mountAttr) &&
      !!post.closest(C.feed));
  return thumb ? (post.querySelector('a.rescue-otitle')?.getAttribute('href') ?? null) : null;
}

let postLinks = false;
/** Capture on the document: runs before Reddit's router and the old look's own thumbnail click. */
function onClick(e: MouseEvent): void {
  if (!postLinks || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const href = e.target instanceof Element ? postLinkOf(e.target) : null;
  if (!href) return;
  e.preventDefault();
  e.stopPropagation();
  window.open(new URL(href, location.href).href, '_blank', 'noopener');
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
  title: 'Links open in a new tab',
  description:
    'Links inside comments and post text open in a new tab, so you keep your place in the thread; in the Old Reddit look, post titles and thumbnails can too. Links to other parts of the same page are left alone. Off by default.',
  enabledByDefault: false,
  options: {
    postLinks: {
      type: 'boolean',
      default: true,
      title: 'Post titles and thumbnails too (Old Reddit look)',
      description:
        'Clicking a post’s title or thumbnail opens it in a new tab, as old Reddit’s “open links in a new window” did. Ctrl-, Shift- and middle-clicks still do what the browser does.',
    },
  },

  init(ctx) {
    postLinks = (ctx.options.postLinks as boolean | undefined) !== false;
    document.addEventListener('click', onClick, true);
  },

  onSettings(ctx) {
    postLinks = (ctx.options.postLinks as boolean | undefined) !== false;
  },

  onItems(batch) {
    for (const c of batch.comments) openLinksInNewTab(c.source);
    for (const p of batch.posts) openLinksInNewTab(p.source);
  },

  dispose() {
    postLinks = false;
    document.removeEventListener('click', onClick, true);
    restore();
  },
});
