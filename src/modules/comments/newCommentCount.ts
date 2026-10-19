/**
 * newCommentCount (RES newCommentCount, US6): on listings, "(N new)" after a post's time when the
 * thread has gained comments since you last opened it; in a thread, a "new" marker beside the author
 * of every comment created after your previous visit, with a count in REScue's tool strip. Works
 * from the ReadRecords readComments keeps. Ported in spirit from RES lib/modules/newCommentCount.js
 * (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */
import { h } from '../../core/dom';
import { hint } from '../../core/hints';
import { defineModule, type ModuleContext } from '../../core/types';
import { panel, pill } from './commentUi';
import { isNewComment, newCommentCount as countNew, sharedReadStore } from './readTracking';

interface State {
  count: number;
  banner: HTMLElement;
  text: HTMLElement;
  added: boolean;
}

let state: State | null = null;

const plural = (n: number) => (n === 1 ? '1 new comment' : `${n} new comments`);

function visitText(at: number): string {
  return new Date(at).toLocaleString();
}

function bump(ctx: ModuleContext, s: State): void {
  s.text.textContent = `${plural(s.count)} since your last visit`;
  s.banner.hidden = s.count === 0;
  if (s.count > 0 && !s.added) {
    s.added = true;
    ctx.ui.addBanner(s.banner);
  }
}

export const newCommentCount = defineModule({
  id: 'newCommentCount',
  resId: 'newCommentCount',
  category: 'comments',
  title: 'New comment count',
  description:
    'Shows “(N new)” after a post’s time on listings when it has gained comments since you last opened it, and marks comments added since your last visit inside a thread. Needs “Read comments”. Only threads opened since then are known, and the first visit shows nothing as new.',
  enabledByDefault: true,
  dependsOn: ['readComments'],
  options: {
    showOnListings: { type: 'boolean', default: true, title: 'Show “(N new)” on listings' },
    markComments: {
      type: 'boolean',
      default: true,
      title: 'Mark new comments inside a thread',
    },
    showCount: {
      type: 'boolean',
      default: true,
      title: 'Show how many comments are new',
      dependsOn: 'markComments',
    },
  },

  init() {
    const text = h('span', { class: 'rescue-new-count-text' });
    const banner = panel(
      h(
        'div',
        { class: 'rescue-new-banner', role: 'status', hidden: true, title: hint.newBanner },
        text,
      ),
    );
    state = { count: 0, banner, text, added: false };
  },

  onItems(batch, ctx) {
    const s = state;
    const store = sharedReadStore();
    if (!s || !store) return;
    const me = ctx.session.username?.toLowerCase();
    if (ctx.options.showOnListings && ctx.route.kind !== 'thread') {
      for (const p of batch.posts) {
        const n = countNew(store.prior(p.id), p.commentCount);
        if (n > 0) {
          ctx.ui.decorate(p, 'tagline', pill('rescue-new-count', `(${n} new)`, hint.newCount(n)));
        }
      }
    }
    if (!ctx.options.markComments || ctx.route.kind !== 'thread') return;
    for (const c of batch.comments) {
      const prior = store.prior(ctx.route.postId ?? c.postId ?? '');
      if (!isNewComment(prior, c.created)) continue;
      if (me && c.author?.toLowerCase() === me) continue;
      ctx.ui.decorate(
        c,
        'author',
        pill('rescue-new-comment', 'new', hint.newMarker(visitText(prior!.lastVisit))),
      );
      s.count++;
    }
    if (ctx.options.showCount) bump(ctx, s);
  },

  onRoute(_route, ctx) {
    const s = state;
    if (!s) return;
    s.count = 0;
    bump(ctx, s);
  },

  dispose() {
    state?.banner.remove();
    state = null;
  },
});
