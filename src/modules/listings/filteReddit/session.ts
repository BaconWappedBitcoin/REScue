/**
 * The running state of filteReddit on one page: every post and comment seen, which rule (if any)
 * currently applies to each, and how that is shown (hidden, a placeholder row, a reason chip).
 * Posts and comments seen are remembered so a rule change, the power switch or a display change
 * re-evaluates them at once, without a reload. The module (index.ts) only wires options and the
 * inline ⊘ menu to it.
 */
import type { Comment, Post } from '../../../model/types';
import { ownBody } from '../../../model/access';
import { commentScoreOf, commentThingId, watchCommentRows } from '../../../model/commentRow';
import type { ItemBatch, ModuleContext, Route } from '../../../core/types';
import { customToggleOn } from '../../core/presets';
import { resolveOptions } from '../../../core/settings';
import { sanitizeTags, tagKey } from '../../users/tagStore';
import { userHighlight } from '../../users/userHighlight';
import { sharedReadStore } from '../../comments/readTracking';
import type { PostEnv } from './postConditions';
import type { CommentEnv } from './commentConditions';
import {
  compileCommentRules,
  describeCommentRule,
  matchComment,
  usesScores,
  type CommentRule,
  type CompiledCommentRule,
} from './commentRules';
import { filterButton, menuEntries, openFilterMenu, type MenuEntry, type Row } from './inline';
import {
  compileRules,
  describeRule,
  hideNsfwRule,
  matchPost,
  type CompiledRule,
  type FilterRule,
  type MatchContext,
} from './rules';
import { createBanner, createPlaceholder, reasonChip, setChip, type Banner } from './ui';
import { EmptyNotice } from './empty';
import { externalDetail, externalReason } from './external';
import type { CommentEffect, SeenComment, SeenPost } from './seen';

export interface SessionDeps {
  addFilter(ctx: ModuleContext, entry: MenuEntry): void;
}

const asRows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

export class FilterSession {
  private rules: CompiledRule[] = [];
  private commentRules: CompiledCommentRule[] = [];
  private readonly posts = new Map<string, SeenPost>();
  private readonly comments = new Map<string, SeenComment>();
  /** Comment batches that came while no comment filter was set. */
  private readonly unindexed: Comment[][] = [];
  private readonly commentsApplied = new Set<string>();
  private readonly commentsHeld = new Set<string>();
  private current: ModuleContext | null = null;
  private banner: Banner | null = null;
  private seenPath = '';
  /** Power switch: this page view only, never saved. */
  private powered = true;
  private revealing = false;
  /** "Show reasons" from the everything-filtered notice: placeholders for now, whatever the option. */
  private reasons = false;
  private tags = new Map<string, string>();
  private tagVotes = new Map<string, { up: number; down: number }>();
  private ignoredUsers = new Set<string>();
  private usesTags = false;
  private readonly empty = new EmptyNotice();
  private active = false;
  /** Stops the watch for comment action rows (only while a score rule is set). */
  private stopRows: (() => void) | null = null;

  constructor(private readonly deps: SessionDeps) {}

  context(): ModuleContext | null {
    return this.current;
  }

  // --- lifecycle ------------------------------------------------------------------------------

  start(ctx: ModuleContext): void {
    this.current = ctx;
    this.active = true;
    if (this.seenPath !== ctx.route.path) this.forget();
    // Anything no longer on the page (a module switched off and on again) is not worth keeping.
    for (const [id, e] of this.posts) if (!e.post.source.isConnected) this.posts.delete(id);
    for (const [id, e] of this.comments) {
      if (e.comment.source.isConnected) continue;
      this.comments.delete(id);
      this.commentsApplied.delete(id);
      this.commentsHeld.delete(id);
    }
    this.powered = true;
    this.revealing = false;
    this.reasons = false;
    this.compile(ctx, asRows(ctx.options.rules), true);
    this.banner?.remove();
    this.banner = createBanner({
      addBanner: (el) => ctx.ui.addBanner(el),
      onPower: (on) => this.setPowered(on),
      onReveal: (on) => this.setRevealing(on),
    });
    for (const e of this.posts.values()) {
      if (e.button) e.button.hidden = !ctx.options.inlineControls;
      else if (ctx.route.kind !== 'thread') this.decorateButton(ctx, e);
    }
    this.evaluateAll(ctx);
    void this.refreshTags(ctx);
  }

  /** Switch everything off but remember what was seen, so start() can pick it up again. */
  stop(): void {
    this.active = false;
    for (const e of this.posts.values()) {
      this.unapplyPost(e);
      if (e.button) e.button.hidden = true;
      e.match = undefined;
    }
    for (const e of this.comments.values()) {
      this.applyComment(e, undefined);
      e.match = undefined;
    }
    this.commentsApplied.clear();
    this.commentsHeld.clear();
    if (this.revealing) this.current?.ui.setRevealHidden(false);
    this.revealing = false;
    this.reasons = false;
    this.clearEmpty();
    this.banner?.remove();
    this.banner = null;
    this.rules = [];
    this.commentRules = [];
    this.syncRowWatch();
    this.current = null;
  }

  route(route: Route, ctx: ModuleContext): void {
    this.current = ctx;
    this.forget();
    this.seenPath = route.path;
    if (this.revealing) ctx.ui.setRevealHidden(false);
    this.powered = true;
    this.revealing = false;
    this.reasons = false;
    this.banner?.reset();
    this.chrome(ctx);
  }

  settings(ctx: ModuleContext): void {
    this.current = ctx;
    this.compile(ctx, asRows(ctx.options.rules), true);
    for (const e of this.posts.values())
      if (e.button) e.button.hidden = !ctx.options.inlineControls;
    this.evaluateAll(ctx);
    void this.refreshTags(ctx);
  }

  /** Another module's reasons changed (external.ts): look at every post again. */
  reevaluate(): void {
    if (this.active && this.current) this.evaluateAll(this.current);
  }

  /** New rows from the inline menu (or an Undo): apply at once, before they are saved. */
  setRows(ctx: ModuleContext, rows: Row[], report: boolean): void {
    this.current = ctx;
    this.compile(ctx, rows, report);
    this.evaluateAll(ctx);
  }

  items(batch: ItemBatch, ctx: ModuleContext): void {
    this.current = ctx;
    if (!batch.posts.length && !batch.comments.length) return;
    const fresh: SeenPost[] = [];
    for (const post of batch.posts) {
      this.seenPath = ctx.route.path;
      const known = this.posts.get(post.id);
      if (known) {
        known.post = post;
        fresh.push(known);
        continue;
      }
      const entry = this.newPost(ctx, post);
      this.posts.set(post.id, entry);
      fresh.push(entry);
    }
    this.evaluatePosts(ctx, fresh);
    // A thread with no comment filters costs one array push per batch, not a record per comment.
    if (this.commentRules.length) this.indexComments(ctx, batch.comments);
    else if (batch.comments.length) this.unindexed.push(batch.comments);
    void this.refreshTags(ctx);
    this.chrome(ctx);
  }

  private indexComments(ctx: ModuleContext, list: Comment[]): void {
    for (const comment of list) {
      let entry = this.comments.get(comment.id);
      if (entry) entry.comment = comment;
      else {
        entry = { comment, chip: null, match: undefined, applied: undefined };
        this.comments.set(comment.id, entry);
      }
      this.evaluateComment(ctx, entry);
    }
  }

  private forget(): void {
    for (const e of this.posts.values()) e.holder?.remove();
    this.posts.clear();
    this.comments.clear();
    this.unindexed.length = 0;
    this.commentsApplied.clear();
    this.commentsHeld.clear();
    this.clearEmpty();
  }

  // --- rules ----------------------------------------------------------------------------------

  private compile(ctx: ModuleContext, rows: Row[], report: boolean): void {
    const posts = compileRules([
      ...(rows as unknown as FilterRule[]),
      ...(ctx.options.hideNsfw ? [hideNsfwRule(asRows(ctx.options.nsfwAllowList))] : []),
    ]);
    const lowEffort = ctx.options.hideLowEffort;
    const comments = compileCommentRules([
      ...(asRows(ctx.options.commentRules) as unknown as CommentRule[]),
      ...(lowEffort === 'collapse' || lowEffort === 'hide'
        ? [{ type: 'low-effort', pattern: '', action: lowEffort, enabled: true } as CommentRule]
        : []),
    ]);
    this.rules = posts.rules;
    this.commentRules = comments.rules;
    this.syncRowWatch();
    this.usesTags =
      posts.rules.some((r) => r.source.type === 'user-tag' || r.source.type === 'custom') ||
      comments.rules.some((r) => r.source.type === 'custom');
    const errors = [...posts.errors, ...comments.errors];
    if (report && errors.length) {
      ctx.notices.show(
        `filteReddit: ${errors.length} filter(s) turned off because they are invalid. ${errors.join(' ')}`,
        { kind: 'warning', id: 'filter-errors' },
      );
    }
  }

  private async refreshTags(ctx: ModuleContext): Promise<void> {
    if (!this.usesTags) return;
    const stored = sanitizeTags(await ctx.data.get<unknown>('userTags'));
    const next = new Map<string, string>();
    const votes = new Map<string, { up: number; down: number }>();
    const ignored = new Set<string>();
    for (const [key, tag] of Object.entries(stored)) {
      const k = key.toLowerCase();
      if (tag.text) next.set(k, tag.text);
      if (tag.votesUp || tag.votesDown) votes.set(k, { up: tag.votesUp, down: tag.votesDown });
      if (tag.ignored) ignored.add(k);
    }
    const same =
      next.size === this.tags.size &&
      [...next].every(([k, v]) => this.tags.get(k) === v) &&
      votes.size === this.tagVotes.size &&
      [...votes].every(([k, v]) => {
        const o = this.tagVotes.get(k);
        return o?.up === v.up && o.down === v.down;
      }) &&
      ignored.size === this.ignoredUsers.size;
    this.tags = next;
    this.tagVotes = votes;
    this.ignoredUsers = ignored;
    if (!same && this.active) this.evaluateAll(this.current ?? ctx);
  }

  // --- posts ----------------------------------------------------------------------------------

  private newPost(ctx: ModuleContext, post: Post): SeenPost {
    const entry: SeenPost = {
      post,
      button: null,
      chip: reasonChip(),
      match: undefined,
      reason: undefined,
      applied: undefined,
      holder: null,
      peek: false,
    };
    if (ctx.route.kind !== 'thread') this.decorateButton(ctx, entry);
    ctx.ui.decorate(post, 'tagline', entry.chip);
    return entry;
  }

  private decorateButton(ctx: ModuleContext, entry: SeenPost): void {
    if (!menuEntries(entry.post).length) return;
    entry.button = filterButton((btn) => {
      const cur = this.current ?? ctx;
      openFilterMenu(btn, menuEntries(entry.post), (e) => this.deps.addFilter(cur, e));
    });
    entry.button.hidden = !ctx.options.inlineControls;
    ctx.ui.decorate(entry.post, 'tagline', entry.button);
  }

  private displayMode(ctx: ModuleContext): 'hide' | 'placeholder' {
    return this.reasons || ctx.options.filteredDisplay === 'placeholder' ? 'placeholder' : 'hide';
  }

  private browseEnv(ctx: ModuleContext) {
    const profile = ctx.settings.profile();
    return {
      route: ctx.route,
      location: `${location.pathname}${location.search}`,
      me: ctx.session.username ?? null,
      now: Date.now(),
      toggleOn: (name: string) => customToggleOn(profile, name),
    };
  }

  /** The friends list that the user-highlight module keeps (its "highlight" link edits it). */
  private friends(ctx: ModuleContext): Set<string> {
    const list = resolveOptions(userHighlight, ctx.settings.profile()).friends;
    return new Set(list.map(tagKey).filter(Boolean));
  }

  private matchContext(ctx: ModuleContext): MatchContext {
    const env = this.browseEnv(ctx);
    const friends = this.friends(ctx);
    const postEnv: PostEnv = {
      ...env,
      userTag: (author) => this.tags.get(author),
      votes: (author) => this.tagVotes.get(author),
      friends,
      ignored: (author) => this.ignoredUsers.has(author),
      readPrior: (id) => {
        const store = sharedReadStore();
        return store ? store.prior(id) : null;
      },
    };
    return {
      subreddit: ctx.route.subreddit,
      toggleOn: env.toggleOn,
      userTag: (author) => this.tags.get(author),
      env: postEnv,
    };
  }

  private commentEnv(ctx: ModuleContext): CommentEnv {
    const store = sharedReadStore();
    return {
      ...this.browseEnv(ctx),
      friends: this.friends(ctx),
      userTag: (author) => this.tags.get(author),
      ignored: (author) => this.ignoredUsers.has(author),
      readPrior: store ? store.prior(ctx.route.postId ?? '') : null,
    };
  }

  private evaluateAll(ctx: ModuleContext): void {
    this.evaluatePosts(ctx, this.posts.values());
    // Comments that arrived while there were no comment filters get looked at now.
    if (this.commentRules.length) {
      for (const list of this.unindexed.splice(0)) this.indexComments(ctx, list);
    }
    for (const e of this.comments.values()) this.evaluateComment(ctx, e);
    this.chrome(ctx);
  }

  private evaluatePosts(ctx: ModuleContext, entries: Iterable<SeenPost>): void {
    const skip = ctx.options.excludeUserPages && ctx.route.kind === 'profile';
    const me = ctx.session.username?.toLowerCase();
    const matchCtx = this.matchContext(ctx);
    for (const entry of entries) {
      const { post } = entry;
      const own = ctx.options.excludeOwnPosts && me && post.author?.toLowerCase() === me;
      const rule = skip || own || !this.rules.length ? null : matchPost(post, this.rules, matchCtx);
      // Reasons other modules supply (external.ts) count the same as a rule of the reader's own.
      entry.match = rule ? describeRule(rule) : skip || own ? undefined : externalReason(post, ctx);
      entry.reason = this.powered ? entry.match : undefined;
      this.presentPost(ctx, entry);
    }
  }

  /** Make the page show `entry` the way its current reason and the display mode call for. */
  private presentPost(ctx: ModuleContext, e: SeenPost): void {
    if (!e.reason) e.peek = false;
    const placeholder = !!e.reason && !this.revealing && this.displayMode(ctx) === 'placeholder';
    const hideReason = e.reason && !(placeholder && e.peek) ? e.reason : undefined;
    if (e.applied !== hideReason) {
      if (e.applied) ctx.ui.unhide(e.post, e.applied);
      if (hideReason) ctx.ui.hide(e.post, hideReason);
      e.applied = hideReason;
    }
    if (placeholder && e.reason) {
      e.holder ??= createPlaceholder(() => {
        e.peek = !e.peek;
        this.presentPost(this.current ?? ctx, e);
      });
      e.holder.set(e.reason, e.peek);
      e.holder.place(e.post.source);
    } else if (e.holder) {
      e.holder.remove();
      e.holder = null;
    }
    setChip(e.chip, e.reason, 'Filtered', externalDetail(e.post.id, e.reason));
  }

  private unapplyPost(e: SeenPost): void {
    if (e.applied) this.current?.ui.unhide(e.post, e.applied);
    e.applied = undefined;
    e.reason = undefined;
    e.peek = false;
    e.holder?.remove();
    e.holder = null;
    setChip(e.chip, undefined);
  }

  // --- comments -------------------------------------------------------------------------------

  /** Comment scores are known only once an action row hydrates: watch for rows while a rule needs one. */
  private syncRowWatch(): void {
    const want = usesScores(this.commentRules);
    if (!want) {
      this.stopRows?.();
      this.stopRows = null;
    } else if (!this.stopRows) {
      this.stopRows = watchCommentRows((host) => {
        const id = commentThingId(host);
        const entry = id ? this.comments.get(id) : undefined;
        if (!entry || !this.current) return;
        this.evaluateComment(this.current, entry);
        this.chrome(this.current);
      });
    }
  }

  private evaluateComment(ctx: ModuleContext, e: SeenComment): void {
    // The common case, a thread with no comment filters: nothing to do for thousands of comments.
    if (!this.commentRules.length && !e.match && !e.applied) return;
    const me = ctx.session.username?.toLowerCase();
    const { comment } = e;
    const own = ctx.options.excludeOwnPosts && me && comment.author?.toLowerCase() === me;
    const rule =
      own || !this.commentRules.length
        ? null
        : matchComment(
            {
              author: comment.author,
              depth: comment.depth,
              score: usesScores(this.commentRules) ? commentScoreOf(comment.source) : null,
              body: ownBody(comment.source)?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
              isOp: comment.isOp,
              distinguished: comment.distinguished,
              created: comment.created,
            },
            this.commentRules,
            this.commentEnv(ctx),
          );
    e.match = rule ? { reason: describeCommentRule(rule), action: rule.action } : undefined;
    this.applyComment(e, this.powered ? e.match : undefined);
    this.countComment(comment.id, e);
  }

  /** Put the comment into the state `want` (hidden / collapsed / untouched), undoing only our own. */
  private applyComment(e: SeenComment, want: CommentEffect | undefined): void {
    const ui = this.current?.ui;
    const was = e.applied;
    if (was?.reason === want?.reason && was?.action === want?.action) return;
    if (ui && was) {
      if (was.action === 'hide') ui.unhide(e.comment, was.reason);
      else ui.collapseBody(e.comment, false);
    }
    if (ui && want) {
      if (want.action === 'hide') ui.hide(e.comment, want.reason);
      else ui.collapseBody(e.comment, true);
    }
    e.applied = want;
    if (!e.chip && want && ui) {
      e.chip = reasonChip();
      ui.decorate(e.comment, 'tagline', e.chip);
    }
    if (e.chip)
      setChip(e.chip, want?.reason, want?.action === 'collapse' ? 'Collapsed' : 'Filtered');
  }

  /** Keep the running counts in step with one comment; the page can hold thousands. */
  private countComment(id: string, e: SeenComment): void {
    this.commentsApplied[e.applied ? 'add' : 'delete'](id);
    this.commentsHeld[!e.applied && e.match ? 'add' : 'delete'](id);
  }

  // --- page chrome ----------------------------------------------------------------------------

  private tally() {
    let posts = 0;
    let held = this.commentsHeld.size;
    for (const e of this.posts.values()) {
      if (e.reason) posts++;
      else if (e.match) held++;
    }
    return { posts, comments: this.commentsApplied.size, held };
  }

  private chrome(ctx: ModuleContext): void {
    const t = this.tally();
    this.banner?.update({
      ...t,
      powered: this.powered,
      always: !!ctx.options.showFilterline,
      counts: !!ctx.options.showBanner,
    });
    this.scheduleEmptyCheck(ctx);
  }

  /** The `fp` command. False when the page is not being filtered (module off). */
  commandPower(): boolean {
    if (!this.active || !this.banner) return false;
    this.banner.togglePower();
    return true;
  }

  /** The `fl` command. */
  commandLine(): boolean {
    if (!this.active || !this.banner) return false;
    this.banner.togglePinned();
    return true;
  }

  private setPowered(on: boolean): void {
    const ctx = this.current;
    if (!ctx) return;
    this.powered = on;
    this.reasons = false;
    if (this.revealing) ctx.ui.setRevealHidden(false);
    this.revealing = false;
    this.evaluateAll(ctx);
  }

  private setRevealing(on: boolean): void {
    const ctx = this.current;
    if (!ctx) return;
    this.revealing = on;
    ctx.ui.setRevealHidden(on);
    for (const e of this.posts.values()) this.presentPost(ctx, e);
    this.chrome(ctx);
  }

  // --- "everything is filtered" ---------------------------------------------------------------

  private clearEmpty(): void {
    this.empty.clear(this.current);
  }

  private scheduleEmptyCheck(ctx: ModuleContext): void {
    if (ctx.route.kind === 'thread' || !this.posts.size) return this.empty.dismiss(ctx);
    this.empty.schedule(
      () => this.current,
      () => this.everyPostHidden(),
      {
        showFiltered: () => {
          this.banner?.setRevealing(true);
          this.setRevealing(true);
        },
        showReasons: () => {
          this.reasons = true;
          if (this.current) this.evaluateAll(this.current);
        },
      },
    );
  }

  /** Every post on the page is hidden (not just collapsed into a placeholder or revealed). */
  private everyPostHidden(): boolean {
    const ctx = this.current;
    return (
      !!ctx &&
      this.active &&
      this.powered &&
      !this.revealing &&
      ctx.route.kind !== 'thread' &&
      this.displayMode(ctx) === 'hide' &&
      this.posts.size > 0 &&
      this.tally().posts === this.posts.size
    );
  }
}
