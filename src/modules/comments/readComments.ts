/**
 * readComments (RES readComments, US6): remember, on this device only, that you opened a thread and
 * how many comments it had. That record (a ReadRecord per thread, pruned after 90 days or beyond
 * 50,000 threads) is what newCommentCount, autoHide and the comment navigator's "new" and "skip
 * read" read. On a revisit, a notice offers "Hide read comments": the comments that were already
 * there at the last visit are hidden (reason "readComments"), and "Unhide" brings them back. A read
 * comment that has a new reply below it stays visible, because hiding it would hide the new reply.
 * Ported in spirit from RES lib/modules/readComments.js (GPL-3.0, the RES contributors, commit
 * 4defffc); the code is new.
 */
import { hint } from '../../core/hints';
import { defineModule, type ModuleContext } from '../../core/types';
import type { Comment } from '../../model/types';
import { closeReadStore, isReadComment, openReadStore, sharedReadStore } from './readTracking';

export const READ_REASON = 'readComments';
const NOTICE_ID = 'readComments-hide';

interface Session {
  comments: Map<string, Comment>;
  hiding: boolean;
  offered: boolean;
}

let session: Session = { comments: new Map(), hiding: false, offered: false };

function fresh(): Session {
  return { comments: new Map(), hiding: false, offered: false };
}

/** Comments that were on the thread at the previous visit, per the recorded visit time. */
function readSet(ctx: ModuleContext): Set<string> {
  const prior = sharedReadStore()?.prior(ctx.route.postId ?? '');
  const out = new Set<string>();
  for (const c of session.comments.values()) if (isReadComment(prior, c.created)) out.add(c.id);
  return out;
}

/** Hide (or show again) every read comment that has no unread comment below it; returns the count hidden. */
function applyHide(ctx: ModuleContext): number {
  const read = readSet(ctx);
  const hasUnreadBelow = new Set<string>();
  for (const c of session.comments.values()) {
    if (read.has(c.id)) continue;
    const seen = new Set<string>();
    for (
      let id = c.parentId;
      id && !seen.has(id);
      id = session.comments.get(id)?.parentId ?? null
    ) {
      seen.add(id);
      hasUnreadBelow.add(id);
    }
  }
  let hidden = 0;
  for (const c of session.comments.values()) {
    if (session.hiding && read.has(c.id) && !hasUnreadBelow.has(c.id)) {
      ctx.ui.hide(c, READ_REASON);
      hidden++;
    } else ctx.ui.unhide(c, READ_REASON);
  }
  return hidden;
}

function offerUnhide(ctx: ModuleContext, hidden: number): void {
  ctx.notices.show(`Hid ${hidden} previously read comment${hidden === 1 ? '' : 's'}.`, {
    id: NOTICE_ID,
    timeoutMs: 30000,
    actions: [
      {
        label: 'Unhide',
        hint: hint.unhideRead,
        run: () => {
          session.hiding = false;
          applyHide(ctx);
        },
      },
    ],
  });
}

function offerHide(ctx: ModuleContext): void {
  ctx.notices.show('Some comments here were already there when you last visited.', {
    id: NOTICE_ID,
    timeoutMs: 15000,
    actions: [
      {
        label: 'Hide read comments',
        hint: hint.hideRead,
        run: () => {
          session.hiding = true;
          offerUnhide(ctx, applyHide(ctx));
        },
      },
    ],
  });
}

export const readComments = defineModule({
  id: 'readComments',
  resId: 'readComments',
  category: 'comments',
  title: 'Read comments',
  description:
    'Remembers, on this device only, which threads you opened and how many comments they had, for “new comment” markers, auto-hide and the comment navigator’s “skip read”. When you come back to a thread, a notice offers to hide the comments you had already seen. Records older than 90 days are dropped. Turn this off to stop recording; the features that need it turn off with it.',
  enabledByDefault: true,
  options: {},

  async init(ctx) {
    session = fresh();
    await openReadStore(ctx.data);
  },

  onItems(batch, ctx) {
    const store = sharedReadStore();
    if (!store || ctx.route.kind !== 'thread') return;
    const post = batch.posts.find((p) => p.id === ctx.route.postId);
    if (post) void store.visit(post.id, post.commentCount);
    for (const c of batch.comments) session.comments.set(c.id, c);
    if (!batch.comments.length) return;
    if (session.hiding) applyHide(ctx);
    else if (!session.offered && readSet(ctx).size) {
      session.offered = true;
      offerHide(ctx);
    }
  },

  onRoute() {
    session = fresh();
    sharedReadStore()?.newView();
  },

  dispose() {
    session = fresh();
    closeReadStore();
  },
});
