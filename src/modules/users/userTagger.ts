/**
 * userTagger (RES userTagger, US5): attach a tag (text, colour, optional link), separate up/down
 * vote counts or an ignore flag to any username. Tags are purely local, work signed out, and show
 * next to every instance of the name on the page, placed inline after Reddit's own author link.
 * Ported in spirit from RES lib/modules/userTagger.js (GPL-3.0, the RES contributors, commit
 * 4defffc); the code is new.
 *
 * Each item gets ONE container node in the 'author' slot; a per-user registry of those containers
 * lets an edit update every visible instance in place (never appending duplicates).
 *
 * Ignore: posts by an ignored user are hidden with a reason (so filteReddit's reveal UI lists
 * them); a comment keeps its replies visible and only its own body is collapsed, with an
 * "[ignored user - show]" toggle.
 *
 * Votes: the reader's clicks on Reddit's own post and comment arrows are counted (voteCounter.ts) and so are
 * the keyboard votes (recordVotes(), called by keyboardActions). A comment's arrows are in its action
 * row's open shadow root (R20); a vote is counted once Reddit's own buttons show it.
 */
import { h } from '../../core/dom';
import { hint, IGNORED_USER, label } from '../../core/hints';
import { setOption } from '../../core/settings';
import { defineModule, type ModuleContext } from '../../core/types';
import { blockedImportAction, runImportBlocked } from './blockedImport';
import { ignoreButton } from './ignoreButton';
import { buildTagChip } from './tagChip';
import { taggerOptionsSchema } from './taggerOptions';
import { STYLE, STYLE_ID } from './taggerStyle';
import { presetRow, presetTagsFrom } from './tagColors';
import { closeTagEditor, openTagEditor, type TagEdit } from './tagEditor';
import { closeTagManager, openTagManager, refreshTagManager, type ManagerHost } from './tagManager';
import {
  absoluteLink,
  adjustVotes,
  formatVotes,
  removeTag,
  sanitizeTags,
  setIgnored,
  pillTextColor,
  setTag,
  setVotes,
  tagKey,
  validColor,
  voteWeightColor,
  type UserTag,
  type UserTags,
} from './tagStore';
import { setTaggerApi } from './taggerApi';
import { attachVoteCounter, type VotedItem } from './voteCounter';

type Kind = 'post' | 'comment' | 'profileComment';
interface Seen {
  id: string;
  kind: Kind;
  author: string;
  container: HTMLElement;
  /** The item's permalink as Reddit gave it (resolved only when the editor opens). */
  permalink: string | null;
}

interface State {
  ctx: ModuleContext;
  tags: UserTags;
  /** lower-case user -> the items rendered for them on this page. */
  seen: Map<string, Seen[]>;
  ids: Set<string>;
  /** Posts this module hid (so un-ignoring never un-hides a filteReddit match). */
  hiddenByUs: Set<string>;
  /** Ignored comments the reader chose to show. */
  expanded: Set<string>;
  /** Post elements -> their id and author, for counting clicks on Reddit's own arrows. */
  /** Post and comment elements, for the vote counter. */
  votable: WeakMap<Element, VotedItem>;
  stopCounting: (() => void) | null;
  /** Preset rows as last saved here, until the settings echo them back. */
  presetRows: Array<Record<string, unknown>> | null;
  chain: Promise<void>;
}

let state: State | null = null;

const IGNORE_REASON = IGNORED_USER;

const isSelf = (s: State, user: string): boolean => {
  const me = s.ctx.session?.username;
  return !!me && me.toLowerCase() === user.toLowerCase();
};

/** True when this item's ignore should be skipped: the reader is on that user's own profile. */
function onOwnProfile(s: State, author: string): boolean {
  const { route } = s.ctx;
  return route.kind === 'profile' && route.username?.toLowerCase() === author.toLowerCase();
}

function isIgnored(s: State, item: Seen): boolean {
  return s.tags[tagKey(item.author)]?.ignored === true && !onOwnProfile(s, item.author);
}

/** True for the thread's own post (the one the reader opened), which should stay visible. */
function isThreadPost(s: State, item: Seen): boolean {
  return item.kind === 'post' && s.ctx.route.kind === 'thread' && item.id === s.ctx.route.postId;
}

/** Apply (or withdraw) the ignore effect on one item. */
function applyIgnore(s: State, item: Seen): void {
  const ignored = isIgnored(s, item);
  const { ui, options } = s.ctx;
  if (item.kind === 'post') {
    if (ignored && options.hideIgnoredPosts === true && !isThreadPost(s, item)) {
      ui.hide(item, IGNORE_REASON);
      s.hiddenByUs.add(item.id);
    } else if (s.hiddenByUs.delete(item.id)) ui.unhide(item, IGNORE_REASON);
  } else if (item.kind === 'comment') {
    const collapse =
      ignored && options.collapseIgnoredComments === true && !s.expanded.has(item.id);
    ui.collapseBody(item, collapse);
  }
}

/** The first opaque background up the tree, as #rrggbb; the theme background when there is none. */
function pageBackground(from: Element): string {
  const hex = (n: string): string => Number(n).toString(16).padStart(2, '0');
  for (let el: Element | null = from; el; el = el.parentElement) {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(
      getComputedStyle(el).backgroundColor,
    );
    if (m && (m[4] === undefined || Number(m[4]) >= 0.99))
      return `#${hex(m[1]!)}${hex(m[2]!)}${hex(m[3]!)}`;
  }
  const theme = getComputedStyle(document.documentElement).getPropertyValue('--rescue-bg').trim();
  return validColor(theme) ?? '#ffffff';
}

function votePill(s: State, item: Seen, tag: UserTag): HTMLElement {
  const pill = h(
    'button',
    {
      type: 'button',
      class: 'rescue-vote-tally rescue-btn',
      title: hint.votePill(item.author, formatVotes(tag.votesUp, tag.votesDown)),
    },
    formatVotes(tag.votesUp, tag.votesDown),
  );
  if (s.ctx.options.colorVoteWeight === true) {
    const tint = voteWeightColor(tag.votesUp, tag.votesDown);
    pill.style.backgroundColor = tint;
    // The page's own grey would not read on a green or red tint: choose the text by contrast.
    pill.style.color = pillTextColor(tint, pageBackground(item.container));
  }
  pill.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    edit(s, item.author, pill, item.permalink);
  });
  return pill;
}

function fill(s: State, item: Seen): void {
  const { author, container } = item;
  const { options } = s.ctx;
  const tag = s.tags[tagKey(author)];
  const own = isSelf(s, author);
  const kids: Node[] = [];
  if (tag?.text) {
    kids.push(
      buildTagChip(tag, { user: author, truncate: options.truncateTag === true, link: tag.link }),
    );
  }
  if (tag && !own && options.trackVoteWeight === true && (tag.votesUp || tag.votesDown)) {
    kids.push(votePill(s, item, tag));
  }
  if (item.kind === 'comment' && isIgnored(s, item) && options.collapseIgnoredComments === true) {
    const open = s.expanded.has(item.id);
    const toggle = h(
      'button',
      {
        type: 'button',
        class: 'rescue-ignore-toggle rescue-btn',
        'aria-expanded': open,
        title: hint.ignoreToggle(open),
      },
      open ? '[ignored user - hide]' : '[ignored user - show]',
    );
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!s.expanded.delete(item.id)) s.expanded.add(item.id);
      applyIgnore(s, item);
      fill(s, item);
    });
    kids.push(toggle);
  }
  // Never a tag button on the reader's own name. With the icon switched off it still appears for
  // anyone who already has a tag, tally or ignore, so that tag stays editable from the page.
  const hasData = !!tag && (!!tag.text || tag.votesUp > 0 || tag.votesDown > 0 || tag.ignored);
  if (!own && (options.showTaggingIcon === true || hasData)) {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'rescue-tag-btn rescue-btn',
        'aria-label': `Tag ${author}`,
        title: hint.tagButton(author),
      },
      label.tag,
    );
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      edit(s, author, btn, item.permalink);
    });
    kids.push(btn);
  }
  const showIgnoreButton =
    !own &&
    ((item.kind === 'comment' && options.ignoreButtonOnComments === true) ||
      (item.kind === 'post' && options.ignoreButtonOnPosts === true));
  if (showIgnoreButton) {
    const ignored = isIgnored(s, item);
    kids.push(
      ignoreButton(author, ignored, () =>
        void mutate(s, author, (t, now) => setIgnored(t, author, !isIgnored(s, item), now)),
      ),
    );
  }
  container.replaceChildren(...kids);
}

function refreshUser(s: State, user: string): void {
  for (const item of s.seen.get(tagKey(user)) ?? []) {
    applyIgnore(s, item);
    fill(s, item);
  }
  refreshTagManager();
}

function refreshAll(s: State): void {
  for (const items of s.seen.values()) {
    for (const item of items) {
      applyIgnore(s, item);
      fill(s, item);
    }
  }
}

function register(
  s: State,
  id: string,
  kind: Kind,
  author: string | null | undefined,
  permalink: string | null | undefined,
): void {
  if (!author || s.ids.has(id)) return;
  s.ids.add(id);
  const container = h('span', { class: 'rescue-author-extras' });
  const item: Seen = { id, kind, author, container, permalink: permalink ?? null };
  const key = tagKey(author);
  const same = s.seen.get(key);
  if (same) same.push(item);
  else s.seen.set(key, [item]);
  fill(s, item);
  s.ctx.ui.decorate({ id }, 'author', container);
  applyIgnore(s, item);
}

/** Read-modify-write against storage (another tab may have changed it), one at a time. */
function mutate(s: State, user: string, change: (t: UserTags, now: number) => UserTags) {
  s.chain = s.chain.then(async () => {
    const fresh = sanitizeTags(await s.ctx.data.get<unknown>('userTags'));
    s.tags = change(fresh, Date.now());
    s.ctx.data.set('userTags', s.tags);
    refreshUser(s, user);
  });
  return s.chain;
}

function presetRows(s: State): Array<Record<string, unknown>> {
  return s.presetRows ?? (s.ctx.options.presetTags as Array<Record<string, unknown>>) ?? [];
}

function savePreset(s: State, preset: { text: string; color?: string }): void {
  const row = presetRow(preset);
  const rows = presetRows(s);
  if (rows.some((r) => r.text === row.text && (r.color ?? '') === row.color)) return;
  s.presetRows = [...rows, row];
  void s.ctx.settings
    ?.save(setOption(s.ctx.settings.profile(), userTagger, 'presetTags', s.presetRows))
    .catch(() => s.ctx.notices?.show('REScue: the preset could not be saved.', { kind: 'error' }));
}

/** Ignore many users in one write (the blocked-users import); works with the module off too. */
async function ignoreUsers(ctx: ModuleContext, names: string[]): Promise<void> {
  const change = (t: UserTags, now: number) =>
    names.reduce((a, n) => setIgnored(a, n, true, now), t);
  if (!state) {
    const tags = sanitizeTags(await ctx.data.get<unknown>('userTags'));
    return ctx.data.set('userTags', change(tags, Date.now()));
  }
  await mutate(state, names[0] ?? '', change);
  refreshAll(state);
}

function managerHost(s: State): ManagerHost {
  return {
    signedIn: !!s.ctx.session?.signedIn,
    importBlocked: () => void runImportBlocked(s.ctx, ignoreUsers),
    load: async () => {
      await s.chain;
      return sanitizeTags(await s.ctx.data.get<unknown>('userTags'));
    },
    edit: (user, anchor) => edit(s, user, anchor, null),
    remove: (user) => mutate(s, user, (t) => removeTag(t, user)),
  };
}

function edit(s: State, username: string, anchor: Element, permalink: string | null): void {
  const { options } = s.ctx;
  openTagEditor({
    username,
    anchor,
    current: s.tags[tagKey(username)],
    defaultLink:
      options.storeSourceLink === true
        ? (absoluteLink(permalink, location.origin) ?? undefined)
        : undefined,
    presets: presetTagsFrom(presetRows(s)),
    onSave: (e: TagEdit) =>
      void mutate(s, username, (t, now) =>
        setVotes(
          setIgnored(
            setTag(t, username, { text: e.text, color: e.color, link: e.link }, now),
            username,
            e.ignored,
            now,
          ),
          username,
          e.votesUp,
          e.votesDown,
          now,
        ),
      ),
    onDelete: () => void mutate(s, username, (t) => removeTag(t, username)),
    onSavePreset: (p) => savePreset(s, p),
    onManage: () => openTagManager(managerHost(s)),
  });
}

/** Count (or stop counting) the reader's clicks on Reddit's post arrows, per the option. */
function syncVoteCounting(s: State): void {
  s.stopCounting?.();
  s.stopCounting = null;
  if (s.ctx.options.trackVoteWeight !== true) return;
  s.stopCounting = attachVoteCounter({
    itemFor: (host) => s.votable.get(host),
    me: () => s.ctx.session?.username ?? null,
    voteState: (target) => s.ctx.actions.voteState(target),
    apply: (author, up, down) => void recordVotes(author, up, down),
  });
}

/**
 * For the keyboard vote path: record a confirmed change in the reader's votes on `username`'s
 * content as separate up and down counts (a change of vote is -1 on one side and +1 on the other).
 */
export function recordVotes(username: string, deltaUp: number, deltaDown: number): Promise<void> {
  const s = state;
  if (!s || s.ctx.options.trackVoteWeight !== true) return Promise.resolve();
  return mutate(s, username, (t, now) => adjustVotes(t, username, deltaUp, deltaDown, now));
}

function reset(s: State): void {
  closeTagEditor();
  s.seen.clear();
  s.ids.clear();
  s.hiddenByUs.clear();
  s.expanded.clear();
}

function makeState(ctx: ModuleContext, tags: UserTags): State {
  return {
    ctx,
    tags,
    seen: new Map(),
    ids: new Set(),
    hiddenByUs: new Set(),
    expanded: new Set(),
    votable: new WeakMap(),
    stopCounting: null,
    presetRows: null,
    chain: Promise.resolve(),
  };
}

export const userTagger = defineModule({
  id: 'userTagger',
  resId: 'userTagger',
  category: 'users',
  title: 'User tagger',
  description:
    'Tag any username with text, a colour (21 presets or your own) and a link, or ignore them. A small tag button and the tag appear right after the author’s name on posts and comments, never on your own name. The tag editor pre-fills the link with the post or comment you opened it from, offers preset tags, and shows how the tag will look. Posts by ignored users are hidden and their comments are collapsed (their replies stay visible). Your votes on each user are counted as upvotes and downvotes when you click Reddit’s arrow on a post or comment or vote from the keyboard; you can correct the counts by hand in the editor. Tags are stored only on this device; "Manage tagged users" lists them all.',
  enabledByDefault: true,
  options: taggerOptionsSchema,
  actions: [
    {
      id: 'manage',
      label: 'Manage tagged users…',
      async run(ctx) {
        const s = state ?? makeState(ctx, sanitizeTags(await ctx.data.get<unknown>('userTags')));
        openTagManager(managerHost(s));
      },
    },
    blockedImportAction(ignoreUsers),
  ],

  async init(ctx) {
    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
    const tags = sanitizeTags(await ctx.data.get<unknown>('userTags'));
    const st = (state = makeState(ctx, tags));
    syncVoteCounting(st);
    setTaggerApi({
      edit: (u, a) => edit(st, u, a, null),
      setText: (u, text) =>
        mutate(st, u, (t, now) => {
          const cur = t[tagKey(u)];
          return setTag(t, u, { text, color: cur?.color, link: cur?.link }, now);
        }),
      isIgnored: (u) => st.tags[tagKey(u)]?.ignored === true,
      toggleIgnore: (u) =>
        mutate(st, u, (t, now) => setIgnored(t, u, t[tagKey(u)]?.ignored !== true, now)),
    });
  },

  onItems(batch, ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    for (const p of batch.posts) {
      s.votable.set(p.source, { id: p.id, author: p.author });
      register(s, p.id, 'post', p.author, p.permalink);
    }
    for (const c of batch.comments) {
      s.votable.set(c.source, { id: c.id, author: c.author });
      register(s, c.id, 'comment', c.author, c.permalink);
    }
    for (const pc of batch.profileComments)
      register(s, pc.id, 'profileComment', ctx.route.username, pc.permalink);
  },

  onRoute(route) {
    const s = state;
    if (!s) return;
    s.ctx = { ...s.ctx, route };
    reset(s);
  },

  onSettings(ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    s.presetRows = null;
    syncVoteCounting(s);
    refreshAll(s);
  },

  dispose() {
    state?.stopCounting?.();
    closeTagEditor();
    closeTagManager();
    setTaggerApi(null);
    document.getElementById(STYLE_ID)?.remove();
    state = null;
  },
});
