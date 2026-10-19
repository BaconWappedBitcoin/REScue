/**
 * pageNavigator (RES pageNavigator, US8): a "Back to top" item in REScue's menu. Ported in spirit
 * from RES lib/modules/pageNavigator.js (GPL-3.0, the RES contributors, commit 4defffc); the code
 * is new. RES also had "jump to the new comment box" and a pinned post-title bar; Reddit keeps the
 * comment box and a sticky header of its own, so those are not built.
 */
import { hint } from '../../core/hints';
import { defineModule } from '../../core/types';
import { commentComposer, firstCommentElement } from '../../model/appearance';

let removeMenu: (() => void) | null = null;
let removeComment: (() => void) | null = null;

/** Reddit's comment box, else the first comment; null when the page has neither. */
const jumpTarget = (): Element | null => commentComposer() ?? firstCommentElement();

export const pageNavigator = defineModule({
  id: 'pageNavigator',
  resId: 'pageNavigator',
  category: 'appearance',
  title: 'Back to top',
  description:
    'Adds a “Back to top” item to the REScue menu that scrolls the page back to the top. (RES’s jump-to-comment-box and pinned post title are not built: Reddit has its own.)',
  enabledByDefault: true,
  options: {
    toComment: {
      type: 'boolean',
      default: true,
      title: 'Add “Jump to comment box” to the menu',
      description:
        'On a thread page, scrolls to Reddit’s box for writing a comment (or to the first comment when there is no box).',
    },
  },

  init(ctx) {
    removeMenu = ctx.ui.addMenuItem({
      id: 'backToTop',
      label: 'Back to top',
      order: 50,
      hint: () => hint.backToTop,
      onClick: () => window.scrollTo({ top: 0 }),
    });
    if (ctx.options.toComment) {
      removeComment = ctx.ui.addMenuItem({
        id: 'jumpToCommentBox',
        label: 'Jump to comment box',
        order: 51,
        hint: () => hint.jumpToCommentBox,
        visible: () => /\/comments\//.test(location.pathname) && jumpTarget() !== null,
        onClick: () => jumpTarget()?.scrollIntoView({ block: 'center' }),
      });
    }
  },

  dispose() {
    removeMenu?.();
    removeMenu = null;
    removeComment?.();
    removeComment = null;
  },
});
