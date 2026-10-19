/**
 * redditUserInfo (RES redditUserInfo: hideAuthorTooltip): hide Reddit's own card that opens when
 * you hover a post author's name. Off by default. When it is on, a switch in the REScue menu shows
 * the cards again without opening settings (constitution: a hidden slot always has a visible way
 * back). The card is Reddit's light-DOM `faceplate-hovercard`; REScue hides only its content slot
 * with one stylesheet rule and never touches its insides. Note that REScue's own tag / ignore /
 * highlight buttons live in that card (hoverCardActions), so they are hidden with it. Ideas from RES
 * lib/modules/redditUserInfo.js (GPL-3.0, the RES contributors, commit 4defffc); new code.
 */
import { hint } from '../../core/hints';
import { defineModule, type ModuleContext } from '../../core/types';
import { userHoverCardContentSelector } from '../../model/chromeAnchors';
import { removeStyle, setStyle } from '../appearance/injectedStyle';

export const STYLE_ID = 'rescue-hide-author-card';
/** Shown again for this page only through the menu switch (not saved). */
let showAgain = false;
let removeMenu: (() => void) | null = null;

function apply(ctx: ModuleContext): void {
  const hidden = ctx.options.hideAuthorTooltip === true && !showAgain;
  setStyle(STYLE_ID, hidden ? `${userHoverCardContentSelector()}{display:none !important}` : '');
  removeMenu?.();
  removeMenu = null;
  if (ctx.options.hideAuthorTooltip !== true) return;
  removeMenu = ctx.ui.addMenuItem({
    id: 'redditUserInfo:cards',
    label: 'Reddit’s user cards',
    order: 60,
    hint: () => hint.userCardsSwitch(!showAgain),
    onClick: () => {},
    toggle: {
      get: () => showAgain,
      set(on) {
        showAgain = on;
        apply(ctx);
      },
    },
  });
}

export const redditUserInfo = defineModule({
  id: 'redditUserInfo',
  resId: 'redditUserInfo',
  category: 'users',
  title: 'Reddit’s user cards',
  description:
    'Hides the card Reddit opens when you hover a post author’s name (karma, cake day). While it is hidden, a “Reddit’s user cards” switch in the REScue menu shows them again. REScue’s tag / ignore / highlight buttons are in that card, so they hide with it.',
  enabledByDefault: true,
  options: {
    hideAuthorTooltip: {
      type: 'boolean',
      default: false,
      title: 'Hide the card that opens over an author’s name',
    },
  },
  init(ctx) {
    showAgain = false;
    apply(ctx);
  },
  onSettings: apply,
  dispose() {
    removeMenu?.();
    removeMenu = null;
    showAgain = false;
    removeStyle(STYLE_ID);
  },
});
