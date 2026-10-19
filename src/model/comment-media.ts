/**
 * Media inside a comment (inlineMedia, "Hide inline media"): finding a comment's figures, naming
 * their type, and the stylesheet that hides them. Reddit puts every picture, GIF and video of a
 * comment body in a light-DOM `figure.rte-media` (contract `commentMedia`); REScue hides the
 * figure as a whole with an attribute it owns and its own stylesheet, so there is no flash on
 * load, and never writes into Reddit's players. The stylesheet matches the figure wherever it is,
 * so media that Reddit builds late is hidden the moment it exists.
 */
import { C } from '../contracts/reddit';

export type CommentMediaKind = 'image' | 'GIF' | 'video' | 'media';

/** Set on a figure by REScue: "shown" while it is open, "hidden" while it is put away. */
export const CM_ATTR = 'data-rescue-cm';
export const CM_SHOWN = 'shown';
export const CM_HIDDEN = 'hidden';
/** The button REScue puts before each figure it manages. */
export const CM_BUTTON_CLASS = 'rescue-cm-toggle';

/** A comment body's figures (selector, relative to anything). */
export const FIGURE_SELECTOR = `${C.commentBody} ${C.commentMedia.figure}`;

/**
 * The stylesheet. While comment media is hidden ("active") every figure in a comment body is
 * hidden unless marked shown, so media Reddit builds late never flashes; otherwise only figures
 * you put away yourself (marked hidden) are.
 */
export function commentMediaCss(active: boolean): string {
  const hidden = `${FIGURE_SELECTOR}[${CM_ATTR}="${CM_HIDDEN}"]`;
  const rest = active ? `,
${FIGURE_SELECTOR}:not([${CM_ATTR}="${CM_SHOWN}"])` : '';
  return `${hidden}${rest} { display: none !important; }`;
}

/** The comment (thread or profile) a figure belongs to: the nearest one, so replies are not mixed in. */
export const commentOf = (el: Element): Element | null =>
  el.closest(`${C.comment}, ${C.profileComment}`);

/** The figures that belong to this comment itself, not to a reply nested in it. */
export function figuresOf(host: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const f of host.querySelectorAll<HTMLElement>(FIGURE_SELECTOR))
    if (commentOf(f) === host) out.push(f);
  return out;
}

/** Is this node a figure of a comment body? */
export const isFigure = (el: Element): el is HTMLElement => el.matches(FIGURE_SELECTOR);

/** What a figure holds, from the tags Reddit puts in it (a tag name or attribute is all that is read). */
export function kindOfFigure(figure: Element): CommentMediaKind {
  if (figure.querySelector(C.commentMedia.gif)) return 'GIF';
  if (figure.querySelector(C.commentMedia.video)) return 'video';
  if (figure.querySelector(C.commentMedia.image)) return 'image';
  return 'media';
}

/**
 * Stop a hidden player: pause what a player or video offers through its public API (a method on
 * the element, or a light-DOM `<video>`). Never reaches into a shadow root.
 */
export function pausePlayers(figure: Element): void {
  const players = figure.querySelectorAll<HTMLElement & { pause?: () => void }>(
    `${C.commentMedia.video}, video`,
  );
  for (const p of players) {
    try {
      if (typeof p.pause === 'function') p.pause();
    } catch {
      /* a player that is not ready yet has nothing to pause */
    }
  }
}
