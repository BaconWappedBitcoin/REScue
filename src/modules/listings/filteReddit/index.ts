/**
 * filteReddit (RES filteReddit, US2): hide posts by keyword, subreddit, domain, user, flair, NSFW
 * status, score, comment count, post type, spoiler or user tag, with per-subreddit scoping and
 * regular expressions. Comments can be collapsed or hidden by keyword, author, deleted state or
 * depth. Works on Reddit's own layout; filtered posts can be revealed on demand with the rule that
 * matched.
 *
 * Inline controls (inline.ts): a ⊘ button on each post and a menu item on subreddit pages add or
 * remove rules without opening the settings console. Every post seen on the page is remembered so a
 * rule change (from here or from the console) re-evaluates them at once, without a reload.
 *
 * The banner (ui.ts) holds the counts, a power switch (this page view only, never saved), the
 * show/hide toggle and a link to the rules. The post-and-comment state lives in session.ts.
 */
import { onCommand } from '../../../core/commandEvents';
import { hint } from '../../../core/hints';
import { resolveOptions, setOption } from '../../../core/settings';
import {
  defineModule,
  type ModuleContext,
  type ModuleDefinition,
  type Route,
} from '../../../core/types';
import {
  closeFilterMenu,
  isFiltered,
  planAdd,
  planRemove,
  subredditRule,
  type MenuEntry,
  type Plan,
  type Row,
} from './inline';
import { onExternalReasonsChanged } from './external';
import { COMMENT_ACTIONS, COMMENT_RULE_TYPES, validateCommentRule } from './commentRules';
import type { CommentRule } from './commentRules';
import { BROWSE_HELP } from './browseConditions';
import { COMMENT_CONDITION_HELP } from './commentConditions';
import { POST_CONDITION_HELP } from './postConditions';
import { RULE_SCOPES, RULE_TYPES, needsPattern, validateRule, type FilterRule } from './rules';
import { FilterSession } from './session';

const rowsOf = (ctx: ModuleContext): Row[] =>
  resolveOptions(filteReddit as ModuleDefinition, ctx.settings.profile()).rules as Row[];

let session: FilterSession | null = null;
let removeSubItem: (() => void) | null = null;
let stopExternal: (() => void) | null = null;
let stopCommands: (() => void) | null = null;
/** What the “filter r/name” menu row shows for the current page (set by renderToggle). */
const subRow = { sub: undefined as string | undefined, on: false };

function renderToggle(ctx: ModuleContext): void {
  const sub = ctx.route.kind === 'subreddit' ? ctx.route.subreddit : undefined;
  subRow.sub = ctx.options.subredditPageToggle ? sub : undefined;
  subRow.on = sub ? isFiltered(rowsOf(ctx), subredditRule(sub)) : false;
}

/** Apply new rows at once (compile, re-evaluate), then save them; revert if saving fails. */
async function commit(ctx: ModuleContext, next: Row[]): Promise<void> {
  const before = rowsOf(ctx);
  session?.setRows(ctx, next, false);
  try {
    await ctx.settings.save(
      setOption(ctx.settings.profile(), filteReddit as ModuleDefinition, 'rules', next),
    );
  } catch (err) {
    console.error('[REScue] filteReddit could not save the filter', err);
    session?.setRows(ctx, before, false);
    ctx.notices.show('REScue: the filter could not be saved.', { kind: 'error' });
  }
  renderToggle(ctx);
}

/** Apply `plan` and tell the reader, with an Undo that reverses exactly this change. */
async function change(ctx: ModuleContext, plan: Plan, message: string): Promise<void> {
  await commit(ctx, plan.rows);
  ctx.notices.show(message, {
    id: 'filter-inline',
    timeoutMs: 10000,
    actions: [
      { label: 'Undo', hint: hint.undo, run: () => void commit(ctx, plan.undo(rowsOf(ctx))) },
    ],
  });
}

async function addFilter(ctx: ModuleContext, entry: MenuEntry): Promise<void> {
  const plan = planAdd(rowsOf(ctx), entry.rule);
  if (!plan) {
    ctx.notices.show(`Already filtered: ${entry.label.replace(/^Filter /, '')}.`, {
      id: 'filter-inline',
      timeoutMs: 4000,
    });
    return;
  }
  await change(ctx, plan, entry.done);
}

async function toggleSubreddit(ctx: ModuleContext, route: Route): Promise<void> {
  const sub = route.subreddit;
  if (!sub) return;
  const rule = subredditRule(sub);
  const rows = rowsOf(ctx);
  const plan = isFiltered(rows, rule) ? planRemove(rows, rule) : planAdd(rows, rule);
  if (!plan) return;
  await change(ctx, plan, isFiltered(rows, rule) ? `Unfiltered r/${sub}.` : `Filtered r/${sub}.`);
}

const SUBREDDIT_NAME = /^[A-Za-z0-9_]{2,21}$/;

export const filteReddit = defineModule({
  id: 'filteReddit',
  resId: 'filteReddit',
  category: 'listings',
  title: 'filteReddit',
  description:
    'Hide posts by keyword, subreddit, domain, user, flair, NSFW status, score, comment count, post type, spoiler, locked or user tag. Patterns are plain text (any case) or /regular expressions/flags. Keywords and flair match anywhere; subreddit, domain and user must match exactly. "only"/"except" take a comma-separated subreddit list; include "all" or "popular" to scope a rule to browsing those pages. "score-below 5" hides posts under 5 points, "score-above 5" those over it (same for comments, once Reddit has shown the comment’s score; a hidden score is never filtered); post-type takes text, link, image, video, gallery or crosspost; user-tag matches users you have tagged (blank = any tag). A “filter” button after each post’s time (and a toggle on subreddit pages) adds or removes a subreddit, user or domain filter in one click, with Undo. The bar at the bottom right has a power switch that stops filtering for this page view only (it is not saved). Not available: visited posts, because Reddit does not expose them to extensions.',
  enabledByDefault: true,
  options: {
    rules: {
      type: 'table',
      default: [],
      title: 'Filters',
      description: `Type “custom” takes a condition written in the Pattern column, like RES custom filters: join conditions with and / or / not and parentheses, e.g. score<10 and (domain:imgur.com or flair:meme) and not vote:up. Put values with spaces in quotes: keyword:"hello world". “Only when browsing” limits any row to where or when you are browsing, with the same joining. Conditions for posts:
${POST_CONDITION_HELP}
Conditions for “Only when browsing”: ${BROWSE_HELP}`,
      columns: [
        { key: 'type', title: 'Type', type: 'enum', values: RULE_TYPES },
        { key: 'pattern', title: 'Pattern', type: 'text' },
        { key: 'scope', title: 'Applies', type: 'enum', values: RULE_SCOPES },
        { key: 'subreddits', title: 'Subreddits', type: 'text' },
        { key: 'enabled', title: 'On', type: 'boolean', default: true },
        { key: 'toggle', title: 'Custom toggle', type: 'text' },
        { key: 'when', title: 'Only when browsing', type: 'text' },
      ],
      validateRow: (row) => {
        const r = row as unknown as FilterRule;
        // A blank new row is fine; it is ignored until it has a pattern.
        if (needsPattern(r.type) && !String(r.pattern ?? '').trim() && r.scope === 'everywhere')
          return null;
        return validateRule({
          ...r,
          pattern: String(r.pattern ?? ''),
          subreddits: String(r.subreddits ?? ''),
          toggle: String(r.toggle ?? ''),
        });
      },
    },
    commentRules: {
      type: 'table',
      default: [],
      title: 'Comment filters',
      description: `Type “custom” takes a condition in the Pattern column (join with and / or / not and parentheses, e.g. length<20w and score<0). Conditions for comments:
${COMMENT_CONDITION_HELP}
keyword: text or /regex/ in the comment’s own text. user: the author, exactly. deleted: deleted or removed comments (no pattern). depth: this deep or deeper (0 is a top-level comment). score-below / score-above: a whole number; comments whose score is hidden or not yet loaded are never matched. Collapse keeps replies visible; hide removes the comment and its replies from view. “Only when browsing” limits a row to where or when you are browsing (front, onsub:name, onmulti:name, onuser:name, location:/regex/, loggedin:name, toggle:name, date:A..B, dow:sat,sun, hour:22..6).`,
      columns: [
        { key: 'type', title: 'Type', type: 'enum', values: COMMENT_RULE_TYPES },
        { key: 'pattern', title: 'Pattern', type: 'text' },
        {
          key: 'action',
          title: 'Action',
          type: 'enum',
          values: COMMENT_ACTIONS,
          default: 'collapse',
        },
        { key: 'enabled', title: 'On', type: 'boolean', default: true },
        { key: 'when', title: 'Only when browsing', type: 'text' },
      ],
      validateRow: (row) => {
        const r = row as unknown as CommentRule;
        if (r.type !== 'deleted' && !String(r.pattern ?? '').trim()) return null;
        return validateCommentRule({ ...r, pattern: String(r.pattern ?? '') });
      },
    },
    hideNsfw: { type: 'boolean', default: false, title: 'Hide all NSFW posts' },
    nsfwAllowList: {
      type: 'table',
      default: [],
      title: 'NSFW allow-list',
      description:
        'Subreddits where NSFW posts are never filtered by “Hide all NSFW posts” (your own filters still apply).',
      dependsOn: 'hideNsfw',
      columns: [{ key: 'subreddit', title: 'Subreddit', type: 'text' }],
      validateRow: (row) => {
        const name = String(row.subreddit ?? '')
          .trim()
          .replace(/^\/?r\//i, '');
        return !name || SUBREDDIT_NAME.test(name)
          ? null
          : 'Enter a subreddit name such as nsfw_gifs.';
      },
    },
    filteredDisplay: {
      type: 'enum',
      default: 'hide',
      title: 'Filtered posts',
      description:
        'Hide removes them from the page. A placeholder leaves a one-line “Filtered: reason — show” row where the post was.',
      values: [
        { value: 'hide', label: 'Hide them' },
        { value: 'placeholder', label: 'Leave a one-line placeholder' },
      ],
    },
    excludeOwnPosts: {
      type: 'boolean',
      default: true,
      title: 'Never filter my own posts and comments',
    },
    excludeUserPages: {
      type: 'boolean',
      default: false,
      title: 'Don’t filter on user profile pages',
    },
    showBanner: { type: 'boolean', default: true, title: 'Show how many posts were filtered' },
    showFilterline: {
      type: 'boolean',
      default: false,
      title: 'Always show the filter bar',
      description:
        'Keep the bar (with the on/off switch and a link to these rules) even when nothing is filtered.',
    },
    inlineControls: {
      type: 'boolean',
      default: true,
      title: 'Show a “filter” button on each post',
      description: 'Filter the post’s subreddit, author or link domain in one click, with Undo.',
    },
    subredditPageToggle: {
      type: 'boolean',
      default: true,
      title: 'Show “Filter r/name” in the REScue menu on subreddit pages',
    },
  },

  init(ctx) {
    // Kept across dispose/init so posts seen while switched off are still known when it comes back.
    session ??= new FilterSession({ addFilter: (c, e) => void addFilter(c, e) });
    session.start(ctx);
    stopExternal = onExternalReasonsChanged(() => session?.reevaluate());
    stopCommands = onCommand((req) => {
      if (req.name === 'fp') req.handled = session?.commandPower() ?? false;
      else if (req.name === 'fl') req.handled = session?.commandLine() ?? false;
    });
    removeSubItem = ctx.ui.addMenuItem({
      id: 'filterSubreddit',
      get label() {
        const sub = subRow.sub ?? '';
        return subRow.on ? `Stop filtering r/${sub}` : `Filter r/${sub}`;
      },
      order: 36,
      visible: () => subRow.sub !== undefined,
      hint: () => hint.filterSubToggle(subRow.sub ?? '', subRow.on),
      onClick: () => {
        const c = session?.context() ?? ctx;
        void toggleSubreddit(c, c.route);
      },
    });
    renderToggle(ctx);
  },

  onItems(batch, ctx) {
    session?.items(batch, ctx);
  },

  onRoute(route, ctx) {
    closeFilterMenu();
    session?.route(route, ctx);
    renderToggle({ ...ctx, route });
  },

  onSettings(ctx) {
    session?.settings(ctx);
    renderToggle(ctx);
  },

  dispose() {
    closeFilterMenu();
    stopExternal?.();
    stopExternal = null;
    stopCommands?.();
    stopCommands = null;
    session?.stop();
    removeSubItem?.();
    removeSubItem = null;
    subRow.sub = undefined;
  },
});
