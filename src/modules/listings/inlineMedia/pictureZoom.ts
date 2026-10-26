/**
 * Pictures in comments (inlineMedia zoomCommentPictures). Reddit draws them at most 240px wide, and
 * a click opens the picture's address in a new tab, where preview.redd.it sends the browser on to
 * reddit.com/media, which can loop ("isn't redirecting properly" in LibreWolf). Instead a plain
 * click shows the picture full size where it is, and another click puts it back. Middle-click and
 * Ctrl/Shift/⌘+click still open Reddit's new tab. Only the picture Reddit already loaded is shown.
 */
import { C } from '../../../contracts/reddit';
import { pictureHref } from './linkMedia';

export const ZOOM_ATTR = 'data-rescue-czoom';

const F = `${C.commentMedia.figure}[${ZOOM_ATTR}]`;
/** Full width of the comment, natural height; Reddit's own size classes are outranked. */
export const zoomCss = [
  `${C.commentMedia.figure}:has(> a ${C.commentMedia.image}) > a { cursor: zoom-in; }`,
  `${F} > a { cursor: zoom-out; display: block; max-width: 100%; width: auto; }`,
  `${F} > a > ${C.commentMedia.image} { max-width: 100% !important; width: auto !important; max-height: none !important; height: auto !important; }`,
].join('\n');

/** The comment picture link a click landed on, when it is one this feature enlarges. */
export function zoomTarget(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  const link = target.closest<HTMLAnchorElement>(`${C.commentMedia.figure} > a[href]`);
  if (!link || !link.querySelector(C.commentMedia.image)) return null;
  return pictureHref(link.getAttribute('href')) ? link : null;
}

/** Listen for clicks on comment pictures while `enabled()` says so; returns the stop function. */
export function startPictureZoom(enabled: () => boolean): () => void {
  const onClick = (e: MouseEvent): void => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || !enabled()) return;
    const link = zoomTarget(e.target);
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    const figure = link.parentElement!;
    if (figure.hasAttribute(ZOOM_ATTR)) shrink(figure);
    else enlarge(figure, link);
  };
  document.addEventListener('click', onClick, true);
  return () => {
    document.removeEventListener('click', onClick, true);
    for (const f of document.querySelectorAll(`[${ZOOM_ATTR}]`)) shrink(f);
  };
}

const KEEP_SRC = 'data-rescue-czoom-src';
const KEEP_SRCSET = 'data-rescue-czoom-srcset';

/**
 * Reddit loads a small copy of a comment picture (about 320px wide): enlarged, it shows the copy
 * the link points to instead, from the same picture server (an image load, not a page visit).
 */
function enlarge(figure: Element, link: HTMLAnchorElement): void {
  figure.setAttribute(ZOOM_ATTR, '');
  const img = link.querySelector<HTMLImageElement>(C.commentMedia.image);
  const full = pictureHref(link.getAttribute('href'));
  if (!img || !full || img.hasAttribute(KEEP_SRC)) return;
  img.setAttribute(KEEP_SRC, img.getAttribute('src') ?? '');
  img.setAttribute(KEEP_SRCSET, img.getAttribute('srcset') ?? '');
  img.removeAttribute('srcset');
  img.src = full;
}

function shrink(figure: Element): void {
  figure.removeAttribute(ZOOM_ATTR);
  const img = figure.querySelector<HTMLImageElement>(`img[${KEEP_SRC}]`);
  if (!img) return;
  img.setAttribute('src', img.getAttribute(KEEP_SRC) ?? '');
  const set = img.getAttribute(KEEP_SRCSET);
  if (set) img.setAttribute('srcset', set);
  img.removeAttribute(KEEP_SRC);
  img.removeAttribute(KEEP_SRCSET);
}
