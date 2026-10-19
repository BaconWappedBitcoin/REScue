/**
 * Picture expandos for links inside comments and self-text (RES hosts, “media expandos for links
 * inside comments”). A link to a picture on Reddit's own picture servers (i.redd.it,
 * preview.redd.it) gets a small “show picture” word after it; clicking it draws the picture under
 * the link, clicking again removes it. Nothing loads until you click. Links to other sites are
 * never expanded: that would mean your browser contacting a third party for you (REScue makes no
 * such requests), so those stay plain links.
 */
import { h } from '../../../core/dom';
import { hint } from '../../../core/hints';
import { allowedPicture } from './filmstrip';

export const LINK_WRAP_CLASS = 'rescue-linkmedia';
const DONE_ATTR = 'data-rescue-linkmedia';
const PICTURE_PATH = /\.(?:jpe?g|png|gif|webp)$/i;

/** The picture URL a link points to, when it is one this feature expands; else null. */
export function pictureHref(href: string | null): string | null {
  if (!href) return null;
  let u: URL;
  try {
    u = new URL(href, 'https://www.reddit.com');
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host !== 'i.redd.it' && host !== 'preview.redd.it') return null;
  if (!PICTURE_PATH.test(u.pathname)) return null;
  return allowedPicture(u.href) ? u.href : null;
}

/** Add the word after every expandable link in `body` that does not have one yet. Returns how many. */
export function decorateLinks(body: Element, maxHeight: string | null): number {
  let added = 0;
  for (const link of body.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (link.hasAttribute(DONE_ATTR) || link.querySelector('img')) continue;
    const src = pictureHref(link.getAttribute('href'));
    if (!src) continue;
    link.setAttribute(DONE_ATTR, '');
    link.after(buildWord(src, maxHeight));
    added++;
  }
  return added;
}

function buildWord(src: string, maxHeight: string | null): HTMLElement {
  let img: HTMLImageElement | null = null;
  const button = h('button', { type: 'button', class: 'rescue-linkmedia-toggle rescue-btn' });
  const wrap = h('span', { class: LINK_WRAP_CLASS }, ' ', button);
  const paint = (): void => {
    button.textContent = img ? 'hide picture' : 'show picture';
    button.title = hint.linkMedia(!!img);
    button.setAttribute('aria-expanded', String(!!img));
  };
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (img) {
      img.remove();
      img = null;
    } else {
      img = h('img', { src, alt: '', loading: 'lazy', class: 'rescue-linkmedia-img' });
      img.style.cssText = `display:block;max-width:100%;height:auto;margin:4px 0;max-height:${maxHeight ?? '80vh'}`;
      wrap.append(img);
    }
    paint();
  });
  paint();
  return wrap;
}

/** Remove every word and picture this feature added, and the marks on the links. */
export function removeLinkMedia(root: ParentNode = document): void {
  for (const w of root.querySelectorAll(`.${LINK_WRAP_CLASS}`)) w.remove();
  for (const a of root.querySelectorAll(`[${DONE_ATTR}]`)) a.removeAttribute(DONE_ATTR);
}
