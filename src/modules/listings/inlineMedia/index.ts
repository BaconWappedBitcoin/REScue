/**
 * inlineMedia (RES showImages, "collapse inline media"): hide the pictures, GIFs and videos inside
 * comments, each behind a small word in its place ("show image", "show GIF", "show video"; see
 * commentMedia.ts), and, with the option "Also hide the post's own picture or video", the media of
 * a post behind a word after the time ("show image", "show video", "show gallery (5)") that brings
 * it back one post at a time. Off by default.
 *
 * For a post, only its media container (`div[slot=post-media-container]`) is hidden, as a whole, by an
 * attribute on the post and REScue's own stylesheet. Nothing inside Reddit's media components is
 * read for more than a tag name or changed (constitution Principle I: one named slot, opt-in, with
 * a visible way back). Hiding the container stops video from loading but not images, so an
 * optional "Block media downloads" setting adds a declarativeNetRequest rule in the background
 * (src/core/mediaBlock.ts) after the user grants the optional permission.
 *
 * Ported in spirit from RES lib/modules/showImages.js (GPL-3.0, the RES contributors, commit
 * 4defffc); the code is new.
 */
import { hint, mediaLabel } from '../../../core/hints';
import { wantsBlocking } from '../../../core/mediaBlock';
import { resolveOptions, setOption } from '../../../core/settings';
import {
  defineModule,
  type KeysApi,
  type ModuleContext,
  type ModuleDefinition,
} from '../../../core/types';
import {
  collapseCss,
  galleryCount,
  mediaContainerOf,
  mediaKindOf,
  MEDIA_ATTR,
  MEDIA_COLLAPSED,
  type MediaKind,
} from '../../../model/inline-media';
import type { Post } from '../../../model/types';
import { commentMediaCss } from '../../../model/comment-media';
import { removeStyle, setStyle } from '../../appearance/injectedStyle';
import { linkButton, onClick } from '../../comments/commentUi';
import { blockingRequest, shouldAsk } from './blocking';
import { CommentMedia } from './commentMedia';
import { writeMirror } from './earlyStyle';
import { highlightCss, SENSITIVE_ATTR, sensitiveOf } from './highlight';
import { OPTIONS } from './options';
import {
  commentMediaHidden,
  policyKey,
  pruneExpanded,
  sanitizeExpanded,
  shouldCollapse,
  subTable,
  type ExpandedMap,
  type OnlyTypes,
  type Policy,
  type Scope,
} from './policy';

const STYLE_ID = 'rescue-inline-media-style';
const MODULE_ID = 'inlineMedia';

interface Opts {
  collapseMedia: boolean;
  collapsePostMedia: boolean;
  scope: Scope;
  onlyTypes: OnlyTypes;
  perSubreddit: Array<Record<string, unknown>>;
  rememberExpanded: boolean;
  blockDownloads: boolean;
  mediaBrowse: boolean;
  scrollOnExpando: boolean;
  highlightNSFWButton: boolean;
  highlightSpoilerButton: boolean;
}

interface Entry {
  post: Post;
  kind: MediaKind;
  count: number;
  control: HTMLButtonElement;
  /** What you chose for this post on this page view; wins over the settings. */
  override?: boolean;
  /** You used the control on this post, so it stays visible. */
  touched: boolean;
}

interface State {
  ctx: ModuleContext;
  entries: Map<string, Entry>;
  expanded: ExpandedMap;
  policy: Policy;
  key: string;
  wasWanted: boolean;
  /** This tab was allowed to download media although blocking is on. */
  tabAllowed: boolean;
  removeMenu: () => void;
  /** The post that was selected before the current one (mediaBrowse). */
  lastSelected: string | null;
  stopSelection: () => void;
  /** Media inside comments (commentMedia.ts). */
  comments: CommentMedia;
}

let state: State | null = null;
/** The key dispatcher the commands went into; it lives as long as the page, so register once. */
let keysOn: KeysApi | null = null;

const optsOf = (ctx: ModuleContext): Opts => ctx.options as unknown as Opts;

const policyOf = (o: Opts): Policy => ({
  // Posts need the switch and the post option; comments need the switch only.
  collapseMedia: o.collapseMedia && o.collapsePostMedia,
  hideCommentMedia: o.collapseMedia,
  scope: o.scope,
  onlyTypes: o.onlyTypes,
  subs: subTable(o.perSubreddit),
});

const autoCollapse = (s: State, e: Entry): boolean =>
  shouldCollapse(s.policy, s.ctx.route.kind, {
    subreddit: e.post.subreddit,
    nsfw: e.post.nsfw,
    spoiler: e.post.spoiler,
    kind: e.kind,
  });

/** Collapsed now: your choice, else the posts you expanded before, else the settings. */
function isCollapsed(s: State, e: Entry): boolean {
  if (e.override !== undefined) return e.override;
  if (optsOf(s.ctx).rememberExpanded && s.expanded[e.post.id] !== undefined) return false;
  return autoCollapse(s, e);
}

function render(s: State, e: Entry): void {
  const collapsed = isCollapsed(s, e);
  const host = e.post.source;
  if (collapsed) host.setAttribute(MEDIA_ATTR, MEDIA_COLLAPSED);
  else if (host.hasAttribute(MEDIA_ATTR)) host.removeAttribute(MEDIA_ATTR);
  // The word shows wherever the settings would collapse the post, and on any post you used it on,
  // so a hidden slot always has a visible way back.
  e.control.hidden = !(collapsed || e.touched || autoCollapse(s, e));
  e.control.textContent = mediaLabel(collapsed, e.kind, e.count);
  e.control.title = hint.mediaToggle(collapsed, e.kind);
  e.control.setAttribute('aria-expanded', String(!collapsed));
  e.control.setAttribute(SENSITIVE_ATTR, sensitiveOf(e.post));
}

const styleText = (o: Opts, commentsHidden: boolean): string =>
  [
    collapseCss(),
    highlightCss(o.highlightNSFWButton, o.highlightSpoilerButton),
    commentMediaCss(commentsHidden),
  ].join('\n');

/** Is media in comments hidden on this page (the switch, or a row for the page's subreddit)? */
const commentsHiddenFor = (ctx: ModuleContext, policy: Policy): boolean =>
  commentMediaHidden(optsOf(ctx).collapseMedia, policy.subs, ctx.route.subreddit);

/** After showing media, bring the post fully on screen (scrollOnExpando). */
function scrollIntoView(s: State, e: Entry): void {
  if (!optsOf(s.ctx).scrollOnExpando) return;
  e.post.source.scrollIntoView?.({ block: 'nearest' });
}

/**
 * mediaBrowse: moving the selection from a post whose media you showed hides that media and shows
 * the next post's (posts whose media shows by itself are left alone).
 */
function browseTo(s: State, id: string | null): void {
  const prev = s.lastSelected ? s.entries.get(s.lastSelected) : undefined;
  s.lastSelected = id;
  const next = id ? s.entries.get(id) : undefined;
  if (!optsOf(s.ctx).mediaBrowse || !prev || !next || prev === next) return;
  if (!prev.touched || isCollapsed(s, prev) || !autoCollapse(s, prev)) return;
  prev.override = true;
  render(s, prev);
  next.override = false;
  next.touched = true;
  render(s, next);
  scrollIntoView(s, next);
  void noteIfBlocked(s);
}

const renderAll = (s: State): void => {
  for (const e of s.entries.values()) render(s, e);
};

function persist(s: State): void {
  s.expanded = pruneExpanded(s.expanded);
  s.ctx.store.set('expanded', s.expanded);
}

function toggle(s: State, e: Entry): void {
  const collapse = !isCollapsed(s, e);
  e.override = collapse;
  e.touched = true;
  if (optsOf(s.ctx).rememberExpanded) {
    if (collapse) delete s.expanded[e.post.id];
    else s.expanded[e.post.id] = Date.now();
    persist(s);
  }
  render(s, e);
  if (!collapse) {
    scrollIntoView(s, e);
    void noteIfBlocked(s);
  }
}

/** Shift+X: if any post is collapsed show them all, otherwise collapse them all (this view only). */
function toggleAll(s: State): void {
  const entries = [...s.entries.values()];
  const anyCollapsed = entries.some((e) => isCollapsed(s, e)) || s.comments.anyHidden();
  for (const e of entries) {
    e.override = !anyCollapsed;
    e.touched = true;
    render(s, e);
  }
  s.comments.setEvery(anyCollapsed);
  if (anyCollapsed) void noteIfBlocked(s);
}

// --- opt-in download blocking -------------------------------------------------------------------

async function turnOffBlocking(s: State): Promise<void> {
  const def = inlineMedia as ModuleDefinition;
  try {
    await s.ctx.settings.save(setOption(s.ctx.settings.profile(), def, 'blockDownloads', false));
  } catch {
    s.ctx.notices.show('REScue could not save that change.', { kind: 'error' });
  }
}

async function allowThisTab(s: State): Promise<void> {
  if ((await blockingRequest('allowTab')) !== 'active') {
    s.ctx.notices.show('REScue could not allow downloads in this tab.', { kind: 'error' });
    return;
  }
  s.tabAllowed = true;
  s.ctx.notices.show(
    'Downloads are allowed in this tab until you close it. Reload to load what was skipped.',
    {
      id: 'inline-media-allowed',
      moduleId: MODULE_ID,
      timeoutMs: 20000,
      actions: [{ label: 'Reload', hint: hint.mediaReload, run: () => location.reload() }],
    },
  );
}

/** You showed a post's media while downloads are blocked: say why nothing loads, and offer a way. */
async function noteIfBlocked(s: State): Promise<void> {
  if (s.tabAllowed || !wantsBlocking(optsOf(s.ctx))) return;
  if ((await blockingRequest('status')) !== 'active') return;
  s.ctx.notices.show('Downloads are blocked — turn off to load', {
    id: 'inline-media-blocked',
    type: 'mediaBlocked',
    moduleId: MODULE_ID,
    kind: 'warning',
    timeoutMs: 20000,
    cooldownMs: 20000,
    actions: [
      { label: 'Allow in this tab', hint: hint.mediaAllowTab, run: () => void allowThisTab(s) },
      {
        label: 'Turn off blocking',
        hint: hint.mediaTurnOffBlocking,
        run: () => void turnOffBlocking(s),
      },
    ],
  });
}

/** Check (and, when blocking was just turned on, ask for) the permission blocking needs. */
async function syncBlocking(s: State, ask: boolean): Promise<void> {
  const result = await blockingRequest(ask ? 'ask' : 'status');
  if (result !== 'needs-permission' || ask) return;
  s.ctx.notices.show('Blocking media downloads needs your permission.', {
    id: 'inline-media-permission',
    type: 'mediaPermission',
    moduleId: MODULE_ID,
    kind: 'warning',
    cooldownMs: 3_600_000,
    actions: [
      {
        label: 'Allow',
        hint: hint.mediaAskPermission,
        run: () => void blockingRequest('ask'),
      },
    ],
  });
}

// --- keys and menu ------------------------------------------------------------------------------

function selectedEntry(): Entry | undefined {
  const item = state?.ctx.ui.selection().current();
  return item?.kind === 'post' ? state?.entries.get(item.id) : undefined;
}

/** The selected comment, when it has media of its own to hide or show. */
function selectedCommentWithMedia(): Element | undefined {
  const item = state?.ctx.ui.selection().current();
  return item?.kind === 'comment' && state?.comments.hasMedia(item.host) ? item.host : undefined;
}

function registerKeys(ctx: ModuleContext): void {
  if (keysOn === ctx.keys) return;
  keysOn = ctx.keys;
  // Neither key is used by keyboardNav, voting or the go commands. Both decline (letting Reddit's
  // own handler have the key) when there is nothing for them to act on.
  ctx.keys.register({
    id: 'toggleMedia',
    title: 'Hide or show the media of the selected post or comment',
    defaultKeys: ['x'],
    section: 'Media',
    enabled: () => selectedEntry() !== undefined || selectedCommentWithMedia() !== undefined,
    run: () => {
      const e = selectedEntry();
      if (e && state) {
        toggle(state, e);
        return;
      }
      const host = selectedCommentWithMedia();
      if (!host || !state) return false;
      state.comments.toggleComment(host);
    },
  });
  ctx.keys.register({
    id: 'toggleAllMedia',
    title: 'Hide or show the media of every post and comment on the page',
    defaultKeys: ['shift+x'],
    section: 'Media',
    enabled: () => !!state && (state.entries.size > 0 || state.comments.hasAny()),
    run: () => {
      if (!state) return false;
      toggleAll(state);
    },
  });
}

const collapseOn = (s: State): boolean =>
  resolveOptions(inlineMedia as ModuleDefinition, s.ctx.settings.profile()).collapseMedia === true;

function setCollapse(s: State, on: boolean): void {
  const def = inlineMedia as ModuleDefinition;
  void s.ctx.settings
    .save(setOption(s.ctx.settings.profile(), def, 'collapseMedia', on))
    .catch(() => s.ctx.notices.show('REScue could not save that change.', { kind: 'error' }));
}

// --- the module ---------------------------------------------------------------------------------

export const inlineMedia = defineModule({
  id: MODULE_ID,
  resId: 'showImages',
  category: 'listings',
  title: 'Hide inline media',
  description:
    'Hides the pictures, GIFs and videos inside comments, each behind a word in its place (“show image”, “show GIF”, “show video”) that shows it again, and “hide …” puts it away. It is hidden before you see it and stays hidden when you refresh or when more comments load. X shows or hides the media of the selected comment (or post); Shift+X does every comment and post on the page. The switch is also in the REScue menu. Posts are left alone unless you switch on “Also hide the post’s own picture or video”, which hides the post’s media behind a word after its time. Only the media’s own wrapper is hidden; nothing inside Reddit’s players is touched. Off by default.',
  enabledByDefault: true,
  options: OPTIONS,

  async init(ctx) {
    const o = optsOf(ctx);
    const policy = policyOf(o);
    // The stylesheet and the comment observer go in before anything is awaited, so media inside
    // comments is already hidden when Reddit first draws it.
    const comments = new CommentMedia();
    setStyle(STYLE_ID, styleText(o, commentsHiddenFor(ctx, policy)));
    writeMirror(o.collapseMedia, policy.subs);
    comments.start(() => state && void noteIfBlocked(state));
    comments.setActive(commentsHiddenFor(ctx, policy));
    const s: State = {
      ctx,
      comments,
      entries: new Map(),
      expanded: pruneExpanded(sanitizeExpanded(await ctx.store.get('expanded'))),
      policy,
      key: policyKey(policy),
      wasWanted: wantsBlocking(o),
      tabAllowed: false,
      removeMenu: () => {},
      lastSelected: null,
      stopSelection: () => {},
    };
    state = s;
    s.removeMenu = ctx.ui.addMenuItem({
      id: 'inlineMedia:collapse',
      label: 'Hide inline media',
      order: 41,
      hint: () => hint.menuHideMedia(collapseOn(s)),
      onClick: () => {},
      toggle: { get: () => collapseOn(s), set: (on) => setCollapse(s, on) },
    });
    s.stopSelection = ctx.ui
      .selection()
      .onChange((item) => browseTo(s, item?.kind === 'post' ? item.id : null));
    registerKeys(ctx);
    if (s.wasWanted) void syncBlocking(s, false);
  },

  onItems(batch, ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    for (const p of batch.posts) {
      const known = s.entries.get(p.id);
      if (known) {
        known.post = p; // Reddit drew the post again
        render(s, known);
        continue;
      }
      const kind = mediaKindOf(p, mediaContainerOf(p.source));
      if (!kind) continue;
      const count = kind === 'gallery' ? galleryCount(p) : 0;
      const control = linkButton('rescue-media-toggle', '', '');
      const e: Entry = { post: p, kind, count, control, touched: false };
      onClick(control, () => state && toggle(state, e));
      s.entries.set(p.id, e);
      ctx.ui.decorate(p, 'tagline', control);
      render(s, e);
    }
  },

  onRoute(_route, ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    s.entries.clear();
    s.comments.reset();
    // A subreddit row can decide for this page's comments.
    setStyle(STYLE_ID, styleText(optsOf(ctx), commentsHiddenFor(ctx, s.policy)));
    s.comments.setActive(commentsHiddenFor(ctx, s.policy));
  },

  onSettings(ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    const o = optsOf(ctx);
    s.policy = policyOf(o);
    const key = policyKey(s.policy);
    if (key !== s.key) {
      // The rules changed: start from them again instead of from earlier choices on this page.
      s.key = key;
      for (const e of s.entries.values()) {
        delete e.override;
        e.touched = false;
      }
      s.comments.reset();
    }
    const hidden = commentsHiddenFor(ctx, s.policy);
    writeMirror(o.collapseMedia, s.policy.subs);
    setStyle(STYLE_ID, styleText(o, hidden));
    s.comments.setActive(hidden);
    renderAll(s);
    const wanted = wantsBlocking(o);
    const was = s.wasWanted;
    s.wasWanted = wanted;
    if (!wanted) s.tabAllowed = false;
    else void syncBlocking(s, shouldAsk(was, wanted));
  },

  dispose() {
    const s = state;
    state = null;
    if (!s) return;
    for (const e of s.entries.values()) {
      e.post.source.removeAttribute(MEDIA_ATTR);
      // Hidden as well as removed: the layout may still hold the node and put it back.
      e.control.hidden = true;
      e.control.remove();
    }
    s.entries.clear();
    s.comments.dispose();
    writeMirror(false, new Map());
    s.removeMenu();
    s.stopSelection();
    removeStyle(STYLE_ID);
  },
});
