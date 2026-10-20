/**
 * Old Reddit opened a comment's permalink (`/r/x/comments/id/comment/cid/`) at the top, with the
 * post in view; Reddit scrolls down to the comment past the post (verified live 2026-10-19, with
 * REScue off too). While the old look is on, the scrolls Reddit makes in the first seconds of such a
 * page are undone, until the reader scrolls, types, clicks or touches the page themselves.
 */
const COMMENT_LINK = /^\/r\/[^/]+\/comments\/[a-z0-9]+\/(?:comment\/|[^/]+\/)[a-z0-9]+\/?$/i;
const HOLD_MS = 4000;
const READER = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const;

let release: (() => void) | null = null;

/** Whether a path is a single comment's permalink. */
export const isCommentLink = (path: string): boolean => COMMENT_LINK.test(path);

/** Keep a comment permalink page at the top while Reddit settles; anything else is left alone. */
export function holdTop(path: string, win: Window = window): void {
  releaseTop();
  if (!isCommentLink(path)) return;
  const onScroll = (): void => {
    if (win.scrollY > 0) win.scrollTo(0, 0);
  };
  const timer = win.setTimeout(() => releaseTop(), HOLD_MS);
  release = () => {
    win.clearTimeout(timer);
    win.removeEventListener('scroll', onScroll);
    for (const t of READER) win.removeEventListener(t, releaseTop, true);
    release = null;
  };
  win.addEventListener('scroll', onScroll, { passive: true });
  for (const t of READER) win.addEventListener(t, releaseTop, { capture: true, passive: true });
  onScroll();
}

/** Stop holding (the reader moved, the time ran out, or the look was turned off). */
export function releaseTop(): void {
  release?.();
}
