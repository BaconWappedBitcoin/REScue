/**
 * The selection outline. REScue never styles Reddit's own elements for this: a REScue-owned,
 * pointer-events:none box is drawn over the selected item's OWN area. A comment element wraps all
 * of its replies, so its box runs only from the top of its own meta row to the bottom of its own
 * body; a post's box covers the feed card. The box follows scroll, resize and layout changes
 * (rAF-throttled) and hides itself when the item is removed or hidden.
 */
import { C } from '../../contracts/reddit';
import { ensureTheme } from '../../core/theme';
import type { SelectableItem } from './selection';

export const SELECTED_ATTR = 'data-rescue-selected';
export const BOX_ID = 'rescue-selection';

/** Space kept above a selected item when scrolling to it, clear of Reddit's sticky header. */
export const TOP_MARGIN = 72;
const BOTTOM_MARGIN = 16;
/** Height of the outline when a comment has neither a meta row nor a body to measure. */
const FALLBACK_HEIGHT = 56;

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How a move scrolls (RES keyboardNav scroll styles). */
export type ScrollStyle = 'directional' | 'top' | 'middle' | 'page' | 'legacy' | 'adopt' | 'none';

export const OUTLINE_STYLES = ['solid', 'dashed', 'dotted', 'double'] as const;
export type OutlineStyle = (typeof OUTLINE_STYLES)[number];

export interface SelectionConfig {
  scrollStyle: ScrollStyle;
  /** The style for jumps that are not one step (sibling, thread, parent, first/last, undo); 'same' = scrollStyle. */
  nonLinearScrollStyle: ScrollStyle | 'same';
  outlineColor: string;
  outlineStyle: OutlineStyle;
  /** Soft fill over the selected item (RES selectedEntry backgroundColor); '' = none. */
  fillColor: string;
  /** A thick bar down the right side of the selected item (RES selectedEntry addLine). */
  addLine: boolean;
}

export const DEFAULT_CONFIG: SelectionConfig = {
  scrollStyle: 'directional',
  nonLinearScrollStyle: 'same',
  outlineColor: '#ff4500',
  outlineStyle: 'solid',
  fillColor: '',
  addLine: false,
};

/** A hex colour (#rgb, #rrggbb, #rrggbbaa) or the default; the value goes into a style string. */
export const safeColor = (v: unknown): string =>
  typeof v === 'string' && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)
    ? v
    : DEFAULT_CONFIG.outlineColor;

/** The fill as an rgba() string at 35% strength, so the item underneath stays readable; '' if unusable. */
export function fillCss(v: unknown): string {
  if (typeof v !== 'string') return '';
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return '';
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
  return `rgba(${n(0)}, ${n(2)}, ${n(4)}, 0.35)`;
}

/**
 * How far to scroll (positive = down) to show `area` in a viewport `height` tall:
 *  - directional: only as far as needed, the way the page is already moving;
 *  - top: the item's top lands just under the sticky header;
 *  - middle: the item is centred (a tall item gets its top aligned instead);
 *  - page: nothing while the item is fully visible, else its top goes to the header margin;
 *  - legacy (RES): nothing while the item is fully visible, else its top goes to the header margin;
 *    unlike 'page' this is the whole rule, whichever way the item is off screen;
 *  - adopt (RES): the item takes the place on screen the previous item had (`fromTop`), kept
 *    visible; without a previous item it behaves like directional;
 *  - none: the page does not scroll.
 */
export function scrollDelta(
  area: Box,
  height: number,
  style: ScrollStyle,
  fromTop?: number,
): number {
  const fits = area.bottom - area.top <= height - TOP_MARGIN - BOTTOM_MARGIN;
  switch (style) {
    case 'none':
      return 0;
    case 'legacy':
      return area.top < TOP_MARGIN || area.bottom > height - BOTTOM_MARGIN
        ? area.top - TOP_MARGIN
        : 0;
    case 'adopt': {
      if (fromTop === undefined) return scrollDelta(area, height, 'directional');
      let diff = area.top - fromTop;
      // Compensate to show the top when the previous item was above the window; always keep at
      // least its top 60px on screen when it was below.
      if (fromTop < 0) diff += fromTop;
      else if (fromTop > height - 60) diff += fromTop - height + 60;
      return diff;
    }
    case 'top':
      return area.top - TOP_MARGIN;
    case 'middle':
      return fits ? (area.top + area.bottom) / 2 - height / 2 : area.top - TOP_MARGIN;
    case 'page':
      return area.top < TOP_MARGIN || area.bottom > height - BOTTOM_MARGIN
        ? area.top - TOP_MARGIN
        : 0;
    default:
      if (area.top < TOP_MARGIN) return area.top - TOP_MARGIN;
      if (area.bottom > height - BOTTOM_MARGIN) {
        // Never push the top of a tall item above the margin.
        return Math.min(area.bottom - (height - BOTTOM_MARGIN), area.top - TOP_MARGIN);
      }
      return 0;
  }
}

/** Scroll events this soon after our own scroll are ours, not the user's. */
const OWN_SCROLL_MS = 250;

/** False when the element, or anything that contains it, is hidden. */
export function isShown(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if ((n as HTMLElement).hidden) return false;
    // Reading `.style` builds a wrapper per element; only an element with inline style can match.
    if (n.hasAttribute('style') && (n as HTMLElement).style?.display === 'none') return false;
  }
  return true;
}

/**
 * `isShown` for many elements at once: ancestors shared between them (the thread container, a
 * parent comment) are judged once per `cache`, so listing N items costs N steps, not N x depth.
 */
export function isShownCached(el: Element, cache: Map<Element, boolean>): boolean {
  const path: Element[] = [];
  let shown = true;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const known = cache.get(n);
    if (known !== undefined) {
      shown = known;
      break;
    }
    path.push(n);
    if ((n as HTMLElement).hidden) shown = false;
    else if (n.hasAttribute('style') && (n as HTMLElement).style?.display === 'none') shown = false;
    if (!shown) break;
  }
  // Every element walked shares the verdict: a hidden ancestor hides all below it.
  for (const n of path) cache.set(n, shown);
  return shown;
}

const measurable = (r: DOMRect | undefined): r is DOMRect => !!r && r.width > 0 && r.height > 0;

/** First match that belongs to `host` itself rather than to a reply nested inside it. */
function ownFirst(host: Element, selector: string): Element | null {
  for (const el of host.querySelectorAll(selector)) if (el.closest(C.comment) === host) return el;
  return null;
}

/** The viewport rectangle the selection outline covers, or null when it cannot be measured. */
export function areaOf(item: SelectableItem): Box | null {
  if (item.kind === 'post') {
    const r = item.wrapper.getBoundingClientRect();
    return measurable(r) ? r : null;
  }
  const host = item.host.getBoundingClientRect();
  if (!measurable(host)) return null;
  const meta = ownFirst(item.host, `[${C.slotAttr}="${C.slots.commentMeta}"]`);
  const body = ownFirst(item.host, C.commentBody);
  const m = meta?.getBoundingClientRect();
  const b = body?.getBoundingClientRect();
  const top = measurable(m) ? m.top : host.top;
  // A collapsed or missing body leaves the meta row; with neither, the host's first lines.
  const bottom = measurable(b)
    ? b.bottom
    : measurable(m)
      ? m.bottom
      : host.top + Math.min(host.height, FALLBACK_HEIGHT);
  // Never past the comment itself: Firefox still measures a collapsed comment's hidden body at its
  // full height (verified live 2026-10-19), which left the outline hanging over the next comments.
  return {
    left: host.left,
    right: host.right,
    top,
    bottom: Math.max(Math.min(bottom, host.bottom), top + 1),
  };
}

export class SelectionView {
  private box: HTMLElement | null = null;
  private target: SelectableItem | null = null;
  private frame = 0;
  private resizes: ResizeObserver | null = null;
  private readonly onMove = (): void => this.schedule();
  private config: SelectionConfig = { ...DEFAULT_CONFIG };
  private ownScrollAt = -Infinity;

  /** Change the scroll style or the outline; an outline already on screen is restyled. */
  configure(next: Partial<SelectionConfig>): void {
    this.config = { ...this.config, ...next };
    this.config.outlineColor = safeColor(this.config.outlineColor);
    if (!OUTLINE_STYLES.includes(this.config.outlineStyle)) {
      this.config.outlineStyle = DEFAULT_CONFIG.outlineStyle;
    }
    this.config.fillColor = fillCss(this.config.fillColor) ? String(this.config.fillColor) : '';
    this.config.addLine = this.config.addLine === true;
    if (this.box) this.styleOutline(this.box);
  }

  /** True just after the view scrolled the page itself (so a scroll listener can ignore it). */
  scrolledRecently(): boolean {
    return Date.now() - this.ownScrollAt < OWN_SCROLL_MS;
  }

  /** Outline `item`, scrolling it into view first when `scroll` is set and it is off-screen. */
  show(item: SelectableItem, scroll: boolean, nonLinear = false): void {
    if (!this.target) {
      addEventListener('scroll', this.onMove, { capture: true, passive: true });
      addEventListener('resize', this.onMove, { passive: true });
    }
    const fromTop = this.target && this.target !== item ? areaOf(this.target)?.top : undefined;
    this.target = item;
    if (typeof ResizeObserver !== 'undefined') {
      this.resizes ??= new ResizeObserver(this.onMove);
      this.resizes.disconnect();
      this.resizes.observe(item.host);
      this.resizes.observe(document.body);
    }
    if (scroll) this.scrollTo(item, nonLinear, fromTop);
    this.paint();
  }

  hide(): void {
    if (this.target) {
      removeEventListener('scroll', this.onMove, true);
      removeEventListener('resize', this.onMove);
    }
    this.target = null;
    this.resizes?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.box?.remove();
    this.box = null;
  }

  /** Repaint on the next animation frame (any number of requests make one repaint). */
  schedule(): void {
    if (!this.target || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  }

  paint(): void {
    const item = this.target;
    if (!item) return;
    const area = item.host.isConnected && isShown(item.wrapper) ? areaOf(item) : null;
    const box = this.ensureBox();
    if (!area) {
      box.style.display = 'none';
      return;
    }
    const s = box.style;
    s.display = 'block';
    s.left = `${area.left}px`;
    s.top = `${area.top}px`;
    s.width = `${area.right - area.left}px`;
    s.height = `${area.bottom - area.top}px`;
  }

  private ensureBox(): HTMLElement {
    if (this.box?.isConnected) return this.box;
    const box = this.box ?? document.createElement('div');
    if (!this.box) {
      box.id = BOX_ID;
      box.className = 'rescue-overlay';
      box.setAttribute('aria-hidden', 'true');
      box.style.cssText =
        'position:fixed;display:none;pointer-events:none;z-index:2147483000;box-sizing:border-box;' +
        'border-radius:3px;box-shadow:0 0 0 1px var(--rescue-bg,#fff)';
    }
    this.box = box;
    ensureTheme();
    this.styleOutline(box);
    document.body.appendChild(box);
    return box;
  }

  private styleOutline(box: HTMLElement): void {
    // The default colour follows the theme (a brighter orange on dark pages); a colour the reader
    // chose stays exactly as chosen.
    const chosen = this.config.outlineColor;
    const color =
      chosen.toLowerCase() === DEFAULT_CONFIG.outlineColor
        ? `var(--rescue-outline, ${chosen})`
        : chosen;
    box.style.border = `2px ${this.config.outlineStyle} ${color}`;
    box.style.background = fillCss(this.config.fillColor);
    // The bar sits inside the right edge, in the outline colour.
    box.style.boxShadow = this.config.addLine
      ? `inset -6px 0 0 0 ${color}, 0 0 0 1px var(--rescue-bg,#fff)`
      : '0 0 0 1px var(--rescue-bg,#fff)';
  }

  /** Scroll the item's area into view, clear of the sticky header, in the configured style. */
  private scrollTo(item: SelectableItem, nonLinear: boolean, fromTop?: number): void {
    const area = areaOf(item);
    if (!area) return;
    const jump = this.config.nonLinearScrollStyle;
    const style = nonLinear && jump !== 'same' ? jump : this.config.scrollStyle;
    const by = scrollDelta(area, innerHeight, style, fromTop);
    if (Math.abs(by) < 1) return;
    this.ownScrollAt = Date.now();
    window.scrollBy?.({ top: by, behavior: 'instant' });
  }
}
