/**
 * Link numbers (RES keyboardNav linkNumbers): small [1]…[9],[0] badges beside the links in the
 * selected item's OWN body, so a link can be opened by pressing its number. RES inserts spans
 * after each link; REScue never edits Reddit's markup, so the badges live in a REScue overlay
 * layer (pointer-events:none, position:fixed) that follows scroll and resize, like the selection
 * outline. Ported in spirit from RES lib/modules/keyboardNav.js (GPL-3.0, Copyright (C) the Reddit
 * Enhancement Suite contributors, commit 4defffc).
 */
import { hint } from '../../../core/hints';
import { webUrl } from '../../../core/tabs';
import { isShown, type Box } from '../../../layout/native/selectionView';
import type { SelectableItem } from '../../../layout/native/selection';
import { ownBody } from '../../../model/access';

/** One key per badge: 1-9 then 0, as RES does (more links need RES's command line). */
export const MAX_LINK_NUMBERS = 10;

export type LinkNumberPosition = 'left' | 'right';

/** The digit key for the nth link (0-based): 1..9, then 0. */
export const digitOf = (index: number): string => String((index + 1) % 10);

/** The link index (0-based) a digit key stands for, or null: '1' is 0, '9' is 8, '0' is 9. */
export function indexOfDigit(key: string): number | null {
  if (!/^[0-9]$/.test(key)) return null;
  return (Number(key) + 9) % 10;
}

/** A link worth a number: it goes somewhere (not "#" or a script) and has something to click. */
function worthNumbering(a: HTMLAnchorElement): boolean {
  const href = a.getAttribute('href');
  if (!href || href.startsWith('#') || !webUrl(href)) return false;
  if (!(a.textContent ?? '').trim() && !a.querySelector('img, svg, video')) return false;
  return isShown(a);
}

/** The first links in the selected item's own post text or comment body, in reading order. */
export function numberedLinks(item: SelectableItem | null): HTMLAnchorElement[] {
  const body = item ? ownBody(item.host) : null;
  if (!body) return [];
  return [...body.querySelectorAll('a[href]')]
    .filter((a): a is HTMLAnchorElement => a instanceof HTMLAnchorElement && worthNumbering(a))
    .slice(0, MAX_LINK_NUMBERS);
}

const LAYER_ID = 'rescue-link-numbers';

/** Where a badge goes: just past the link's last line (right) or before its first line (left). */
export function badgeSpot(
  rects: Box[],
  position: LinkNumberPosition,
): { x: number; y: number } | null {
  const rect = position === 'right' ? rects[rects.length - 1] : rects[0];
  if (!rect) return null;
  return { x: position === 'right' ? rect.right + 2 : rect.left - 2, y: rect.top };
}

export class LinkNumberOverlay {
  private layer: HTMLElement | null = null;
  private links: HTMLAnchorElement[] = [];
  private position: LinkNumberPosition = 'right';
  private keys: 'digit' | 'alt' = 'digit';
  private frame = 0;
  private active = false;
  private readonly onMove = (): void => this.schedule();

  /** Number `links` (replacing any earlier numbers). An empty list removes the layer. */
  show(
    links: HTMLAnchorElement[],
    position: LinkNumberPosition,
    keys: 'digit' | 'alt' = 'digit',
  ): void {
    this.links = links;
    this.position = position;
    this.keys = keys;
    if (!links.length) return this.hide();
    if (!this.active) {
      this.active = true;
      addEventListener('scroll', this.onMove, { capture: true, passive: true });
      addEventListener('resize', this.onMove, { passive: true });
    }
    this.layer?.replaceChildren();
    this.paint();
  }

  hide(): void {
    if (this.active) {
      removeEventListener('scroll', this.onMove, true);
      removeEventListener('resize', this.onMove);
    }
    this.active = false;
    this.links = [];
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.layer?.remove();
    this.layer = null;
  }

  /** The numbers currently drawn, for tests: [digit, visible]. */
  badges(): Array<{ text: string; hidden: boolean }> {
    return [...(this.layer?.children ?? [])].map((b) => ({
      text: b.textContent ?? '',
      hidden: (b as HTMLElement).style.display === 'none',
    }));
  }

  private schedule(): void {
    if (!this.active || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  }

  private paint(): void {
    const layer = this.ensureLayer();
    this.links.forEach((link, i) => {
      const badge = layer.children[i] ?? layer.appendChild(this.makeBadge(i));
      const rects = link.isConnected && isShown(link) ? [...link.getClientRects()] : [];
      const spot = badgeSpot(
        rects.filter((r) => r.width > 0 && r.height > 0),
        this.position,
      );
      const s = (badge as HTMLElement).style;
      if (!spot) {
        s.display = 'none';
        return;
      }
      s.display = 'block';
      s.left = `${spot.x}px`;
      s.top = `${spot.y}px`;
      s.transform = this.position === 'right' ? 'none' : 'translateX(-100%)';
    });
  }

  private makeBadge(index: number): HTMLElement {
    const b = document.createElement('span');
    b.textContent = `[${digitOf(index)}]`;
    b.title = hint.linkNumber(digitOf(index), this.keys);
    // The layer ignores the pointer; the badge itself must not, or its tooltip could never show.
    b.style.cssText =
      'position:fixed;display:none;pointer-events:auto;font:700 10px/1.2 system-ui,sans-serif;' +
      'padding:0 2px;border-radius:2px;background:var(--rescue-badge-bg,#c23c00);color:var(--rescue-badge-fg,#fff);white-space:nowrap';
    return b;
  }

  private ensureLayer(): HTMLElement {
    if (this.layer?.isConnected) return this.layer;
    const layer = this.layer ?? document.createElement('div');
    if (!this.layer) {
      layer.id = LAYER_ID;
      layer.className = 'rescue-overlay';
      layer.setAttribute('aria-hidden', 'true');
      layer.style.cssText =
        'position:fixed;top:0;left:0;width:0;height:0;z-index:2147482999;pointer-events:none';
    }
    this.layer = layer;
    document.body.appendChild(layer);
    return layer;
  }
}
