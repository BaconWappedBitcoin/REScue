/**
 * hideLinks (RES betteReddit "hide link"): an optional "hide" word in each post's credit bar that
 * hides the post on Reddit through Reddit's own Hide row, so it stays gone on the account. Off by
 * default (RES had fixHideLinks on; here it is opt-in). hideLinkInstant hides at once; otherwise the
 * post fades and is hidden after hideLinkFadeDelay milliseconds, as RES did. REScue's own click never
 * opens the post. Ported in spirit from RES lib/modules/betteReddit.js (GPL-3.0, the RES
 * contributors, commit 4defffc); the code is new.
 */
import { hint } from '../../core/hints';
import { defineModule, type ModuleContext } from '../../core/types';
import type { Post } from '../../model/types';
import { onClick, linkButton } from '../comments/commentUi';

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** What Reddit hides: the feed's <article> around the post, else the post element itself. */
function wrapperOf(source: Element): HTMLElement | null {
  return (source.closest('article') ?? source) as HTMLElement;
}

/** Hide one post through Reddit's own menu; on failure, undo the fade and say so. */
async function hideNow(ctx: ModuleContext, post: Post): Promise<void> {
  const wrapper = wrapperOf(post.source);
  const r = await ctx.actions.hide({ id: post.id, source: post.source }, true);
  if (!r.ok) {
    if (wrapper) {
      wrapper.style.removeProperty('transition');
      wrapper.style.removeProperty('opacity');
    }
    ctx.notices.show(
      r.reason === 'signed-out'
        ? 'Sign in to Reddit to hide this post there.'
        : 'REScue could not hide this post on Reddit.',
      { id: 'hide-link-result', kind: 'warning', timeoutMs: 6000 },
    );
  }
}

/** The credit-bar "hide" word for one post. */
function hideButton(ctx: ModuleContext, post: Post): HTMLButtonElement {
  const delay = Math.max(0, Number(ctx.options.hideLinkFadeDelay) || 0);
  const instant = ctx.options.hideLinkInstant === true;
  const title = instant ? hint.hidePost : hint.hidePostFading((delay / 1000).toFixed(0));
  const btn = linkButton('rescue-hide-link', 'hide', title);
  onClick(btn, () => {
    if (instant || delay === 0) {
      void hideNow(ctx, post);
      return;
    }
    const wrapper = wrapperOf(post.source);
    if (wrapper) {
      wrapper.style.transition = 'opacity 0.4s';
      wrapper.style.opacity = '0';
    }
    timers.set(
      post.id,
      setTimeout(() => {
        timers.delete(post.id);
        void hideNow(ctx, post);
      }, delay),
    );
  });
  return btn;
}

export const hideLinks = defineModule({
  id: 'hideLinks',
  category: 'listings',
  title: 'Hide buttons on posts',
  description:
    'Adds a small “hide” word to every post in a listing. Clicking it hides the post on Reddit through Reddit’s own Hide, so it stays hidden on your account everywhere you sign in (not only on this device). Off by default; you can choose to hide at once or after a short fade. Needs you to be signed in to Reddit.',
  enabledByDefault: false,
  options: {
    fixHideLinks: {
      type: 'boolean',
      default: false,
      title: 'Add a “hide” button to every post',
      description: 'The button sits in the post’s credit bar, after the time.',
    },
    hideLinkInstant: {
      type: 'boolean',
      default: false,
      title: 'Hide at once',
      dependsOn: 'fixHideLinks',
    },
    hideLinkFadeDelay: {
      type: 'number',
      default: 5000,
      min: 0,
      max: 60000,
      title: 'Fade-out delay (milliseconds)',
      description: 'How long the post fades before it is hidden.',
      dependsOn: 'fixHideLinks',
    },
  },

  onItems(batch, ctx) {
    if (!ctx.options.fixHideLinks) return;
    for (const p of batch.posts) ctx.ui.decorate(p, 'tagline', hideButton(ctx, p));
  },

  dispose() {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  },
});
