/**
 * Old Reddit look (oldRedditSkin): which pages it covers, its options, and the one stylesheet that
 * restyles Reddit's OWN page to look like old.reddit.com. The page keeps Reddit's elements, so
 * every REScue feature keeps working. All of it is CSS on light-DOM elements and on the custom
 * properties Reddit exposes (research R23); no shadow root is entered or edited. Every Reddit
 * selector comes from contracts/reddit.ts (`C.skin`). The rules are keyed on one attribute on
 * <html> that the module sets only on feed and thread routes, so they can never touch other pages.
 */
import { C } from '../contracts/reddit';
import { feedCss, searchCss } from './oldSkinFeed';
import { DARK, ROOT, type OldSkinOptions } from './oldSkinBase';
import { chromeCss } from './oldSkinChrome';
import { partsCss } from './oldSkinParts';
import { threadCss } from './oldSkinThread';

export {
  ROOT,
  SKIN_ATTR,
  SKIN_VALUE,
  skinApplies,
  thumbPx,
  type OldSkinOptions,
  type ThumbnailSize,
} from './oldSkinBase';

function paletteCss(): string {
  const k = C.skin;
  return `
${ROOT} {
  --os-bg: #fff; --os-panel: #f6f9fc; --os-fg: #222; --os-link: #0000ff; --os-visited: #551a8b;
  --os-meta: #888; --os-tag: #336699; --os-rank: #c6c6c6; --os-border: #dcdcdc; --os-sticky: #228822;
  --os-head: #cee3f8; --os-head-line: #5f99cf; --os-up: #ff8b60; --os-down: #9494ff;
  --os-arrow: #c6c6c6; --os-line: #ddddff; --os-bar: #f0f0f0;
  --os-font: verdana, arial, helvetica, sans-serif;
}
${DARK} {
  --os-bg: #1a1a1b; --os-panel: #212122; --os-fg: #d7dadc; --os-link: #8cb3d9; --os-visited: #b49cc9;
  --os-meta: #8e9194; --os-tag: #7fa8d0; --os-rank: #5a5d60; --os-border: #343536; --os-sticky: #6fbf6f;
  --os-head: #1f2a36; --os-head-line: #3a5877; --os-arrow: #5a5d60; --os-line: #343536; --os-bar: #1a1a1b;
}
${[ROOT, `${ROOT} ${k.pageBody}`, ...k.paletteHosts.split(', ').map((h) => `${ROOT} ${h}`)].join(',\n')} {
  --color-neutral-background: var(--os-bg) !important; --color-neutral-background-strong: var(--os-bg) !important;
  ${k.contentBackgroundVar}: var(--os-bg) !important;
  --color-neutral-background-weak: var(--os-panel) !important; --color-neutral-background-medium: var(--os-panel) !important;
  --color-neutral-background-hover: var(--os-panel) !important; --color-neutral-background-selected: var(--os-panel) !important;
  --color-neutral-content: var(--os-fg) !important; --color-neutral-content-strong: var(--os-fg) !important;
  --color-neutral-content-weak: var(--os-meta) !important;
  --color-neutral-border: var(--os-border) !important; --color-neutral-border-weak: var(--os-border) !important;
}
${ROOT}, ${ROOT} ${k.pageBody}, ${ROOT} ${C.app} { background: var(--os-bg); color: var(--os-fg); font-family: var(--os-font); }
${ROOT} ${k.headerBar} { background: var(--os-head) !important; border-bottom: 1px solid var(--os-head-line) !important; }`;
}

/** The page frame: no left navigation column, a wide main column and a narrow sidebar. */
function frameCss(o: OldSkinOptions): string {
  const k = C.skin;
  const side = `${ROOT} ${C.rightSidebar}`;
  const rules = [
    `@media (min-width: 960px) {
  ${ROOT} ${k.subGrid} { grid-column: 1 / -1 !important; width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 8px 0 5px; box-sizing: border-box; }
  ${ROOT} ${k.mainGrid} { grid-template-columns: minmax(0, 1fr) 300px !important; max-width: none !important; gap: 10px !important; }
  ${ROOT} ${C.main} { max-width: none !important; width: auto !important; }
  ${side} { width: 300px !important; max-width: 300px !important; font-size: 12px; }
}`,
    `${ROOT} ${k.sidebarBox} { border-radius: 0 !important; }`,
  ];
  if (o.hideLeftNav) {
    // Only where Reddit lays the navigation out as a column; below that it is a drawer opened by the
    // header's own button, which must keep working.
    rules.push(`@media (min-width: 1200px) {
  ${ROOT} ${C.leftNav} { display: none !important; }
  ${ROOT} ${k.pageGrid} { grid-template-columns: minmax(0, 1fr) !important; }
}`);
  }
  if (o.hideBanner) {
    rules.push(
      `${ROOT} ${k.mastheadBanner}, ${ROOT} ${k.mastheadIcon} { display: none !important; }`,
      `${ROOT} ${k.masthead} { height: 48px !important; min-height: 0 !important; margin: 0 !important; }`,
      // Reddit pulls this bar up over the banner; without a banner it stays in place.
      `${ROOT} ${k.mastheadBar} { position: static !important; inset: auto !important; transform: none !important; height: 48px !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; align-items: center !important; }`,
      `${ROOT} ${k.mastheadBar} > div { height: auto !important; min-height: 0 !important; align-items: center !important; }`,
    );
  }
  return rules.join('\n');
}

/** REScue's own buttons and labels, as small plain text in the tagline like old Reddit's own links. */
function rescueCss(): string {
  return `
${ROOT} .rescue-btn { height: auto; margin: 0 2px; padding: 0 2px; border: 0; border-radius: 0; background: transparent; color: var(--os-tag); font: 400 10px/1.4 var(--os-font); overflow: visible; text-decoration: none; }
${ROOT} .rescue-btn:hover { background: transparent; text-decoration: underline; }
${ROOT} .rescue-label { margin: 0 2px; padding: 0; background: transparent; color: var(--os-meta); font: 400 10px/1.4 var(--os-font); }`;
}

/**
 * The veil: a feed post, a thread's post or a comment is unseen until REScue's rows are on it, so
 * the page never shows Reddit's own look first. A pure-CSS timer shows it anyway after three
 * seconds, so an item REScue cannot draw (or a REScue that failed) still appears in Reddit's look.
 */
export const VEIL_MS = 3000;
function veilCss(): string {
  const m = C.skin.mountAttr;
  const items = [`${C.feed} ${C.post}`, `${C.feed} ${C.adPost}`, `${C.main} > ${C.post}`, `${C.main} ${C.comment}`];
  return `
@keyframes rescue-os-reveal { to { visibility: visible; } }
${items.map((i) => `${ROOT} ${i}:not([${m}])`).join(', ')} { visibility: hidden; animation: rescue-os-reveal 0s linear ${VEIL_MS}ms forwards; }
${items.map((i) => `${ROOT} ${i}[${m}]`).join(', ')} { visibility: visible; }`;
}

/** The whole stylesheet for the chosen options. Every rule is scoped by the attribute on <html>. */
export function oldSkinCss(o: OldSkinOptions): string {
  return [veilCss(), paletteCss(), frameCss(o), feedCss(o), searchCss(o), threadCss(), partsCss(), chromeCss(), rescueCss()]
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
