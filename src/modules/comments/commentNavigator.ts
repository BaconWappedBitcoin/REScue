/**
 * commentNavigator (RES commentNavigator, US6): a small floating panel, closed until opened from the REScue menu (or Shift+N), with a
 * category (all, OP, answered by OP, me, moderators, admins, friends, tagged users, popular, with
 * images, with videos, new), previous / next buttons and a "3/12" position that jumps back to the
 * last comment reached when clicked. A step selects the matching comment through the same
 * selection the keyboard commands use, so the outline and scrolling follow. N (shift+n) shows or
 * hides the widget, shift+up / shift+down step it, and "skip read" leaves out comments that were
 * already there at the previous visit. It only appears on thread pages.
 * Ported in spirit from RES lib/modules/commentNavigator.js (GPL-3.0, the RES contributors, commit
 * 4defffc); the code is new.
 */
import { onCommand, type CommandRequest } from '../../core/commandEvents';
import { h } from '../../core/dom';
import { hint, label } from '../../core/hints';
import { ensureTheme } from '../../core/theme';
import { resolveOptions } from '../../core/settings';
import { defineModule, type ModuleContext } from '../../core/types';
import type { Comment } from '../../model/types';
import { commentUpvoted } from '../../model/commentRow';
import { sanitizeTags, tagKey } from '../users/tagStore';
import { userHighlight } from '../users/userHighlight';
import { onClick } from './commentUi';
import {
  NAV_CATEGORIES,
  answeredByOp,
  matchesCategory,
  positionLabel,
  stepTarget,
  type NavCategory,
  type NavItem,
  type NavSets,
} from './navigatorFilters';
import { conditionTest } from './navigatorConditions';
import { isNewComment, isReadComment, sharedReadStore } from './readTracking';

interface State {
  ctx: ModuleContext;
  root: HTMLElement;
  select: HTMLSelectElement;
  skipRead: HTMLInputElement;
  position: HTMLButtonElement;
  sets: NavSets;
  pending: boolean;
  /** When the last batch-driven recount ran (performance.now()), for throttling. */
  lastRecount: number;
  /** The trailing recount waiting for a burst of batches to pause. */
  timer: ReturnType<typeof setTimeout> | null;
  /** The widget is shown (it is still hidden outside thread pages). */
  open: boolean;
  /** The last comment the navigator landed on (or the reader selected among the matches). */
  last: string | null;
  stopSelection: () => void;
  stopCommands: () => void;
  /** Highlighted users (User highlighting's own list) as last seen, to notice a new one. */
  friendNames: Set<string>;
  /** The custom category has a valid condition. */
  customReady: boolean;
  removeMenu: () => void;
  style: HTMLStyleElement;
  resize?: ResizeObserver;
}

const NAV_CSS = [
  '.rescue-comment-nav{position:fixed;right:12px;bottom:calc(var(--rescue-stack-h,40px) + 20px);',
  'z-index:2147483641;display:flex;flex-wrap:wrap;gap:4px;align-items:center;max-width:min(340px,calc(100vw - 24px));',
  'box-sizing:border-box;padding:4px 6px;background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);',
  'border:1px solid var(--rescue-border,#ccc);border-radius:4px;box-shadow:0 2px 8px var(--rescue-shadow,rgba(0,0,0,.25));',
  'font:12px/1.3 system-ui,sans-serif}',
  '.rescue-comment-nav[hidden]{display:none!important}',
  '.rescue-comment-nav select{font:12px/1.3 system-ui,sans-serif;height:auto;width:auto;max-width:11em;margin:0;',
  'padding:1px 2px;background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc);border-radius:3px}',
  '.rescue-comment-nav button{font:inherit;color:inherit;background:none;border:0;padding:0 3px;cursor:pointer;text-decoration:underline}',
  '.rescue-comment-nav label{display:inline-flex;align-items:center;gap:2px;white-space:nowrap}',
].join('');

let state: State | null = null;

const isCategory = (v: string): v is NavCategory => NAV_CATEGORIES.some((c) => c.value === v);
const onThread = (s: State): boolean => s.ctx.route.kind === 'thread';

function emptySets(ctx: ModuleContext): NavSets {
  return {
    friends: new Set(),
    tagged: new Set(),
    popularScore: ctx.options.popularScore as number,
    isNew: () => false,
  };
}

/** Friends, tagged users, the user's own name and the previous visit as they are right now. */
async function refreshSets(s: State): Promise<void> {
  const { ctx } = s;
  const hl = resolveOptions(userHighlight, ctx.settings.profile());
  const friends = hl.friends;
  const tags = sanitizeTags(await ctx.data.get<unknown>('userTags'));
  const store = sharedReadStore();
  const prior = store?.prior(ctx.route.postId ?? '');
  s.sets = {
    friends: new Set(friends.map(tagKey).filter(Boolean)),
    tagged: new Set(
      Object.entries(tags)
        .filter(([, t]) => t.text)
        .map(([k]) => k),
    ),
    popularScore: ctx.options.popularScore as number,
    isNew: (c) => isNewComment(prior, c.created),
    me: ctx.session.username?.toLowerCase() ?? null,
    isRead: (c) => isReadComment(prior, c.created),
    highlighted: new Set((hl.highlighted ?? []).map(tagKey).filter(Boolean)),
    upvoted: (c) => commentUpvoted(c.source) === true,
  };
  const input = {
    ctx,
    friends: s.sets.friends,
    tags,
    prior: store ? prior : null,
  };
  const popular = conditionTest(String(ctx.options.popularConditions ?? ''), input);
  if (popular && 'test' in popular) s.sets.isPopular = popular.test;
  const custom = conditionTest(String(ctx.options.customConditions ?? ''), input);
  if (custom && 'test' in custom) s.sets.custom = custom.test;
  s.customReady = !!custom && 'test' in custom;
  const opt = [...s.select.options].find((o) => o.value === 'custom');
  if (opt) opt.hidden = opt.disabled = !s.customReady;
  const bad = [popular, custom].find((r) => r && 'error' in r);
  if (bad && 'error' in bad) {
    ctx.notices.show(`Comment navigator: ${bad.error}`, { kind: 'warning', id: 'nav-conditions' });
  }
}

/** The users the "highlight" link has marked (lower-cased). */
function highlightedNow(ctx: ModuleContext): Set<string> {
  const list = resolveOptions(userHighlight, ctx.settings.profile()).highlighted ?? [];
  return new Set(list.map(tagKey).filter(Boolean));
}

/** The `nav [category]` command: open the widget, on the category if one was named. */
function handleCommand(s: State, req: CommandRequest): void {
  if (req.name !== 'nav') return;
  req.handled = true;
  if (!onThread(s)) {
    req.message = 'REScue: the comment navigator works on a post’s comment page.';
    return;
  }
  if (req.arg) {
    const opt = [...s.select.options].find((o) => o.value === req.arg && !o.disabled);
    if (!opt) {
      req.message = `REScue: the “${req.arg}” category is not available${req.arg === 'custom' ? ' (set its conditions in the navigator settings)' : req.arg === 'new' ? ' (it needs “Read comments”)' : ''}.`;
      return;
    }
    s.select.value = req.arg;
    s.last = null;
  }
  showWidget(s, true);
  void refreshSets(s).then(() => render(s));
}

function category(s: State): NavCategory {
  return isCategory(s.select.value) ? s.select.value : 'op';
}

/** The page's comments in document order with whether each matches the chosen category. */
function items(s: State): NavItem[] {
  const cat = category(s);
  const comments = s.ctx.ui
    .selection()
    .list()
    .filter((i) => i.kind === 'comment');
  s.sets.answered = answeredByOp(comments.map((i) => i.model as Comment));
  const skip = s.skipRead.checked;
  return comments.map((i) => {
    const c = i.model as Comment;
    const read = skip && !!s.sets.isRead?.(c);
    return { id: i.id, match: !read && matchesCategory(c, cat, s.sets) };
  });
}

function render(s: State): void {
  const matches = items(s)
    .filter((i) => i.match)
    .map((i) => i.id);
  s.position.textContent = positionLabel(
    matches,
    s.last,
    s.ctx.ui.selection().current()?.id ?? null,
  );
  s.position.title = hint.navPosition(s.position.textContent ?? '');
}

/** Tells notices how tall the open navigator is, so they stack above it instead of on top. */
function publishHeight(s: State): void {
  const root = document.documentElement;
  const v = s.root.hidden ? '0px' : `${Math.ceil(s.root.getBoundingClientRect().height) + 8}px`;
  if (root.style.getPropertyValue('--rescue-nav-h') !== v)
    root.style.setProperty('--rescue-nav-h', v);
}

function showWidget(s: State, on: boolean): void {
  s.open = on;
  s.root.hidden = !on || !onThread(s);
  publishHeight(s);
}

async function step(s: State, delta: 1 | -1): Promise<void> {
  await refreshSets(s);
  const sel = s.ctx.ui.selection();
  const target = stepTarget(items(s), sel.current()?.id ?? null, delta);
  if (target) {
    s.last = target;
    sel.select(target);
  }
  render(s);
}

/** Shift+up / shift+down: step, and show the widget if the option says to. */
function keyboardStep(s: State, delta: 1 | -1): void {
  if (!s.open && s.ctx.options.showOnKeyboardMove) showWidget(s, true);
  void step(s, delta);
}

/** Batches closer together than this share one recount: it walks every comment on the page. */
const RECOUNT_GAP_MS = 400;

/**
 * Recount once the pipeline has handed the batch to the selection too. The first batch after a
 * quiet spell recounts at once; while batches keep arriving (endless comments) the recount waits
 * until they pause, so it never lands between a batch arriving and being decorated.
 */
function scheduleRender(s: State): void {
  if (s.pending) return;
  const run = () => {
    s.pending = false;
    s.timer = null;
    s.lastRecount = performance.now();
    if (state === s) render(s);
  };
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  if (performance.now() - s.lastRecount >= RECOUNT_GAP_MS) {
    s.pending = true;
    queueMicrotask(run);
  } else {
    s.timer = setTimeout(run, RECOUNT_GAP_MS);
  }
}

function registerKeys(s: State, ctx: ModuleContext): void {
  const thread = (): boolean => state === s && onThread(s);
  ctx.keys.register({
    id: 'toggleCommentNavigator',
    title: 'Show or hide the comment navigator',
    defaultKeys: ['shift+n'],
    context: 'comments',
    enabled: thread,
    run: () => showWidget(s, !s.open),
  });
  ctx.keys.register({
    id: 'commentNavigatorUp',
    title: 'Comment navigator: previous match',
    defaultKeys: ['shift+arrowup'],
    context: 'comments',
    enabled: thread,
    run: () => keyboardStep(s, -1),
  });
  ctx.keys.register({
    id: 'commentNavigatorDown',
    title: 'Comment navigator: next match',
    defaultKeys: ['shift+arrowdown'],
    context: 'comments',
    enabled: thread,
    run: () => keyboardStep(s, 1),
  });
}

export const commentNavigator = defineModule({
  id: 'commentNavigator',
  resId: 'commentNavigator',
  category: 'comments',
  title: 'Comment navigator',
  description:
    'A small floating panel on thread pages, closed until you choose “Comment navigator” in the REScue menu or press Shift+N: pick all comments, OP, comments OP answered, your own, moderators, admins, friends, tagged users, popular comments, comments with images or videos, comments you upvoted, or new comments, then step to the previous or next one. The position (3/12) jumps back to the last one when clicked. Shift+N shows or hides the panel; Shift+up and Shift+down step. Highlighted users are those you marked with “highlight” on a hover card; Custom appears once you write its conditions below; the command line has “nav [category]”. Admin comments only match if Reddit marks them in a way REScue knows. “Upvoted” needs each comment’s action row, which Reddit loads as it nears the viewport. “New” and “skip read” need “Read comments”.',
  enabledByDefault: true,
  options: {
    showByDefault: {
      type: 'boolean',
      default: false,
      title: 'Show the navigator when a thread opens',
      description: 'Off keeps it closed until you open it from the REScue menu or press Shift+N.',
    },
    showOnKeyboardMove: {
      type: 'boolean',
      default: false,
      title: 'Open it when I step with Shift+up / Shift+down',
    },
    skipRead: {
      type: 'boolean',
      default: false,
      title: 'Skip read comments',
      description: 'Leave out comments that were already there at your previous visit.',
    },
    defaultCategory: {
      type: 'enum',
      default: 'op',
      title: 'Starting category',
      values: NAV_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
    },
    popularConditions: {
      type: 'text',
      default: '',
      title: 'Popular comments: conditions',
      description:
        'Leave blank to use the score above. Or write a condition, like a filteReddit custom comment filter: join with and / or / not and parentheses, e.g. score>=50 and length>20w. Words: score, length (characters, or 20w for words), depth, keyword, user, attr (mod, admin, op, friend, me, tagged), deleted, read, new.',
    },
    customConditions: {
      type: 'text',
      default: '',
      title: 'Custom category: conditions',
      description:
        'Adds a “Custom” category to the navigator that steps through comments matching this condition, e.g. attr:op and length>100. Same words as above (see filteReddit custom comment filters for the full list). Blank hides the category.',
    },
    openOnHighlightUser: {
      type: 'boolean',
      default: true,
      title: 'Open the navigator on “Highlighted users” when I highlight a user',
      description:
        'After you choose “highlight” on a user’s hover card, the navigator opens on that category so you can step through their comments.',
    },
    popularScore: {
      type: 'number',
      default: 100,
      min: 1,
      max: 100000,
      title: 'Score for “popular”',
      description: 'Comments with at least this score count as popular.',
    },
  },

  init(ctx) {
    const select = h('select', {
      'aria-label': 'Comment category',
      class: 'rescue-nav-category',
      title: hint.navCategory,
    });
    const hasReads = sharedReadStore() !== null;
    for (const c of NAV_CATEGORIES) {
      if (c.value === 'new' && !hasReads) continue;
      select.append(h('option', { value: c.value }, c.label));
    }
    const chosen = ctx.options.defaultCategory as string;
    if ([...select.options].some((o) => o.value === chosen)) select.value = chosen;
    const skipRead = h('input', { type: 'checkbox', class: 'rescue-nav-skip-read' });
    skipRead.checked = Boolean(ctx.options.skipRead);
    const skipLabel = h('label', { title: hint.navSkipRead }, skipRead, ' skip read');
    skipLabel.hidden = !hasReads;
    skipRead.title = hint.navSkipRead;
    const prev = h(
      'button',
      { type: 'button', class: 'rescue-nav-prev', title: hint.navPrev },
      label.navPrev,
    );
    const next = h(
      'button',
      { type: 'button', class: 'rescue-nav-next', title: hint.navNext },
      label.navNext,
    );
    prev.setAttribute('aria-label', 'Previous matching comment');
    next.setAttribute('aria-label', 'Next matching comment');
    const position = h('button', {
      type: 'button',
      class: 'rescue-nav-count',
      title: hint.navPosition('none'),
      'aria-live': 'polite',
    });
    position.style.cssText = 'background:none;border:0;padding:0 2px;font:inherit;cursor:pointer';
    const close = h(
      'button',
      { type: 'button', class: 'rescue-nav-close', 'aria-label': 'Close the comment navigator' },
      label.close,
    );
    close.title = hint.navClose;
    const root = h(
      'div',
      { class: 'rescue-comment-nav', title: hint.navRoot },
      select,
      skipLabel,
      prev,
      position,
      next,
      close,
    );
    const style = h('style', { id: 'rescue-nav-css' }, NAV_CSS);
    ensureTheme();
    const s: State = {
      ctx,
      root,
      select,
      skipRead,
      position,
      sets: emptySets(ctx),
      pending: false,
      lastRecount: -Infinity,
      timer: null,
      open: Boolean(ctx.options.showByDefault),
      last: null,
      stopSelection: () => {},
      stopCommands: () => {},
      friendNames: new Set(),
      customReady: false,
      removeMenu: () => {},
      style,
    };
    state = s;
    root.hidden = !s.open || !onThread(s);
    onClick(prev, () => void step(s, -1));
    onClick(next, () => void step(s, 1));
    onClick(close, () => showWidget(s, false));
    onClick(position, () => {
      if (s.last) ctx.ui.selection().select(s.last);
    });
    select.addEventListener('change', () => {
      s.last = null;
      void refreshSets(s).then(() => render(s));
    });
    skipRead.addEventListener('change', () => render(s));
    s.stopSelection = ctx.ui.selection().onChange((item) => {
      if (state !== s || item?.kind !== 'comment') return;
      if (items(s).some((i) => i.id === item.id && i.match)) s.last = item.id;
      render(s);
    });
    registerKeys(s, ctx);
    s.stopCommands = onCommand((req) => handleCommand(s, req));
    (document.body ?? document.documentElement).append(style, root);
    if (typeof ResizeObserver === 'function') s.resize = new ResizeObserver(() => publishHeight(s));
    s.resize?.observe(root);
    publishHeight(s);
    s.removeMenu = ctx.ui.addMenuItem({
      id: 'commentNavigator',
      get label() {
        return s.open ? 'Hide comment navigator' : 'Comment navigator';
      },
      order: 35,
      visible: () => state === s && onThread(s),
      hint: () => hint.menuCommentNavigator(s.open),
      onClick: () => showWidget(s, !s.open),
    });
    s.friendNames = highlightedNow(ctx);
    void refreshSets(s).then(() => render(s));
  },

  onItems(_batch, ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    scheduleRender(s);
  },

  onSettings(ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    const friends = highlightedNow(ctx);
    const added = [...friends].some((f) => !s.friendNames.has(f));
    s.friendNames = friends;
    if (added && ctx.options.openOnHighlightUser && onThread(s)) {
      s.select.value = 'highlighted';
      s.last = null;
      showWidget(s, true);
    }
    void refreshSets(s).then(() => render(s));
  },

  onRoute(route, ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    s.last = null;
    s.root.hidden = !s.open || route.kind !== 'thread';
    publishHeight(s);
    s.position.textContent = '';
    s.position.title = hint.navPosition('none');
    void refreshSets(s);
  },

  dispose() {
    if (state?.timer) clearTimeout(state.timer);
    state?.stopSelection();
    state?.stopCommands();
    state?.removeMenu();
    state?.resize?.disconnect();
    document.documentElement.style.removeProperty('--rescue-nav-h');
    state?.root.remove();
    state?.style.remove();
    state = null;
  },
});
