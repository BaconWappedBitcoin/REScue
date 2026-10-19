/**
 * Keyboard actions (RES keyboardNav "upVote"/"downVote"/"reply"/"edit", US7 / T131): act on the
 * selected post or comment by pressing Reddit's own controls through ActionApi.
 *
 * Voting (a / z, shift+a / shift+z) works on posts and comments. Pressing the key for the vote that
 * is already on clears it, as in RES. Success is never shown by REScue: Reddit's own arrow is the
 * confirmation, and REScue only speaks up when the vote did not go through.
 *
 * Reply (r) and edit (e) work on the selected comment: REScue presses Reddit's own Reply button, or
 * the Edit item of the comment's menu (your own comments only), then focuses Reddit's reply box. It
 * never types into it. RES binds `r` to reply on threads and to "go to subreddit" elsewhere; REScue
 * does the same: on a thread with a comment selected `r` replies, and with a post selected (or on a
 * listing) it still goes to the subreddit (keyboardNav's followSubreddit steps aside for comments).
 *
 * Save (s) and hide (h) press the Save / Hide row of the selected item's own overflow menu on
 * Reddit, so the change follows the account; pressing the key again unsaves. RES's key for saving a
 * COMMENT is Shift+S, which REScue already uses for its own local "save-RES"; that key is taken, so
 * Reddit's comment save is Ctrl+S here (a deliberate, documented difference). `onHideMoveDown`
 * (default on) selects the next post after a confirmed hide, as in RES.
 */
import type { ActionResult, VoteState } from '../../core/actions';
import { defineModule, type ModuleContext } from '../../core/types';
import type { Comment, Post } from '../../model/types';
import { recordVotes } from '../users/userTagger';
import { voteDeltas } from '../users/voteCounter';

type Failure = Exclude<ActionResult, { ok: true }>;

const FAILURE_TEXT: Record<Failure['reason'], string> = {
  'signed-out': 'Sign in to Reddit to vote.',
  'not-found': 'REScue could not find Reddit’s vote buttons for this item.',
  timeout: 'Reddit did not confirm the vote; it may not have gone through.',
  rejected: 'Still waiting for the previous vote on this item.',
};

function failureText(r: Failure, what: 'vote' | 'reply' | 'edit' | 'save' | 'hide'): string {
  const extra = r.detail && r.reason === 'not-found' ? ` (${r.detail})` : '';
  if (what === 'vote') return FAILURE_TEXT[r.reason] + extra;
  if (what === 'save' || what === 'hide') {
    const verb = what === 'save' ? 'save' : 'hide';
    switch (r.reason) {
      case 'signed-out':
        return `Sign in to Reddit to ${verb} this.`;
      case 'rejected':
        return `Still working on the previous ${verb} for this item.`;
      case 'timeout':
        return `Reddit did not confirm the ${verb}; it may not have gone through.`;
      default:
        return `REScue could not find Reddit’s ${what === 'save' ? 'Save' : 'Hide'} item for this item${extra}.`;
    }
  }
  const verb = what === 'reply' ? 'reply' : 'edit';
  switch (r.reason) {
    case 'signed-out':
      return what === 'reply' ? 'Sign in to Reddit to reply.' : 'Sign in to Reddit to edit.';
    case 'rejected':
      return r.detail === 'not-editable'
        ? 'You can only edit your own comments.'
        : `Still working on the previous ${verb} for this comment.`;
    case 'timeout':
      return `Reddit’s ${what === 'reply' ? 'reply' : 'edit'} box did not open or take the focus; press Reddit’s own button instead.`;
    default:
      return what === 'reply'
        ? `REScue could not find Reddit’s Reply button for this comment${extra}.`
        : `REScue could not find Reddit’s Edit item for this comment${extra}.`;
  }
}

async function voteSelected(ctx: ModuleContext, dir: 1 | -1, toggle: boolean): Promise<void> {
  const item = ctx.ui.selection().current();
  const model = item?.model as Post | Comment | undefined;
  if (!item || !model) return;
  // ctx.session is a start-up snapshot; ActionApi checks the live session and clicks nothing
  // when signed out.
  const target = { id: model.id, source: model.source };
  const before: VoteState = await ctx.actions.voteState(target);
  // The plain key pressed again clears the vote (RES behaviour); the shift key only ever sets it.
  const want = toggle && before === dir ? 0 : dir;
  const r = await ctx.actions.vote(target, want);
  if (!r.ok) {
    ctx.notices.show(failureText(r, 'vote'), {
      id: 'vote-result',
      kind: 'warning',
      timeoutMs: 6000,
    });
    return;
  }
  // Confirmed: feed the user tagger's up/down counts for this author. The click that did this was
  // made by REScue (not trusted), so the tagger's own arrow-click counting does not see it too.
  if (before !== null && model.author && model.author !== ctx.session.username) {
    const { up, down } = voteDeltas(before, want);
    if (up || down) void recordVotes(model.author, up, down);
  }
  // RES onVoteMoveDown: after a confirmed vote, on to the next item.
  if (ctx.options.moveDownAfterVote) ctx.ui.selection().move(1);
}

/** Reply to (or edit) the selected comment through Reddit's own controls. */
async function composeOnSelected(ctx: ModuleContext, what: 'reply' | 'edit'): Promise<void> {
  const item = ctx.ui.selection().current();
  if (item?.kind !== 'comment') return;
  const model = item.model as Comment;
  const target = { id: model.id, source: model.source };
  const r = await (what === 'reply'
    ? ctx.actions.startReply(target)
    : ctx.actions.startEdit(target));
  if (r.ok) return; // Reddit's own box is open and focused: that is the confirmation.
  ctx.notices.show(failureText(r, what), {
    id: 'compose-result',
    kind: 'warning',
    timeoutMs: 6000,
  });
}

/** Save (or unsave) the selected post / comment on Reddit through its own menu. */
async function saveSelected(ctx: ModuleContext): Promise<void> {
  const item = ctx.ui.selection().current();
  const model = item?.model as Post | Comment | undefined;
  if (!item || !model) return;
  const target = { id: model.id, source: model.source };
  // The key toggles: read Reddit's own row first (Save / Unsave) and ask for the opposite. An
  // unreadable row means action.save answers not-found, which is reported below.
  const state = await ctx.actions.saveState(target);
  const r = await ctx.actions.save(target, state !== 'on');
  if (!r.ok) {
    ctx.notices.show(failureText(r, 'save'), {
      id: 'save-result',
      kind: 'warning',
      timeoutMs: 6000,
    });
  }
}

/** Hide the selected post on Reddit; onHideMoveDown selects the next one (RES onHideMoveDown). */
async function hideSelected(ctx: ModuleContext): Promise<void> {
  const item = ctx.ui.selection().current();
  if (item?.kind !== 'post') return;
  const model = item.model as Post;
  const target = { id: model.id, source: model.source };
  // Work out the next post BEFORE the hide (the hidden one leaves the page), but select it AFTER:
  // pressing Reddit's menu is a click inside this post, which re-selects it (click selects).
  const list = ctx.ui.selection().list();
  const nextId =
    ctx.options.onHideMoveDown === true ? list[list.indexOf(item) + 1]?.id : undefined;
  const r = await ctx.actions.hide(target, true);
  if (r.ok) {
    if (nextId !== undefined) ctx.ui.selection().select(nextId);
    return;
  }
  ctx.notices.show(failureText(r, 'hide'), {
    id: 'hide-result',
    kind: 'warning',
    timeoutMs: 6000,
  });
}

const VOTE_KEYS = [
  { id: 'upvote', title: 'Upvote (again to clear)', keys: ['a'], dir: 1, toggle: true },
  { id: 'downvote', title: 'Downvote (again to clear)', keys: ['z'], dir: -1, toggle: true },
  { id: 'upvoteSet', title: 'Upvote without toggling', keys: ['shift+a'], dir: 1, toggle: false },
  {
    id: 'downvoteSet',
    title: 'Downvote without toggling',
    keys: ['shift+z'],
    dir: -1,
    toggle: false,
  },
] as const;

export const keyboardActions = defineModule({
  id: 'keyboardActions',
  resId: 'keyboardNav',
  category: 'actions',
  title: 'Keyboard voting and replying',
  description:
    'Vote on the selected post or comment from the keyboard (a = upvote, z = downvote; press again to clear; shift+a and shift+z set the vote without clearing it). On a selected comment, r opens Reddit’s reply box and e opens the editor on your own comment; REScue presses Reddit’s own buttons and focuses the box, and never types in it. On a thread with a comment selected r replies; otherwise r still goes to the subreddit. REScue only counts a vote once Reddit shows it. Requires being signed in to Reddit. A comment’s buttons appear as it scrolls into view, so the first key press on a far-away comment may take a moment.',
  enabledByDefault: true,
  options: {
    moveDownAfterVote: {
      type: 'boolean',
      default: false,
      title: 'Move to the next post or comment after voting',
    },
    onHideMoveDown: {
      type: 'boolean',
      default: true,
      title: 'Move to the next post after hiding it',
    },
  },
  init(ctx) {
    const hasSelection = () => ctx.ui.selection().current() !== null;
    const commentSelected = () => ctx.ui.selection().current()?.kind === 'comment';
    const postSelected = () => ctx.ui.selection().current()?.kind === 'post';
    for (const v of VOTE_KEYS) {
      ctx.keys.register({
        id: v.id,
        title: v.title,
        defaultKeys: [...v.keys],
        section: 'Vote',
        enabled: hasSelection,
        run: () => void voteSelected(ctx, v.dir, v.toggle),
      });
    }
    ctx.keys.register({
      id: 'replyToComment',
      title: 'Reply to the selected comment',
      defaultKeys: ['r'],
      context: 'comments',
      section: 'Vote',
      enabled: commentSelected,
      run: () => void composeOnSelected(ctx, 'reply'),
    });
    ctx.keys.register({
      id: 'editComment',
      title: 'Edit your selected comment',
      defaultKeys: ['e'],
      context: 'comments',
      section: 'Vote',
      enabled: commentSelected,
      run: () => void composeOnSelected(ctx, 'edit'),
    });
    ctx.keys.register({
      id: 'savePost',
      title: 'Save the selected post (again to unsave)',
      defaultKeys: ['s'],
      section: 'Save',
      enabled: postSelected,
      run: () => void saveSelected(ctx),
    });
    ctx.keys.register({
      id: 'saveComment',
      // RES saves a comment with Shift+S, which REScue's own save-RES already owns: Ctrl+S here.
      title: 'Save the selected comment on Reddit (again to unsave)',
      defaultKeys: ['ctrl+s'],
      context: 'comments',
      section: 'Save',
      enabled: commentSelected,
      run: () => void saveSelected(ctx),
    });
    ctx.keys.register({
      id: 'hide',
      title: 'Hide the selected post on Reddit',
      defaultKeys: ['h'],
      section: 'Save',
      enabled: postSelected,
      run: () => void hideSelected(ctx),
    });
  },
});
