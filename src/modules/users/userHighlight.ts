/**
 * userHighlight (RES highlight marks, US5): colours the author name of moderators, admins,
 * friends from a local list, the thread's OP, the first commenter, comments that mention the OP,
 * and (optionally) users you have tagged or everyone (a colour per name). Reddit already marks the
 * post's submitter with its own badge; the OP colour is REScue's extra, off by default. The mark is
 * a class on the item's own author link (a light-DOM anchor), styled by one stylesheet whose colours
 * are validated first. Friends can also be added from the author's hover card (hoverCardActions).
 */
import { defineModule, type ModuleContext, type SharedData } from '../../core/types';
import {
  FIRST_CLASS,
  OP_CLASS,
  OP_MENTION_CLASS,
  asAutoMode,
  autoBucket,
  autoClass,
  autoColorCss,
  mentionsUser,
  pillCss,
  type AutoMode,
} from './highlightExtras';
import { sanitizeTags, tagKey, validColor } from './tagStore';

export { FIRST_CLASS, OP_CLASS, OP_MENTION_CLASS };
const STYLE_ID = 'rescue-user-highlight';
export const MOD_CLASS = 'rescue-mod-author';
export const ADMIN_CLASS = 'rescue-admin-author';
export const FRIEND_CLASS = 'rescue-friend-author';
export const TAGGED_CLASS = 'rescue-tagged-author';
export const SELF_CLASS = 'rescue-self-author';
export const HIGHLIGHTED_CLASS = 'rescue-highlighted-author';

export interface HighlightColors {
  mod: string;
  admin: string;
  friend: string;
  tagged: string;
  self?: string;
  op?: string;
  opMention?: string;
  first?: string;
  /** `#rrggbb` text colour for every highlight; blank picks black or white for contrast. */
  font?: string;
  /** Darken a highlight while the pointer is over the name. */
  hover?: boolean;
  /** Add the per-name text colours. */
  auto?: boolean;
  /** How the per-name colour is chosen (RES autoColorUsing). */
  autoMode?: AutoMode;
  /** Users you highlighted by hand (from the hover card), and their hover colour. */
  highlighted?: string;
  highlightedHover?: string;
}

/** The stylesheet for the chosen colours. Anything that is not #rrggbb falls back to its default. */
export function highlightCss(c: HighlightColors): string {
  const pill = (cls: string, bg: string | undefined, fallback: string) =>
    pillCss(cls, validColor(bg) ?? fallback, c.font, c.hover === true);
  return [
    ...(c.auto ? [autoColorCss(c.autoMode)] : []),
    pill(OP_MENTION_CLASS, c.opMention, '#6d4731'),
    pill(FIRST_CLASS, c.first, '#46b6cc'),
    pill(OP_CLASS, c.op, '#0055df'),
    pill(MOD_CLASS, c.mod, '#228822'),
    pill(ADMIN_CLASS, c.admin, '#ff0011'),
    pill(FRIEND_CLASS, c.friend, '#ff4500'),
    pillCss(
      HIGHLIGHTED_CLASS,
      validColor(c.highlighted) ?? '#5544cc',
      c.font,
      c.hover === true,
      c.highlightedHover,
    ),
    pill(TAGGED_CLASS, c.tagged, '#b8860b'),
    pill(SELF_CLASS, c.self, '#336699'),
  ].join('\n');
}

interface Opts {
  highlightMods: boolean;
  modColor: string;
  highlightAdmins: boolean;
  adminColor: string;
  friends: string[];
  friendColor: string;
  highlightTagged: boolean;
  taggedColor: string;
  highlightSelf: boolean;
  selfColor: string;
  highlightOp: boolean;
  opColor: string;
  highlightOpMentions: boolean;
  opMentionsColor: string;
  highlightFirstCommenter: boolean;
  dontHighlightFirstComment: boolean;
  firstCommentColor: string;
  autoColorUsernames: boolean;
  autoColorUsing: string;
  highlighted: string[];
  highlightColor: string;
  highlightColorHover: string;
  fontColor: string;
  hoverColors: boolean;
}

/** What the module remembers about one item, so its marks can be recomputed. */
interface Rec {
  item: { id: string };
  kind: 'post' | 'comment';
  author: string | null;
  distinguished: string | null | undefined;
  isOp: boolean;
  body: string;
  applied: Set<string>;
}

let tagged = new Set<string>();
let recs = new Map<string, Rec>();
let opName: string | null = null;
let firstAuthor: string | null = null;
let firstId: string | null = null;
let lastCtx: ModuleContext | null = null;

const css = (ctx: ModuleContext): string => {
  const o = ctx.options as unknown as Opts;
  return highlightCss({
    mod: o.modColor,
    admin: o.adminColor,
    friend: o.friendColor,
    tagged: o.taggedColor,
    self: o.selfColor,
    op: o.opColor,
    opMention: o.opMentionsColor,
    first: o.firstCommentColor,
    font: o.fontColor,
    hover: o.hoverColors,
    auto: o.autoColorUsernames,
    autoMode: asAutoMode(o.autoColorUsing),
    highlighted: o.highlightColor,
    highlightedHover: o.highlightColorHover,
  });
};

function writeStyle(ctx: ModuleContext): void {
  document.getElementById(STYLE_ID)?.remove();
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css(ctx);
  document.head.appendChild(style);
}

const NONE: Set<string> = new Set();
let lookupFor: unknown = null;
let lookupCache = {
  friends: new Set<string>(),
  highlighted: new Set<string>(),
  me: null as string | null,
};

/** The friends set and own name for the current options, worked out once per settings change. */
function lookups(ctx: ModuleContext): typeof lookupCache {
  const o = ctx.options as unknown as Opts;
  if (lookupFor !== o) {
    lookupFor = o;
    const me = o.highlightSelf ? ctx.session?.username : null;
    lookupCache = {
      friends: new Set(o.friends.map(tagKey).filter(Boolean)),
      highlighted: new Set((o.highlighted ?? []).map(tagKey).filter(Boolean)),
      me: me ? tagKey(me) : null,
    };
  }
  return lookupCache;
}

/** The classes this item's author link should carry right now. */
function wanted(ctx: ModuleContext, r: Rec): Set<string> {
  const o = ctx.options as unknown as Opts;
  if (!r.author && !r.distinguished) return NONE;
  const out = new Set<string>();
  if (o.highlightMods && r.distinguished === 'moderator') out.add(MOD_CLASS);
  if (o.highlightAdmins && r.distinguished === 'admin') out.add(ADMIN_CLASS);
  if (!r.author) return out;
  const key = tagKey(r.author);
  const { friends, highlighted, me } = lookups(ctx);
  if (friends.has(key)) out.add(FRIEND_CLASS);
  if (highlighted.has(key)) out.add(HIGHLIGHTED_CLASS);
  if (me && me === key) out.add(SELF_CLASS);
  if (o.highlightTagged && tagged.has(key)) out.add(TAGGED_CLASS);
  if (o.highlightOp && r.isOp) out.add(OP_CLASS);
  if (
    o.highlightOpMentions &&
    r.kind === 'comment' &&
    opName &&
    key !== tagKey(opName) &&
    mentionsUser(r.body, opName)
  )
    out.add(OP_MENTION_CLASS);
  if (
    o.highlightFirstCommenter &&
    firstAuthor &&
    key === tagKey(firstAuthor) &&
    !(o.dontHighlightFirstComment && r.item.id === firstId)
  )
    out.add(FIRST_CLASS);
  if (o.autoColorUsernames) out.add(autoClass(autoBucket(r.author)));
  return out.size ? out : NONE;
}

function apply(ctx: ModuleContext, r: Rec): void {
  const want = wanted(ctx, r);
  for (const cls of r.applied) if (!want.has(cls)) ctx.ui.unmarkAuthor(r.item, cls);
  for (const cls of want) if (!r.applied.has(cls)) ctx.ui.markAuthor(r.item, cls);
  r.applied = want;
}

const applyAll = (ctx: ModuleContext): void => {
  for (const r of recs.values()) apply(ctx, r);
};

function resetThread(): void {
  recs = new Map();
  opName = null;
  firstAuthor = null;
  firstId = null;
}

export const userHighlight = defineModule({
  id: 'userHighlight',
  resId: 'userHighlight',
  category: 'users',
  title: 'User highlighting',
  description:
    'Colour the author name of moderators, your friends, (optionally) users you have tagged, the thread’s OP, the first commenter, comments that mention the OP, and (optionally) yourself. A colour per name can be added for everyone. Moderator highlighting works on comments marked as moderator comments by Reddit. Admin highlighting relies on a marker Reddit has not been seen using yet, so it may never show. Reddit already marks the post’s submitter itself; the OP colour is REScue’s own extra. The “highlight” link in a post author’s hover card adds or removes a user in your own highlight colour.',
  enabledByDefault: true,
  options: {
    highlightMods: {
      type: 'boolean',
      default: true,
      title: 'Highlight moderators',
      description: 'Comments Reddit marks as distinguished by a moderator.',
    },
    modColor: { type: 'color', default: '#228822', title: 'Moderator colour' },
    highlightAdmins: {
      type: 'boolean',
      default: true,
      title: 'Highlight admins',
      description: 'Unverified: only shows if Reddit marks admin comments in a way REScue knows.',
    },
    adminColor: { type: 'color', default: '#ff0011', title: 'Admin colour' },
    friends: {
      type: 'list',
      default: [],
      title: 'Friends',
      description: 'Usernames, one per entry. Kept on this device; not your Reddit friends list.',
    },
    friendColor: { type: 'color', default: '#ff4500', title: 'Friend colour' },
    highlightTagged: {
      type: 'boolean',
      default: false,
      title: 'Highlight tagged users',
      description: 'Users with a tag from the user tagger, as of when the page loaded.',
    },
    taggedColor: {
      type: 'color',
      default: '#b8860b',
      title: 'Tagged user colour',
      dependsOn: 'highlightTagged',
    },
    highlightSelf: {
      type: 'boolean',
      default: false,
      title: 'Highlight myself',
      description: 'Colour your own name on your posts and comments. Needs you to be signed in.',
    },
    selfColor: {
      type: 'color',
      default: '#336699',
      title: 'My colour',
      dependsOn: 'highlightSelf',
    },
    highlightOp: {
      type: 'boolean',
      default: false,
      title: 'Highlight the OP',
      description:
        'Colour the name of the post’s author on their own comments. Off by default: Reddit already shows its own OP badge.',
    },
    opColor: { type: 'color', default: '#0055df', title: 'OP colour', dependsOn: 'highlightOp' },
    highlightOpMentions: {
      type: 'boolean',
      default: false,
      title: 'Highlight comments that mention the OP',
      description:
        'Colour the name of anyone whose comment mentions the OP’s username (u/name or a link to their profile).',
    },
    opMentionsColor: {
      type: 'color',
      default: '#6d4731',
      title: 'OP mention colour',
      dependsOn: 'highlightOpMentions',
    },
    highlightFirstCommenter: {
      type: 'boolean',
      default: false,
      title: 'Highlight the first commenter',
      description:
        'Colour the name of whoever wrote the first top-level comment, wherever it recurs.',
    },
    dontHighlightFirstComment: {
      type: 'boolean',
      default: true,
      title: 'Not on the first comment itself',
      description: 'Only colour the first commenter’s later comments.',
      dependsOn: 'highlightFirstCommenter',
    },
    firstCommentColor: {
      type: 'color',
      default: '#46b6cc',
      title: 'First commenter colour',
      dependsOn: 'highlightFirstCommenter',
    },
    autoColorUsernames: {
      type: 'boolean',
      default: false,
      title: 'Give every name its own colour',
      description: 'A stable colour per username, worked out from the name. Other highlights win.',
    },
    autoColorUsing: {
      type: 'enum',
      default: 'hash-notbright',
      title: 'How each name’s colour is chosen',
      dependsOn: 'autoColorUsernames',
      values: [
        { value: 'hash-notbright', label: 'From the name, muted (readable on light and dark)' },
        { value: 'hash-bright', label: 'From the name, bright' },
      ],
    },
    highlighted: {
      type: 'list',
      default: [],
      title: 'Highlighted users',
      description:
        'Usernames, one per entry. The “highlight” link in a post author’s hover card edits this list. Kept on this device.',
    },
    highlightColor: {
      type: 'color',
      default: '#5544cc',
      title: 'Highlighted user colour',
    },
    highlightColorHover: {
      type: 'color',
      default: '#6677aa',
      title: 'Highlighted user colour while the pointer is over the name',
    },
    fontColor: {
      type: 'color',
      default: '',
      title: 'Text colour on highlights',
      description: 'Blank picks black or white for contrast with each highlight.',
      advanced: true,
    },
    hoverColors: {
      type: 'boolean',
      default: false,
      title: 'Darker highlight on hover',
      description: 'The highlight darkens while the pointer is over the name.',
      advanced: true,
    },
  },

  init(ctx) {
    resetThread();
    lastCtx = ctx;
    writeStyle(ctx);
    return refreshTagged(ctx);
  },

  onItems(batch, ctx) {
    lastCtx = ctx;
    const o = ctx.options as unknown as Opts;
    let global = false;
    const add = (r: Rec): void => {
      recs.set(r.item.id, r);
      apply(ctx, r);
    };
    for (const p of batch.posts) {
      if (ctx.route?.kind === 'thread' && !opName && p.author) {
        opName = p.author;
        global = true;
      }
      add({
        item: p,
        kind: 'post',
        author: p.author,
        distinguished: null,
        isOp: false,
        body: '',
        applied: NONE,
      });
    }
    // Only when the page says so (comment.distinguished); never inferred from a name.
    for (const c of batch.comments) {
      if (c.isOp && !opName && c.author) {
        opName = c.author;
        global = true;
      }
      if (o.highlightFirstCommenter && !firstAuthor && c.depth === 0 && c.author) {
        firstAuthor = c.author;
        firstId = c.id;
        global = true;
      }
      add({
        item: c,
        kind: 'comment',
        author: c.author,
        distinguished: c.distinguished,
        isOp: c.isOp,
        body: o.highlightOpMentions ? c.bodyHtml : '',
        applied: NONE,
      });
    }
    if (global) applyAll(ctx);
  },

  onRoute() {
    resetThread();
  },

  async onSettings(ctx) {
    lastCtx = ctx;
    writeStyle(ctx);
    await refreshTagged(ctx);
    applyAll(ctx);
  },

  dispose() {
    if (lastCtx) {
      for (const r of recs.values())
        for (const cls of r.applied) lastCtx.ui.unmarkAuthor(r.item, cls);
    }
    document.getElementById(STYLE_ID)?.remove();
    tagged = new Set();
    resetThread();
    lastCtx = null;
  },
});

/** Remember which users carry a tag (for the "tagged" highlight). */
async function refreshTagged(ctx: { options: { highlightTagged: boolean }; data: SharedData }) {
  tagged = new Set();
  if (!ctx.options.highlightTagged) return;
  const tags = sanitizeTags(await ctx.data.get<unknown>('userTags'));
  tagged = new Set(
    Object.entries(tags)
      .filter(([, t]) => t.text)
      .map(([k]) => k),
  );
}
