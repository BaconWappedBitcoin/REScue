/**
 * REScue's own tool strip on Reddit's native page: a fixed-position corner holding header tools
 * (the settings gear) with banners (filter counts, page notices) stacked above it. Reddit's layout
 * is never touched; this is the only chrome REScue adds of its own.
 */
import { stamp } from '../../core/instance';
import { h } from '../../core/dom';
import { ensureTheme } from '../../core/theme';
import type { MenuItem } from '../../core/types';
import { createMenu } from './menu';

export const TOOLS_ID = 'rescue-tools';

const STRIP_STYLE =
  'position:fixed;bottom:12px;right:12px;z-index:2147483640;display:flex;' +
  'flex-direction:column;align-items:flex-end;gap:6px;max-width:min(560px,calc(100vw - 24px));' +
  'font:13px/1.4 system-ui,sans-serif';
const BANNERS_STYLE = 'display:flex;flex-direction:column;align-items:flex-end;gap:6px';
// Wraps onto more rows rather than squeezing tools (live 2026-10-15: labels were truncated).
const TOOLS_STYLE =
  'display:none;flex-wrap:wrap;justify-content:flex-end;gap:6px;align-items:center;' +
  'background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);' +
  'border:1px solid var(--rescue-border,#ccc);border-radius:4px;padding:2px 4px;' +
  'box-shadow:0 1px 4px var(--rescue-shadow,rgba(0,0,0,.25))';

/**
 * Publishes the strip's height as `--rescue-stack-h` on <html>. Everything else that floats at the
 * bottom right (notices, the navigator, the saved list) sits above it, so nothing overlaps even
 * when banners make the strip grow.
 */
function trackHeight(doc: Document, strip: HTMLElement): void {
  const set = (): void => {
    const h = Math.ceil(strip.getBoundingClientRect().height);
    const v = `${h}px`;
    if (doc.documentElement.style.getPropertyValue('--rescue-stack-h') !== v)
      doc.documentElement.style.setProperty('--rescue-stack-h', v);
  };
  set();
  if (typeof ResizeObserver === 'function') new ResizeObserver(set).observe(strip);
}

/** Banners are themed panels (modern Reddit styles none of the old `infobar` classes). */
const STRIP_CSS = [
  `#${TOOLS_ID} [hidden]{display:none !important}`,
  `#${TOOLS_ID} .rescue-banners>*{background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);`,
  'border:1px solid var(--rescue-border,#ccc);border-radius:4px;padding:4px 8px;margin:0;',
  'box-shadow:0 1px 4px var(--rescue-shadow,rgba(0,0,0,.25));font:13px/1.4 system-ui,sans-serif}',
  `#${TOOLS_ID} .rescue-banners button:not(.rescue-btn){font:inherit;color:inherit;background:none;border:0;`,
  'padding:0;cursor:pointer;text-decoration:underline}',
  `#${TOOLS_ID} .rescue-banners a{color:var(--rescue-accent,#336699)}`,
].join('');

export interface Toolbar {
  addHeaderTool(node: HTMLElement): void;
  addBanner(node: HTMLElement): void;
  addMenuItem(item: MenuItem): () => void;
  openMenu(anchor: HTMLElement): void;
}

export function createToolbar(doc: Document = document): Toolbar {
  const menu = createMenu(doc);
  let strip: HTMLElement | null = null;
  let banners: HTMLElement = h('div');
  let tools: HTMLElement = h('div');

  /** The strip, rebuilt if the page dropped it. Children survive a rebuild. */
  const ensure = (): void => {
    if (strip?.isConnected) return;
    ensureTheme(doc);
    const keptBanners = [...banners.children];
    const keptTools = [...tools.children];
    banners = h('div', { class: 'rescue-banners' });
    banners.style.cssText = BANNERS_STYLE;
    tools = h('div', { class: 'rescue-tool-row' });
    tools.style.cssText = TOOLS_STYLE;
    banners.append(...keptBanners);
    tools.append(...keptTools);
    if (keptTools.length) tools.style.display = 'flex';
    // Tools set their own inline `display` (e.g. flex), which would beat the `hidden` attribute;
    // this keeps `hidden` authoritative inside the strip (live 2026-10-15: thread-only widgets
    // showed on listings).
    const hiddenWins = h('style', {}, STRIP_CSS);
    strip = h('div', { id: TOOLS_ID, class: 'rescue-overlay' }, hiddenWins, banners, tools);
    strip.style.cssText = STRIP_STYLE;
    stamp(strip);
    (doc.body ?? doc.documentElement).appendChild(strip);
    trackHeight(doc, strip);
  };

  return {
    addHeaderTool(node) {
      ensure();
      // A tool keeps its natural width; the row wraps instead.
      node.style.flex = 'none';
      node.style.whiteSpace = 'nowrap';
      if (node.parentElement !== tools) tools.appendChild(node);
      tools.style.display = 'flex';
    },
    addBanner(node) {
      ensure();
      if (node.parentElement !== banners) banners.appendChild(node);
    },
    addMenuItem: (item) => menu.add(item),
    openMenu: (anchor) => menu.open(anchor),
  };
}
