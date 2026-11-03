/**
 * Old Reddit look: "show images" at the end of a feed's tab row (RES showImages' "show images"
 * button). It expands every post's media on the page, and posts loaded later as you scroll, through
 * each post's own "show image" word (post.ts); "hide images" collapses them all. It is per page:
 * another page starts with it off, as in RES.
 */
import { C } from '../../../contracts/reddit';
import { h } from '../../../core/dom';
import { EXPANDED } from '../../../model/oldSkinFeed';
import { onActivate, setAttr, setText } from './shared';

/** The page (path and query) "show images" was turned on for, or null. */
let onFor: string | null = null;
let button: HTMLButtonElement | null = null;

const here = (): string => location.pathname + location.search;

/** Should a feed post that just appeared on this page show its media expanded? */
export function showAllOn(): boolean {
  return onFor === here();
}

/** Every feed post's own expand word that is offered on the page right now. */
const words = (): HTMLButtonElement[] =>
  [...document.querySelectorAll<HTMLButtonElement>(`${C.feed} .rescue-oexpand`)].filter(
    (w) => !w.hidden,
  );

function label(): void {
  if (!button) return;
  const on = showAllOn();
  setText(button, on ? 'hide images' : 'show images');
  setAttr(button, 'aria-pressed', String(on));
  setAttr(
    button,
    'title',
    on
      ? 'REScue: put every post’s picture, gallery and video on this page back into its thumbnail'
      : 'REScue: show every post’s picture, gallery and video on this page full size, here in the feed',
  );
}

function toggle(): void {
  onFor = showAllOn() ? null : here();
  const want = showAllOn();
  for (const w of words()) {
    const post = w.closest(C.post);
    if (post && post.hasAttribute(EXPANDED) !== want) w.click();
  }
  label();
}

/** The "show images" word for the tab row (one element, reused when the row is redrawn). */
export function showAllButton(): HTMLButtonElement {
  if (!button) {
    button = h(
      'button',
      { type: 'button', class: 'rescue-otab rescue-oshowall' },
      'show images',
    ) as HTMLButtonElement;
    onActivate(button, toggle);
  }
  label();
  return button;
}

/** Forget the button (the look was turned off). */
export function resetShowAll(): void {
  button?.remove();
  button = null;
  onFor = null;
}
