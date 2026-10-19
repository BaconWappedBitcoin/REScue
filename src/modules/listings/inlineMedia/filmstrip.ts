/**
 * Gallery filmstrip (RES showImages galleryAsFilmstrip, filmstripLoadIncrement,
 * useSlideshowWhenLargerThan): all of a gallery's pictures stacked in a REScue-owned block placed
 * INSIDE Reddit's media container (the container is a light-DOM div; elements slotted anywhere else
 * on the post do not render). Reddit's carousel, a child of that container, is hidden only while
 * the filmstrip is on, and the filmstrip always carries a word that brings the carousel back.
 *
 * Pictures come from the post model (`Post.media.items`), and only from Reddit's own picture hosts.
 * Reddit loads gallery slides lazily, so the filmstrip shows the pictures the model has found.
 */
import { C } from '../../../contracts/reddit';
import { h } from '../../../core/dom';
import { hint } from '../../../core/hints';
import type { MediaItem, Post } from '../../../model/types';

export const FILM_ATTR = 'data-rescue-filmstrip';
export const FILM_ON = 'on';
export const FILM_CLASS = 'rescue-filmstrip';

/** Hides Reddit's carousel while the filmstrip is shown. */
export function filmCss(): string {
  return `${C.post}[${FILM_ATTR}="${FILM_ON}"] > ${C.mediaContainer} ${C.mediaInner.gallery} { display: none !important; }`;
}

/** Only https pictures from Reddit's own picture servers are ever drawn. */
export function allowedPicture(src: string): boolean {
  try {
    const u = new URL(src);
    return u.protocol === 'https:' && C.thumbHosts.test(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function galleryPictures(post: Post): MediaItem[] {
  const m = post.media;
  if (!m || m.kind !== 'gallery') return [];
  return m.items.filter((i) => allowedPicture(i.src));
}

/** Whole numbers ≥ 1; anything else is the default. */
export function positiveInt(raw: unknown, fallback: number): number {
  const n = Math.floor(Number(String(raw ?? '').trim()));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

/**
 * Should this gallery become a filmstrip? Not when the option is off, when there is only one
 * picture, or when it is longer than “use the slideshow above N pictures” (0 means never).
 */
export function wantsFilmstrip(on: boolean, count: number, slideshowAbove: number): boolean {
  if (!on || count < 2) return false;
  return !(slideshowAbove > 0 && count > slideshowAbove);
}

const BAR =
  'display:flex;gap:8px;align-items:center;font-size:12px;color:var(--rescue-meta,#666);margin:2px 0';

function wordButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'rescue-film-word rescue-btn', title }, text);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return b;
}

/**
 * The filmstrip: a line with the picture count and a “show slideshow” word, the first
 * `increment` pictures, and a “load N more” word while more remain.
 */
export function buildFilmstrip(
  items: MediaItem[],
  increment: number,
  onSlideshow: () => void,
): HTMLElement {
  let shown = 0;
  const list = h('div', { class: 'rescue-film-list' });
  const more = wordButton('', hint.filmMore, () => draw());
  const bar = h(
    'div',
    { class: 'rescue-film-bar' },
    `${items.length} pictures`,
    wordButton('show slideshow', hint.filmSlideshow, onSlideshow),
    more,
  );
  bar.style.cssText = BAR;
  function draw(): void {
    const next = items.slice(shown, shown + increment);
    for (const item of next) {
      const img = h('img', {
        src: item.src,
        alt: item.caption ?? '',
        loading: 'lazy',
        class: 'rescue-film-img',
      });
      img.style.cssText = 'display:block;max-width:100%;height:auto;margin:4px 0';
      list.append(img);
      if (item.caption) {
        const cap = h('div', { class: 'rescue-film-caption' }, item.caption);
        cap.style.cssText = 'font-size:12px;color:var(--rescue-meta,#666);margin-bottom:6px';
        list.append(cap);
      }
    }
    shown += next.length;
    const left = items.length - shown;
    more.hidden = left <= 0;
    more.textContent = `load ${Math.min(increment, left)} more`;
  }
  draw();
  return h('div', { class: FILM_CLASS }, bar, list);
}
