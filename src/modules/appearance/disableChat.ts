/**
 * disableChat (RES disableChat, US8): hides the chat entry points in Reddit's header, badge
 * included, with one REScue stylesheet. Ported in spirit from RES lib/modules/disableChat.js
 * (GPL-3.0, the RES contributors, commit 4defffc); the code is new. RES also blocked chat's
 * scripts from loading; REScue does not touch Reddit's scripts, so chat itself keeps working if you
 * open it by other means. The selectors are candidates (contracts: chrome.chatEntry): they match
 * only the header's light DOM, and nothing is hidden if Reddit keeps the button inside a closed
 * shadow root. The rest of the page is never hidden.
 */
import { defineModule } from '../../core/types';
import { chatEntrySelector } from '../../model/appearance';
import { removeStyle, setStyle } from './injectedStyle';

const STYLE_ID = 'rescue-disable-chat';

/** The stylesheet text: every chat entry point in the header, hidden. */
export const chatCss = (): string => `${chatEntrySelector()} { display: none !important; }`;

export const disableChat = defineModule({
  id: 'disableChat',
  resId: 'disableChat',
  category: 'appearance',
  title: 'Hide chat',
  description:
    'Hides the chat button and its unread badge in Reddit’s header. It only hides the button; chat is not blocked from loading or working. REScue could not yet confirm the button’s markup on the live page, so it may not match.',
  enabledByDefault: false,
  options: {},

  init() {
    setStyle(STYLE_ID, chatCss());
  },

  onSettings() {
    setStyle(STYLE_ID, chatCss());
  },

  dispose() {
    removeStyle(STYLE_ID);
  },
});
