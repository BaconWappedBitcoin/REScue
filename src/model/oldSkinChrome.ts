/**
 * Old Reddit look: the page's chrome around the rows (research R24): the sort tabs where Reddit's
 * "Best ▾" dropdown was, REScue's shortcut bar as the thin "MY SUBREDDITS - HOME - POPULAR ..." strip
 * at the very top, the thread's "sorted by" line and the right sidebar's boxes. Reddit's own header
 * bar is kept (no fake logo, no fake account links); it is only moved down by the height of the
 * strip when REScue's shortcut bar is on the page. All CSS, all scoped by the skin attribute.
 */
import { C } from '../contracts/reddit';
import { ROOT } from './oldSkinBase';

/** Height of the old-style subreddit strip, in pixels. */
export const BAR_HEIGHT = 18;

export function chromeCss(): string {
  const k = C.skin;
  const R = ROOT;
  const bar = `${R} #rescue-subreddit-bar`;
  return [
    // Reddit's large "Post to r/…" bar: the subreddit header's own "Create Post" button stays.
    `${R} ${C.main} ${k.composerBar} { display: none !important; }`,
    // REScue's keyboard selection: a light band with a thin left rule, like RES on old Reddit.
    `${R} #${k.selectionBoxId} { border: 0 !important; border-left: 2px solid var(--os-head-line) !important; border-radius: 0 !important; box-shadow: none !important; background: color-mix(in srgb, var(--os-head) 35%, transparent) !important; }`,
    // Pinned posts: old Reddit's green stickied rows in place of Reddit's highlight cards.
    `${R} ${k.highlights.carousel}[${k.highlights.shownAttr}] { display: none !important; }`,
    `${R} .rescue-osticky { margin: 2px 0 4px; }`,
    `${R} .rescue-ostick { display: grid; grid-template-columns: 80px minmax(0, 1fr); align-items: start; padding: 3px 0; font: 10px/1.4 var(--os-font); color: var(--os-meta); }`,
    `${R} .rescue-ostick-score { text-align: center; padding-top: 4px; font: bold 13px/1 var(--os-font); color: var(--os-arrow); }`,
    `${R} .rescue-ostick-title { font: normal 16px/1.3 arial, sans-serif; color: var(--os-sticky) !important; text-decoration: none; }`,
    `${R} .rescue-ostick-title:hover { text-decoration: underline; }`,
    `${R} .rescue-ostick-word { color: var(--os-sticky); font-weight: bold; }`,
    `${R} .rescue-ostick .rescue-oauthor { color: var(--os-tag); text-decoration: none; }`,
    `${R} .rescue-ostick .rescue-ocomments { display: inline-block; margin-top: 1px; }`,
    // Sort tabs: old Reddit's "best / hot / new / rising / controversial / top" strip.
    `${R} ${k.feedSort}[${k.tabsAttr}] { display: none !important; }`,
    `${R} .rescue-otabs { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 3px; margin: 4px 0 2px; padding: 0 0 0 4px; border-bottom: 1px solid var(--os-head-line); font: bold 12px/1.3 var(--os-font); text-transform: lowercase; }`,
    `${R} .rescue-otab { padding: 1px 7px 0; border: 1px solid var(--os-head-line); border-bottom: 0; background: var(--os-head); color: var(--os-tag); text-decoration: none; margin-bottom: -1px; }`,
    `${R} .rescue-otab:hover { text-decoration: underline; }`,
    `${R} .rescue-otab.rescue-oon { background: var(--os-bg); color: #ff4500; border-bottom: 1px solid var(--os-bg); }`,
    // The thread's comment sort line ("sorted by: top ⌄"): Reddit's own dropdown, small and grey.
    `${R} ${k.commentHeader} { font: 12px/1.4 var(--os-font); color: var(--os-meta); margin-top: 4px; }`,
    `${R} ${k.commentSort} { --size-button-sm-h: 20px; --color-button-secondary-background: transparent; --color-button-secondary-background-hover: transparent; --color-button-secondary-border: transparent; --color-button-secondary-text: var(--os-meta); }`,
    // The subreddit strip across the top, in old Reddit's small grey capitals.
    `${bar} { position: fixed; top: 0; left: 0; right: 0; bottom: auto; width: auto; max-width: none !important; height: ${BAR_HEIGHT}px; box-sizing: border-box; display: flex; align-items: center; gap: 0; padding: 0 6px; border: 0; border-bottom: 1px solid var(--os-border); border-radius: 0; background: var(--os-bar); box-shadow: none; color: var(--os-meta); font: 9px/${BAR_HEIGHT - 1}px var(--os-font); z-index: 2147483000; }`,
    `${bar} a, ${bar} button { color: var(--os-meta); font: 9px/${BAR_HEIGHT - 1}px var(--os-font); text-transform: uppercase; padding: 0 3px; }`,
    `${bar} a[aria-current] { color: #ff4500; font-weight: bold; }`,
    `${bar} .rescue-sc-viewport { gap: 0; }`,
    `${bar} .rescue-sc-viewport > a + a::before, ${bar} .rescue-sc-viewport > a + .rescue-sc::before, ${bar} .rescue-sc + .rescue-sc::before { content: "-"; display: inline-block; padding-right: 3px; color: var(--os-meta); text-decoration: none; }`,
    `${bar} [data-rescue-mine] { order: -1; }`,
    `${bar} .rescue-bar-sep { margin: 0 3px; }`,
    `${bar} .rescue-sc-edit { font-size: 9px; }`,
    `${R}:has(#rescue-subreddit-bar) ${k.headerHost} { top: ${BAR_HEIGHT}px !important; }`,
    `${R}:has(#rescue-subreddit-bar) body { padding-top: ${BAR_HEIGHT}px; }`,
    // The right sidebar: Reddit's own content in old Reddit's boxes and small type.
    `${R} ${k.sidebarBox} { border: 1px solid var(--os-border) !important; background: var(--os-panel) !important; border-radius: 0 !important; padding: 6px 8px !important; margin-bottom: 8px !important; }`,
    `${R} ${C.rightSidebar} h2, ${R} ${C.rightSidebar} h3 { font: bold 10px/1.4 var(--os-font) !important; text-transform: uppercase; color: var(--os-meta) !important; letter-spacing: 0; }`,
    `${R} ${C.rightSidebar} { --size-button-sm-h: 20px; --color-button-secondary-background: var(--os-head); --color-button-secondary-border: var(--os-head-line); --color-button-secondary-text: var(--os-tag); --color-button-primary-background: var(--os-head); --color-button-primary-text: var(--os-tag); }`,
    `${R} ${C.rightSidebar} a { text-decoration: none; }`,
  ].join('\n');
}
