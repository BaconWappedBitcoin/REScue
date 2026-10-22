/**
 * headerButton: a "REScue" word button in Reddit's header icon strip (next to Create) that opens the
 * REScue menu. While it is in place the floating corner gear is hidden; if Reddit's header changes
 * and the anchor drifts, the button is dropped and the corner gear comes back, so REScue's menu is
 * always reachable (constitution Principle III). The anchor is light DOM (contracts: chromeLive,
 * verified live 2026-10-15); nothing is written into any shadow root.
 */
import { h } from '../../core/dom';
import { hint, label } from '../../core/hints';
import { defineModule } from '../../core/types';
import { headerAnchor } from '../../model/chromeAnchors';
import { removeStyle, setStyle } from './injectedStyle';

export const HEADER_BUTTON_ID = 'rescue-header-button';
export const HEADER_ATTR = 'data-rescue-header-button';
const STYLE_ID = 'rescue-header-button-css';
const CHECK_MS = 400;

const CSS = [
  `html[${HEADER_ATTR}] #rescue-gear{display:none !important}`,
  `html[${HEADER_ATTR}] #rescue-tools .rescue-tool-row:has(> #rescue-gear:only-child){display:none !important}`,
  `#${HEADER_BUTTON_ID}{font:inherit;font-size:12px;font-weight:600;color:inherit;cursor:pointer;` +
    'background:none;border:1px solid currentColor;border-radius:14px;padding:3px 10px;margin:0 4px;' +
    'white-space:nowrap;opacity:.85}' +
    `#${HEADER_BUTTON_ID}:hover,#${HEADER_BUTTON_ID}:focus-visible{opacity:1}`,
].join('\n');

let stop: Array<() => void> = [];

export const headerButton = defineModule({
  id: 'headerButton',
  category: 'appearance',
  title: 'Header button',
  description:
    'Adds a “REScue” button to Reddit’s header, next to Create, that opens the REScue menu. While it is there the floating corner button is hidden; if Reddit’s header changes and the button cannot be placed, the corner button comes back. Turn this off to keep only the corner button.',
  enabledByDefault: true,
  options: {},

  init(ctx) {
    setStyle(STYLE_ID, CSS);
    const btn = h(
      'button',
      {
        id: HEADER_BUTTON_ID,
        type: 'button',
        title: hint.headerButton,
        'aria-label': 'REScue menu',
        'aria-haspopup': 'menu',
      },
      label.gear,
    );
    btn.addEventListener('click', () => ctx.ui.openMenu(btn));

    /** Where the button was last put (null: not in place). */
    let placedBefore: Element | null = null;
    let placedStrip: Element | null = null;
    const sync = (): void => {
      const anchor = headerAnchor();
      placedBefore = anchor?.before ?? null;
      placedStrip = anchor?.strip ?? null;
      if (!anchor) {
        btn.remove();
        document.documentElement.removeAttribute(HEADER_ATTR);
        return;
      }
      if (btn.nextElementSibling !== anchor.before || btn.parentElement !== anchor.strip) {
        anchor.before.before(btn);
      }
      document.documentElement.setAttribute(HEADER_ATTR, '');
    };
    sync();
    /**
     * Still right before the element it was put before, and nothing changed in that part of the
     * header: a burst elsewhere on the page (a thread loading its comments) is no news.
     */
    const unaffected = (records: readonly MutationRecord[]): boolean =>
      !!placedBefore &&
      !!placedStrip &&
      btn.isConnected &&
      placedBefore.isConnected &&
      btn.nextElementSibling === placedBefore &&
      !records.some((r) => placedStrip!.contains(r.target));

    // Reddit re-renders its header; a cheap check after a burst of changes keeps the button honest.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const mo = new MutationObserver((records) => {
      if (timer || unaffected(records)) return;
      timer = setTimeout(() => {
        timer = null;
        sync();
      }, CHECK_MS);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    stop.push(
      () => mo.disconnect(),
      () => {
        if (timer) clearTimeout(timer);
        btn.remove();
        document.documentElement.removeAttribute(HEADER_ATTR);
      },
    );
  },

  onSettings() {},

  dispose() {
    for (const s of stop) s();
    stop = [];
    removeStyle(STYLE_ID);
  },
});
