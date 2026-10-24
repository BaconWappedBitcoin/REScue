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
    // REScue's keyboard selection: a thin left rule, like RES on old Reddit. No fill of its own:
    // the box lies OVER the post, so a fill would tint its video and pictures (keyboardNav's
    // "Tint the selected item" still adds one for those who ask).
    `${R} #${k.selectionBoxId} { border: 0 !important; border-left: 2px solid var(--os-head-line) !important; border-radius: 0 !important; box-shadow: none !important; }`,
    // The header, closer to old Reddit's: a black wordmark, the page name in small capitals beside
    // it, a plain narrow search box at the right and the account buttons in a light rounded box.
    `${R} ${k.headerLogo} svg { height: 18px; width: auto; }`,
    `${R} ${k.headerLogo} svg path { fill: var(--os-fg) !important; }`,
    // One line, cut with "…" when long; on a narrow window (no room beside Reddit's menu button) none.
    `${R} .rescue-opagename { display: inline-block; vertical-align: middle; flex: 0 1 auto; min-width: 0; max-width: 240px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; margin-left: 8px; color: var(--os-fg); font: small-caps bold 14.4px var(--os-font); text-decoration: none; }`,
    `${R} .rescue-opagename:hover { text-decoration: underline; }`,
    `@media (max-width: 599px) { ${R} .rescue-opagename { display: none; } }`,
    `${R} ${k.headerSearch} { flex: 0 1 320px !important; margin-left: auto; }`,
    `${R} ${k.headerSearch} > div, ${R} ${k.headerSearch} > div > div { position: static !important; width: 100% !important; margin: 0 !important; }`,
    `${R} ${k.headerActions} { margin-left: 8px; padding: 0 6px; height: 34px; align-self: center; background: color-mix(in srgb, var(--os-bg) 70%, var(--os-head)); border-radius: 7px; }`,
    `${R} ${k.headerAdvertise} { display: none !important; }`,
    // Pinned posts: old Reddit's green stickied rows in place of Reddit's highlight cards.
    `${R} ${k.highlights.carousel}[${k.highlights.shownAttr}] { display: none !important; }`,
    // Sort tabs: old Reddit's "best / hot / new / rising / controversial / top" strip.
    `${R} ${k.feedSort}[${k.tabsAttr}] { display: none !important; }`,
    `${R} .rescue-otabs { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 3px; margin: 4px 0 2px; padding: 0 0 0 4px; border-bottom: 1px solid var(--os-head-line); font: bold 12px/1.3 var(--os-font); text-transform: lowercase; }`,
    `${R} .rescue-otab { padding: 1px 7px 0; border: 1px solid var(--os-head-line); border-bottom: 0; background: var(--os-head); color: var(--os-tag); text-decoration: none; margin-bottom: -1px; }`,
    `${R} .rescue-otab:hover { text-decoration: underline; }`,
    `${R} .rescue-otab.rescue-oon { background: var(--os-bg); color: #ff4500; border-bottom: 1px solid var(--os-bg); }`,
    `${R} .rescue-otabgap { width: 14px; }`,
    `${R} .rescue-otab.rescue-ooff { opacity: 0.45; cursor: default; text-decoration: none; }`,
    // The audience-lean chip sits right after the "(domain)" it describes.
    `${R} .rescue-oline .rescue-lean-chip { margin-left: 5px; font-size: 10px; vertical-align: 2px; }`,
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
