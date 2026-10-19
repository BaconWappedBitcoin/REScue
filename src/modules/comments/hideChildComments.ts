/**
 * hideChildComments (RES hideChildComments, US6): a "hide child comments" control on every
 * top-level comment that has replies (and, by option, on nested comments too), plus a menu item in
 * REScue's menu for the whole thread. Only a comment's DIRECT replies are hidden (hide reason
 * "hideChildComments"); on Reddit's nested layout their own replies go with them. The filter notice
 * never counts these, because it counts only the posts filteReddit itself matched. C hides or shows
 * the replies of the selected comment and Shift+C of the whole thread (RES's keys). Ported in
 * spirit from RES lib/modules/hideChildComments.js (GPL-3.0, the RES contributors, commit 4defffc);
 * the code is new.
 */
import { hint } from '../../core/hints';
import { defineModule, type ModuleContext } from '../../core/types';
import type { Comment } from '../../model/types';
import { linkButton, onClick } from './commentUi';

export const HIDE_REASON = 'hideChildComments';

interface Branch {
  top: Comment;
  /** Null until the comment has a reply. */
  toggle: HTMLButtonElement | null;
  /** Direct replies of the comment. */
  replies: Comment[];
  /** Every reply below it, at any depth (for the label). */
  total: number;
  hidden: boolean;
}

interface State {
  ctx: ModuleContext;
  branches: Map<string, Branch>;
  /** comment id -> its parent's id (to count a reply for every ancestor). */
  parentOf: Map<string, string | null>;
  all: boolean;
  thread: boolean;
  removeMenu: () => void;
}

let state: State | null = null;

const label = (b: Branch): string =>
  b.hidden ? `show ${b.total} child comment${b.total === 1 ? '' : 's'}` : 'hide child comments';

/** Does this branch follow the strip button? Nested ones only when "hide nested too" is on. */
const followsAll = (s: State, b: Branch): boolean =>
  b.top.depth === 0 || (Boolean(s.ctx.options.nested) && Boolean(s.ctx.options.hideNested));

function renderLabel(b: Branch): void {
  if (!b.toggle) return;
  b.toggle.hidden = b.total === 0;
  b.toggle.textContent = label(b);
  b.toggle.title = hint.hideChildren(b.hidden, b.total);
  b.toggle.setAttribute('aria-expanded', String(!b.hidden));
}

/** The control's label and the hidden state of the replies, after a toggle. */
function render(s: State, b: Branch): void {
  renderLabel(b);
  for (const r of b.replies) {
    if (b.hidden) s.ctx.ui.hide(r, HIDE_REASON);
    else s.ctx.ui.unhide(r, HIDE_REASON);
  }
}

function setAll(s: State, hidden: boolean): void {
  s.all = hidden;
  for (const b of s.branches.values()) {
    if (!followsAll(s, b)) continue; // a nested comment's own choice stands
    b.hidden = hidden;
    render(s, b);
  }
}

function addBranch(s: State, c: Comment): void {
  const b: Branch = { top: c, toggle: null, replies: [], total: 0, hidden: false };
  b.hidden = s.all && followsAll(s, b);
  s.branches.set(c.id, b);
}

/** The control is made when the first reply arrives, so a comment without replies gets none. */
function ensureToggle(s: State, b: Branch): void {
  if (b.toggle) return;
  const toggle = linkButton('rescue-hide-children', '', hint.hideChildren(b.hidden, b.total));
  b.toggle = toggle;
  onClick(toggle, () => {
    b.hidden = !b.hidden;
    render(s, b);
  });
  s.ctx.ui.decorate(b.top, 'tagline', toggle);
}

/** A reply arrived: hide it if its parent's replies are hidden; count it for every ancestor. */
function addReply(s: State, c: Comment, touched: Set<Branch>): void {
  const direct = c.parentId ? s.branches.get(c.parentId) : undefined;
  if (direct) {
    direct.replies.push(c);
    if (direct.hidden) s.ctx.ui.hide(c, HIDE_REASON);
  }
  const seen = new Set<string>();
  for (let id = c.parentId; id && !seen.has(id); id = s.parentOf.get(id) ?? null) {
    seen.add(id);
    const b = s.branches.get(id);
    if (!b) continue;
    b.total++;
    touched.add(b);
  }
}

/** The selected comment's control (a click on it toggles its replies). */
function selectedBranch(s: State): Branch | undefined {
  const sel = s.ctx.ui.selection().current();
  return sel?.kind === 'comment' ? s.branches.get(sel.id) : undefined;
}

function registerKeys(s: State, ctx: ModuleContext): void {
  const onComment = (): boolean =>
    state === s && s.thread && ctx.ui.selection().current()?.kind === 'comment';
  // Registered ahead of keyboardNav (see modules/index.ts): C only takes the key while a comment
  // is selected in a thread, so on listings it still opens comments.
  ctx.keys.register({
    id: 'toggleChildren',
    title: 'Hide or show the replies to the selected comment',
    defaultKeys: ['c'],
    context: 'comments',
    enabled: onComment,
    run: () => {
      const b = selectedBranch(s);
      if (b && b.total > 0) {
        b.hidden = !b.hidden;
        render(s, b);
      }
    },
  });
  ctx.keys.register({
    id: 'toggleAllChildren',
    title: 'Hide or show all replies in this thread',
    defaultKeys: ['shift+c'],
    context: 'comments',
    enabled: () => state === s && s.thread,
    run: () => setAll(s, !s.all),
  });
}

export const hideChildComments = defineModule({
  id: 'hideChildComments',
  resId: 'hideChildComments',
  category: 'comments',
  title: 'Hide child comments',
  description:
    'Adds “hide child comments” beside each comment that has replies, and a “Hide all replies” item in the REScue menu. Only the replies are hidden, never the comment itself. C hides or shows the replies of the selected comment; Shift+C hides or shows them all.',
  enabledByDefault: true,
  options: {
    startHidden: {
      type: 'boolean',
      default: false,
      title: 'Start with replies hidden',
      description: 'New thread pages open with every top-level comment’s replies hidden.',
    },
    nested: {
      type: 'boolean',
      default: true,
      title: 'Also on nested comments',
      description:
        'Add the control to replies that have replies of their own, not only to top-level comments.',
    },
    hideNested: {
      type: 'boolean',
      default: false,
      title: 'Hide nested replies too',
      description:
        'The “hide all replies” button and the start-hidden option also hide the replies of nested comments.',
      dependsOn: 'nested',
    },
  },

  init(ctx) {
    const thread = ctx.route.kind === 'thread';
    const s: State = {
      ctx,
      branches: new Map(),
      parentOf: new Map(),
      all: false,
      thread,
      removeMenu: () => {},
    };
    state = s;
    setAll(s, Boolean(ctx.options.startHidden));
    registerKeys(s, ctx);
    s.removeMenu = ctx.ui.addMenuItem({
      id: 'hideAllReplies',
      get label() {
        return s.all ? 'Show all replies' : 'Hide all replies';
      },
      order: 30,
      visible: () => state === s && s.thread,
      hint: () => hint.hideAllReplies(s.all),
      onClick: () => setAll(s, !s.all),
    });
  },

  onItems(batch, ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    const nested = Boolean(ctx.options.nested);
    const touched = new Set<Branch>();
    for (const c of batch.comments) {
      s.parentOf.set(c.id, c.parentId);
      addReply(s, c, touched);
      if (c.depth === 0 || nested) addBranch(s, c);
    }
    for (const b of touched) {
      ensureToggle(s, b);
      renderLabel(b);
    }
  },

  onRoute(route, ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    s.branches.clear();
    s.parentOf.clear();
    s.thread = route.kind === 'thread';
    setAll(s, Boolean(ctx.options.startHidden));
  },

  dispose() {
    state?.removeMenu();
    state = null;
  },
});
