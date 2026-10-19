import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleContext, NoticeAction, OptionValue } from '../../src/core/types';
import type { Post } from '../../src/model/types';
import {
  compileCommentRules,
  describeCommentRule,
  isDeleted,
  matchComment,
  validateCommentRule,
  type CommentRule,
} from '../../src/modules/listings/filteReddit/commentRules';
import { filteReddit } from '../../src/modules/listings/filteReddit';
import {
  compileRules,
  describeRule,
  matchPost,
  validateRule,
  type FilterRule,
  type MatchContext,
} from '../../src/modules/listings/filteReddit/rules';
import { EMPTY_DELAY_MS } from '../../src/modules/listings/filteReddit/empty';
import { listingHtml, mount, nestedThreadHtml, threadComments } from '../fixtures/pages';
import { bootModules, tick } from './module-harness';

const post = (over: Partial<Post> = {}): Post =>
  ({
    kind: 'post',
    id: 't3_x',
    title: 'Rust 2.0 released',
    permalink: '/r/programming/comments/x/rust/',
    url: null,
    type: 'link',
    domain: 'blog.rust-lang.org',
    author: 'ferris',
    subreddit: 'programming',
    score: 100,
    upvoteRatio: 1,
    commentCount: 20,
    created: null,
    flair: null,
    nsfw: false,
    spoiler: false,
    thumbnail: null,
    media: null,
    feedIndex: null,
    bodyHtml: null,
    source: document.createElement('div'),
    ...over,
  }) as Post;

const rule = (over: Partial<FilterRule>): FilterRule => ({
  type: 'keyword',
  pattern: '',
  scope: 'everywhere',
  subreddits: '',
  enabled: true,
  toggle: '',
  ...over,
});

const ctxOf = (over: Partial<MatchContext> = {}): MatchContext => ({
  subreddit: 'programming',
  toggleOn: () => true,
  ...over,
});
const hit = (r: FilterRule, p: Post = post(), ctx: MatchContext = ctxOf()) => {
  const { rules, errors } = compileRules([r]);
  expect(errors).toEqual([]);
  return matchPost(p, rules, ctx) !== null;
};

describe('more post rule types', () => {
  it('score-below hides posts under the threshold, never when the score is unknown', () => {
    expect(hit(rule({ type: 'score-below', pattern: '200' }))).toBe(true);
    expect(hit(rule({ type: 'score-below', pattern: '100' }))).toBe(false);
    expect(hit(rule({ type: 'score-below', pattern: '200' }), post({ score: null }))).toBe(false);
    expect(hit(rule({ type: 'score-below', pattern: '0' }), post({ score: -3 }))).toBe(true);
  });

  it('score-above hides posts over the threshold', () => {
    expect(hit(rule({ type: 'score-above', pattern: '50' }))).toBe(true);
    expect(hit(rule({ type: 'score-above', pattern: '100' }))).toBe(false);
    expect(hit(rule({ type: 'score-above', pattern: '50' }), post({ score: null }))).toBe(false);
  });

  it('comments-below / comments-above compare the comment count', () => {
    expect(hit(rule({ type: 'comments-below', pattern: '21' }))).toBe(true);
    expect(hit(rule({ type: 'comments-below', pattern: '20' }))).toBe(false);
    expect(hit(rule({ type: 'comments-above', pattern: '19' }))).toBe(true);
    expect(hit(rule({ type: 'comments-above', pattern: '20' }))).toBe(false);
  });

  it('post-type matches the post type, any case', () => {
    expect(hit(rule({ type: 'post-type', pattern: 'link' }))).toBe(true);
    expect(hit(rule({ type: 'post-type', pattern: 'IMAGE' }), post({ type: 'image' }))).toBe(true);
    expect(hit(rule({ type: 'post-type', pattern: 'video' }))).toBe(false);
  });

  it('spoiler matches spoiler posts and needs no pattern', () => {
    expect(hit(rule({ type: 'spoiler' }), post({ spoiler: true }))).toBe(true);
    expect(hit(rule({ type: 'spoiler' }))).toBe(false);
  });

  it('user-tag: any tag when blank, else a substring of the tag text', () => {
    const tags = new Map([['ferris', 'Rust fan']]);
    const withTags = ctxOf({ userTag: (a) => tags.get(a) });
    expect(hit(rule({ type: 'user-tag' }), post(), withTags)).toBe(true);
    expect(hit(rule({ type: 'user-tag', pattern: 'rust' }), post(), withTags)).toBe(true);
    expect(hit(rule({ type: 'user-tag', pattern: 'go' }), post(), withTags)).toBe(false);
    expect(hit(rule({ type: 'user-tag' }), post({ author: 'nobody' }), withTags)).toBe(false);
    expect(hit(rule({ type: 'user-tag' }), post({ author: null }), withTags)).toBe(false);
    expect(hit(rule({ type: 'user-tag' }), post(), ctxOf())).toBe(false);
  });

  it('scope still applies to the new types', () => {
    const r = rule({ type: 'score-below', pattern: '200', scope: 'only', subreddits: 'other' });
    expect(hit(r)).toBe(false);
  });

  it('validates the new types at input', () => {
    expect(validateRule(rule({ type: 'score-below', pattern: 'abc' }))).toMatch(/whole number/);
    expect(validateRule(rule({ type: 'comments-above', pattern: '1.5' }))).toMatch(/whole number/);
    expect(validateRule(rule({ type: 'score-below', pattern: '-5' }))).toBeNull();
    expect(validateRule(rule({ type: 'post-type', pattern: 'poll' }))).toMatch(/Post type/);
    expect(validateRule(rule({ type: 'post-type', pattern: 'Gallery' }))).toBeNull();
    expect(validateRule(rule({ type: 'spoiler' }))).toBeNull();
    expect(validateRule(rule({ type: 'user-tag' }))).toBeNull();
    expect(validateRule(rule({ type: 'user-tag', pattern: '/(/' }))).toMatch(/regular expression/);
    expect(validateRule(rule({ type: 'score-below', pattern: '' }))).toMatch(/pattern/);
  });

  it('a blank new row of a numeric type is skipped silently', () => {
    expect(compileRules([rule({ type: 'score-below' })])).toEqual({ rules: [], errors: [] });
  });

  it('describes each rule for the reason chip', () => {
    expect(describeRule(rule({ type: 'score-below', pattern: '5' }))).toBe('score-below: 5');
    expect(describeRule(rule({ type: 'spoiler' }))).toBe('spoiler');
    expect(describeRule(rule({ type: 'user-tag' }))).toBe('tagged user');
    expect(describeRule(rule({ type: 'user-tag', pattern: 'troll' }))).toBe('user tag: troll');
  });
});

describe('comment rules', () => {
  const crule = (over: Partial<CommentRule>): CommentRule => ({
    type: 'keyword',
    pattern: '',
    action: 'collapse',
    enabled: true,
    ...over,
  });
  const facts = (over: Partial<{ author: string | null; depth: number; body: string }> = {}) => ({
    author: 'bob' as string | null,
    depth: 0,
    body: 'Hello World',
    ...over,
  });
  const first = (r: CommentRule, f = facts()) => {
    const { rules, errors } = compileCommentRules([r]);
    expect(errors).toEqual([]);
    return matchComment(f, rules);
  };

  it('keyword: text in the body (any case) or a regex', () => {
    expect(first(crule({ pattern: 'hello' }))).not.toBeNull();
    expect(first(crule({ pattern: '/^world/i' }))).toBeNull();
    expect(first(crule({ pattern: '/world$/i' }))).not.toBeNull();
  });

  it('user: exact author, any case', () => {
    expect(first(crule({ type: 'user', pattern: 'BOB' }))).not.toBeNull();
    expect(first(crule({ type: 'user', pattern: 'bo' }))).toBeNull();
    expect(first(crule({ type: 'user', pattern: 'bob' }), facts({ author: null }))).toBeNull();
  });

  it('deleted: no author, [deleted] or [removed] bodies', () => {
    const r = crule({ type: 'deleted' });
    expect(first(r, facts({ author: null }))).not.toBeNull();
    expect(first(r, facts({ body: '[removed]' }))).not.toBeNull();
    expect(first(r, facts({ body: ' [deleted] ' }))).not.toBeNull();
    expect(first(r, facts({ body: 'I deleted it' }))).toBeNull();
    expect(isDeleted(facts())).toBe(false);
  });

  it('depth: this deep or deeper', () => {
    const r = crule({ type: 'depth', pattern: '2' });
    expect(first(r, facts({ depth: 1 }))).toBeNull();
    expect(first(r, facts({ depth: 2 }))).not.toBeNull();
    expect(first(r, facts({ depth: 5 }))).not.toBeNull();
    expect(first(crule({ type: 'depth', pattern: '0' }), facts({ depth: 0 }))).not.toBeNull();
  });

  it('the first matching rule wins and carries its action', () => {
    const { rules } = compileCommentRules([
      crule({ pattern: 'hello', action: 'hide' }),
      crule({ type: 'user', pattern: 'bob', action: 'collapse' }),
    ]);
    expect(matchComment(facts(), rules)!.action).toBe('hide');
  });

  it('validates at input and skips incomplete rows', () => {
    expect(validateCommentRule(crule({ pattern: '/(/' }))).toMatch(/regular expression/);
    expect(validateCommentRule(crule({ type: 'depth', pattern: 'x' }))).toMatch(/whole number/);
    expect(validateCommentRule(crule({ type: 'deleted' }))).toBeNull();
    expect(validateCommentRule(crule({ pattern: '' }))).toMatch(/pattern/);
    expect(validateCommentRule(crule({ pattern: 'a', action: 'nuke' as never }))).toMatch(
      /collapse or hide/,
    );
    const { rules, errors } = compileCommentRules([
      crule({ pattern: '' }),
      crule({ pattern: '/(/' }),
      crule({ pattern: 'ok', enabled: false }),
    ]);
    expect(rules).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('describes a rule', () => {
    expect(describeCommentRule(crule({ type: 'deleted' }))).toBe('deleted comment');
    expect(describeCommentRule(crule({ type: 'depth', pattern: '3' }))).toBe('depth 3 or deeper');
    expect(describeCommentRule(crule({ pattern: 'spam' }))).toBe('comment keyword: spam');
  });
});

// --- the module on a page ------------------------------------------------------------------

const LISTING = { kind: 'all', path: '/r/all/', subreddit: 'all' };
const THREAD = { kind: 'thread', path: '/r/Layoffs/comments/text1/got_laid_off/' };

interface BootArgs {
  html: string;
  route: typeof LISTING | typeof THREAD;
  options?: Record<string, OptionValue>;
  stored?: Record<string, unknown>;
  username?: string;
}

async function boot({ html, route, options = {}, stored, username }: BootArgs) {
  mount(html);
  const m = await bootModules([filteReddit], {
    route,
    stored,
    username,
    options: { filteReddit: options },
  });
  const ctx = m.ctxs.get('filteReddit')! as ModuleContext;
  const notices: Array<{ message: string; actions: NoticeAction[]; id?: string }> = [];
  const dismissed: string[] = [];
  ctx.notices = {
    show: (message, o) => notices.push({ message, actions: o?.actions ?? [], id: o?.id }),
    dismiss: (id) => void dismissed.push(id),
  };
  filteReddit.onRoute!(ctx.route, ctx as never); // forget posts remembered by earlier tests
  m.flush();
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
  else await tick();
  return { m, ctx, notices, dismissed };
}

const banner = () => document.querySelector<HTMLElement>('.rescue-filter-banner')!;
const press = (el: Element | null) => (el as HTMLElement).click();

describe('filteReddit on a listing', () => {
  beforeEach(() => document.body.replaceChildren());
  afterEach(() => {
    vi.useRealTimers();
    filteReddit.dispose?.();
  });

  const keywordLaid: Record<string, OptionValue> = {
    rules: [{ type: 'keyword', pattern: 'laid', scope: 'everywhere', enabled: true }],
  };

  it('power switch: off lets the post through and counts what is held; on re-applies', async () => {
    const { m } = await boot({ html: listingHtml(), route: LISTING, options: keywordLaid });
    expect(m.deco.hiddenReason('t3_text1')).toBe('keyword: laid');
    expect(banner().textContent).toContain('1 post filtered');
    const power = banner().querySelector('.rescue-filter-power')!;
    expect(power.textContent).toBe('Filters on');

    press(power);
    expect(m.deco.hiddenReason('t3_text1')).toBeUndefined();
    expect(power.textContent).toBe('Filters off');
    expect(power.getAttribute('aria-pressed')).toBe('false');
    expect(banner().hidden).toBe(false);
    expect(banner().textContent).toContain('Filters off · 1 item would be filtered');

    press(power);
    expect(m.deco.hiddenReason('t3_text1')).toBe('keyword: laid');
    expect(banner().textContent).toContain('1 post filtered');
  });

  it('power switch is per page view: moving to another page turns filtering back on', async () => {
    const { m, ctx } = await boot({ html: listingHtml(), route: LISTING, options: keywordLaid });
    press(banner().querySelector('.rescue-filter-power'));
    expect(m.deco.hiddenReason('t3_text1')).toBeUndefined();
    filteReddit.onRoute!(
      { kind: 'popular', path: '/r/popular/', subreddit: 'popular' },
      ctx as never,
    );
    expect(banner().querySelector('.rescue-filter-power')!.textContent).toBe('Filters on');
    m.flush();
  });

  it('the banner links to the rules', async () => {
    await boot({ html: listingHtml(), route: LISTING, options: keywordLaid });
    expect(
      banner().querySelector<HTMLAnchorElement>('a.rescue-filter-rules')!.getAttribute('href'),
    ).toBe('#rescue:settings/filteReddit');
  });

  it('showFilterline keeps the banner visible with nothing filtered; otherwise it stays away', async () => {
    await boot({ html: listingHtml(), route: LISTING });
    expect(document.querySelector('.rescue-filter-banner')).toBeNull();
    filteReddit.dispose?.();
    document.body.replaceChildren();
    await boot({ html: listingHtml(), route: LISTING, options: { showFilterline: true } });
    expect(banner().hidden).toBe(false);
    expect(banner().textContent).toContain('No posts filtered');
    expect(banner().querySelector('.rescue-filter-toggle')!.hasAttribute('hidden')).toBe(true);
  });

  it('shows a visible reason chip on a revealed post, and withdraws it when no rule matches', async () => {
    const { m, ctx } = await boot({ html: listingHtml(), route: LISTING, options: keywordLaid });
    const chip = document.querySelector<HTMLElement>('#t3_text1 .rescue-filter-reason')!;
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe('Filtered: keyword: laid');
    // Reveal: the post is shown (outlined) and the chip is part of it.
    press(banner().querySelector('.rescue-filter-toggle'));
    expect(m.deco.revealing()).toBe(true);
    expect(
      document.querySelector('article:has(#t3_text1)')!.getAttribute('data-rescue-hidden'),
    ).toBe('keyword: laid');
    expect(document.querySelector('#t3_link1 .rescue-filter-reason')!.hasAttribute('hidden')).toBe(
      true,
    );

    (ctx as { options: unknown }).options = { ...ctx.options, rules: [] };
    filteReddit.onSettings!(ctx as never);
    expect(chip.hidden).toBe(true);
  });

  describe('everything filtered', () => {
    const all: Record<string, OptionValue> = {
      rules: [{ type: 'keyword', pattern: '/./', scope: 'everywhere', enabled: true }],
    };

    it('tells the reader, with Show filtered', async () => {
      vi.useFakeTimers();
      const { m, notices } = await boot({ html: listingHtml(), route: LISTING, options: all });
      expect(notices).toEqual([]);
      vi.advanceTimersByTime(EMPTY_DELAY_MS + 1);
      const n = notices.find((x) => x.id === 'filter-all-hidden')!;
      expect(n.message).toBe('Every post on this page is filtered.');
      expect(n.actions.map((a) => a.label)).toEqual(['Show filtered', 'Show reasons']);
      n.actions[0]!.run();
      expect(m.deco.revealing()).toBe(true);
      expect(banner().querySelector('.rescue-filter-toggle')!.textContent).toBe('hide');
    });

    it('Show reasons lists one placeholder per post without revealing them', async () => {
      vi.useFakeTimers();
      const { m, notices } = await boot({ html: listingHtml(), route: LISTING, options: all });
      vi.advanceTimersByTime(EMPTY_DELAY_MS + 1);
      notices.find((x) => x.id === 'filter-all-hidden')!.actions[1]!.run();
      expect(m.deco.revealing()).toBe(false);
      expect(m.deco.hiddenReason('t3_text1')).toBe('keyword: /./');
      const rows = document.querySelectorAll('.rescue-filter-placeholder');
      expect(rows.length).toBe(7);
      expect(rows[0]!.textContent).toBe('Filtered: keyword: /./ —show');
    });

    it('does not appear when some post is still shown', async () => {
      vi.useFakeTimers();
      const some: Record<string, OptionValue> = {
        rules: [{ type: 'keyword', pattern: 'laid', scope: 'everywhere', enabled: true }],
      };
      const { notices } = await boot({ html: listingHtml(), route: LISTING, options: some });
      vi.advanceTimersByTime(EMPTY_DELAY_MS + 1);
      expect(notices).toEqual([]);
    });

    it('is not shown while filtering is switched off', async () => {
      vi.useFakeTimers();
      const { notices } = await boot({ html: listingHtml(), route: LISTING, options: all });
      press(banner().querySelector('.rescue-filter-power'));
      vi.advanceTimersByTime(EMPTY_DELAY_MS + 1);
      expect(notices).toEqual([]);
    });
  });

  describe('placeholder mode', () => {
    const placeholder: Record<string, OptionValue> = {
      ...keywordLaid,
      filteredDisplay: 'placeholder',
    };

    it('collapses the post and leaves a one-line row at its place', async () => {
      const { m } = await boot({ html: listingHtml(), route: LISTING, options: placeholder });
      const article = document.querySelector<HTMLElement>('article:has(#t3_text1)')!;
      expect(m.deco.hiddenReason('t3_text1')).toBe('keyword: laid');
      expect(article.style.display).toBe('none');
      const row = article.previousElementSibling as HTMLElement;
      expect(row.classList.contains('rescue-filter-placeholder')).toBe(true);
      expect(row.textContent).toBe('Filtered: keyword: laid —show');
      // Other posts have no row.
      expect(document.querySelectorAll('.rescue-filter-placeholder')).toHaveLength(1);
    });

    it('show opens just that post; hide closes it again', async () => {
      const { m } = await boot({ html: listingHtml(), route: LISTING, options: placeholder });
      const article = document.querySelector<HTMLElement>('article:has(#t3_text1)')!;
      const btn = () =>
        document.querySelector<HTMLButtonElement>('.rescue-filter-placeholder-btn')!;
      press(btn());
      expect(m.deco.hiddenReason('t3_text1')).toBeUndefined();
      expect(article.style.display).not.toBe('none');
      expect(btn().textContent).toBe('hide');
      press(btn());
      expect(m.deco.hiddenReason('t3_text1')).toBe('keyword: laid');
      expect(btn().textContent).toBe('show');
    });

    it('the power switch removes the rows; switching back brings them back', async () => {
      await boot({ html: listingHtml(), route: LISTING, options: placeholder });
      const power = banner().querySelector('.rescue-filter-power')!;
      press(power);
      expect(document.querySelectorAll('.rescue-filter-placeholder')).toHaveLength(0);
      press(power);
      expect(document.querySelectorAll('.rescue-filter-placeholder')).toHaveLength(1);
    });

    it('switching the option back to hide removes the row', async () => {
      const { m, ctx } = await boot({ html: listingHtml(), route: LISTING, options: placeholder });
      (ctx as { options: unknown }).options = { ...ctx.options, filteredDisplay: 'hide' };
      filteReddit.onSettings!(ctx as never);
      expect(document.querySelectorAll('.rescue-filter-placeholder')).toHaveLength(0);
      expect(m.deco.hiddenReason('t3_text1')).toBe('keyword: laid');
    });

    it('hide mode leaves no rows', async () => {
      await boot({ html: listingHtml(), route: LISTING, options: keywordLaid });
      expect(document.querySelectorAll('.rescue-filter-placeholder')).toHaveLength(0);
    });
  });

  describe('new rule types, live', () => {
    it('score, comment count, post type and spoiler hide the right fixture posts', async () => {
      const rule = (type: string, pattern = '') => ({
        type,
        pattern,
        scope: 'everywhere',
        enabled: true,
      });
      const { m } = await boot({
        html: listingHtml(),
        route: LISTING,
        options: {
          rules: [
            rule('score-above', '40000'),
            rule('comments-below', '2'),
            rule('post-type', 'gallery'),
          ],
        },
      });
      expect(m.deco.hiddenReason('t3_image1')).toBe('score-above: 40000');
      expect(m.deco.hiddenReason('t3_safeflag1')).toBe('comments-below: 2');
      expect(m.deco.hiddenReason('t3_gallery1')).toBe('post-type: gallery');
      expect(m.deco.hiddenReason('t3_text1')).toBeUndefined();
    });

    it('user-tag reads the tags REScue holds', async () => {
      const { m } = await boot({
        html: listingHtml(),
        route: LISTING,
        options: {
          rules: [{ type: 'user-tag', pattern: 'troll', scope: 'everywhere', enabled: true }],
        },
        stored: {
          userTags: {
            kleudorian: {
              username: 'kleudorian',
              text: 'Troll',
              voteTally: 0,
              ignored: false,
              updatedAt: 1,
            },
            dogperson: {
              username: 'dogperson',
              text: 'nice',
              voteTally: 0,
              ignored: false,
              updatedAt: 1,
            },
          },
        },
      });
      expect(m.deco.hiddenReason('t3_link1')).toBe('user tag: troll');
      expect(m.deco.hiddenReason('t3_image1')).toBeUndefined();
    });
  });

  describe('NSFW allow-list', () => {
    it('hideNsfw hides NSFW posts, except in listed subreddits', async () => {
      const { m } = await boot({
        html: listingHtml(),
        route: LISTING,
        options: { hideNsfw: true },
      });
      expect(m.deco.hiddenReason('t3_nsfw1')).toBe('NSFW');
      filteReddit.dispose?.();
      document.body.replaceChildren();
      const allowed = await boot({
        html: listingHtml(),
        route: LISTING,
        options: { hideNsfw: true, nsfwAllowList: [{ subreddit: 'r/War' }] },
      });
      expect(allowed.m.deco.hiddenReason('t3_nsfw1')).toBeUndefined();
    });

    it('does not exempt an explicit NSFW rule', async () => {
      const { m } = await boot({
        html: listingHtml(),
        route: LISTING,
        options: {
          rules: [{ type: 'nsfw', pattern: '', scope: 'everywhere', enabled: true }],
          nsfwAllowList: [{ subreddit: 'war' }],
        },
      });
      expect(m.deco.hiddenReason('t3_nsfw1')).toBe('NSFW');
    });
  });
});

describe('comment filters on a thread', () => {
  beforeEach(() => document.body.replaceChildren());
  afterEach(() => filteReddit.dispose?.());

  const comments = threadComments();
  const html = () => nestedThreadHtml(comments, false, true);
  const crule = (type: string, pattern: string, action: string) => ({
    type,
    pattern,
    action,
    enabled: true,
  });

  it('collapse keeps replies and shows a "Collapsed" chip; hide takes the comment out', async () => {
    const { m } = await boot({
      html: html(),
      route: THREAD,
      options: {
        commentRules: [
          crule('keyword', 'comment 0 body', 'collapse'),
          crule('keyword', 'comment 4 body', 'hide'),
        ],
      },
    });
    expect(m.deco.bodyCollapsed('t1_c0')).toBe(true);
    expect(m.deco.hiddenReason('t1_c0')).toBeUndefined();
    expect(m.deco.hiddenReason('t1_c1')).toBeUndefined(); // a reply, untouched
    expect(m.deco.hiddenReason('t1_c4')).toBe('comment keyword: comment 4 body');
    const chip = document.querySelector<HTMLElement>(
      'shreddit-comment[thingid="t1_c0"] .rescue-filter-reason',
    )!;
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe('Collapsed: comment keyword: comment 0 body');
    expect(banner().textContent).toContain('2 comments filtered');
  });

  it('user and depth rules', async () => {
    const { m } = await boot({
      html: html(),
      route: THREAD,
      options: {
        commentRules: [crule('user', 'user6', 'hide'), crule('depth', '3', 'collapse')],
      },
    });
    expect(m.deco.hiddenReason('t1_c6')).toBe('comment user: user6');
    const deep = comments.filter((c) => c.depth >= 3).map((c) => c.id);
    expect(deep.length).toBeGreaterThan(0);
    for (const id of deep) expect(m.deco.bodyCollapsed(id)).toBe(true);
    expect(m.deco.bodyCollapsed('t1_c0')).toBe(false);
  });

  it('deleted comments, by author and by body', async () => {
    const withDeleted = comments.map((c) =>
      c.id === 't1_c2'
        ? { ...c, body: '[removed]' }
        : c.id === 't1_c3'
          ? { ...c, author: '[deleted]' }
          : c,
    );
    const { m } = await boot({
      html: nestedThreadHtml(withDeleted, false, true),
      route: THREAD,
      options: { commentRules: [crule('deleted', '', 'collapse')] },
    });
    expect(m.deco.bodyCollapsed('t1_c2')).toBe(true);
    expect(m.deco.bodyCollapsed('t1_c3')).toBe(true);
    expect(m.deco.bodyCollapsed('t1_c5')).toBe(false);
  });

  it('only the comment’s own text counts, not its replies’', async () => {
    const { m } = await boot({
      html: html(),
      route: THREAD,
      options: { commentRules: [crule('keyword', 'comment 1 body', 'hide')] },
    });
    expect(m.deco.hiddenReason('t1_c1')).toBeDefined();
    expect(m.deco.hiddenReason('t1_c0')).toBeUndefined(); // c1 is c0's reply
  });

  it('the power switch uncollapses and unhides, and turning it on re-applies', async () => {
    const { m } = await boot({
      html: html(),
      route: THREAD,
      options: {
        commentRules: [
          crule('keyword', 'comment 0 body', 'collapse'),
          crule('keyword', 'comment 4 body', 'hide'),
        ],
      },
    });
    const power = banner().querySelector('.rescue-filter-power')!;
    press(power);
    expect(m.deco.bodyCollapsed('t1_c0')).toBe(false);
    expect(m.deco.hiddenReason('t1_c4')).toBeUndefined();
    expect(banner().textContent).toContain('Filters off · 2 items would be filtered');
    press(power);
    expect(m.deco.bodyCollapsed('t1_c0')).toBe(true);
    expect(m.deco.hiddenReason('t1_c4')).toBeDefined();
  });

  it('never filters my own comments', async () => {
    const own = comments.map((c) => (c.id === 't1_c0' ? { ...c, author: 'me_the_reader' } : c));
    const { m } = await boot({
      html: nestedThreadHtml(own, false, true),
      route: THREAD,
      username: 'me_the_reader',
      options: { commentRules: [crule('keyword', 'comment 0 body', 'hide')] },
    });
    expect(m.deco.hiddenReason('t1_c0')).toBeUndefined();
  });

  it('a comment filter added later applies to comments that arrived without one', async () => {
    const { m, ctx } = await boot({ html: html(), route: THREAD });
    expect(m.deco.hiddenReason('t1_c4')).toBeUndefined();
    (ctx as { options: unknown }).options = {
      ...ctx.options,
      commentRules: [crule('keyword', 'comment 4 body', 'hide')],
    };
    filteReddit.onSettings!(ctx as never);
    expect(m.deco.hiddenReason('t1_c4')).toBe('comment keyword: comment 4 body');
  });

  it('changing the comment rules re-evaluates comments already seen', async () => {
    const { m, ctx } = await boot({
      html: html(),
      route: THREAD,
      options: { commentRules: [crule('keyword', 'comment 0 body', 'hide')] },
    });
    expect(m.deco.hiddenReason('t1_c0')).toBeDefined();
    (ctx as { options: unknown }).options = {
      ...ctx.options,
      commentRules: [crule('keyword', 'comment 0 body', 'collapse')],
    };
    filteReddit.onSettings!(ctx as never);
    expect(m.deco.hiddenReason('t1_c0')).toBeUndefined();
    expect(m.deco.bodyCollapsed('t1_c0')).toBe(true);
    (ctx as { options: unknown }).options = { ...ctx.options, commentRules: [] };
    filteReddit.onSettings!(ctx as never);
    expect(m.deco.bodyCollapsed('t1_c0')).toBe(false);
  });
});
